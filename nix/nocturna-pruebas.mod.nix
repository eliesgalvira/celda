{ self, ... }:
{
  perSystem =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (lib.lists) singleton;
      inherit (lib.meta) getExe;
      inherit (lib.modules) mkIf;

      # Una autoridad y un certificado para el geoportal, antenasmoviles.es, el R2 y el Vercel de mentira. Son de la
      # prueba: no protegen nada.
      certificados =
        pkgs.runCommand "celda-nocturna-certificados-de-prueba"
          { nativeBuildInputs = singleton pkgs.openssl; }
          /* bash */ ''
            mkdir "$out"
            openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
              -days 36500 -subj "/CN=Autoridad de prueba" -keyout ca.key -out "$out/ca.pem"
            openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
              -subj "/CN=Fuentes de prueba" -keyout "$out/servidor.key" -out servidor.csr
            printf "subjectAltName=DNS:geoportal.minetur.gob.es,DNS:antenasmoviles.es,DNS:cuenta.r2.cloudflarestorage.com,DNS:capas.prueba,DNS:api.vercel.com,DNS:celda.prueba" > san
            openssl x509 -req -in servidor.csr -CA "$out/ca.pem" -CAkey ca.key -CAcreateserial \
              -days 36500 -extfile san -out "$out/servidor.pem"
          '';

      # El geoportal contesta el listado de cada caja con los elementos grabados en el Campus Nord
      # que caen en ella, y cada ficha con una grabada. antenasmoviles.es da como listado los
      # marcadores grabados en el Campus Nord, las ER5 grabadas de Barcelona y una ER5 de Madrid, y
      # el detalle grabado de cada marcador que lo tiene. R2 guarda lo que le llega en una carpeta
      # y apunta la firma de cada petición; `capas.prueba` sirve el cubo sin firma, como el Worker.
      # Vercel construye un despliegue con la orden `reserva` en cada llamada al deploy hook y, si
      # acaba bien, lo sirve en `celda.prueba/capas`; si falla, sigue sirviendo el anterior.
      fuentesDePrueba =
        pkgs.writers.writePython3Bin "fuentes-de-prueba" { flakeIgnore = singleton "E501"; }
          /* python */ ''
            import http.server
            import json
            import os
            import ssl
            import subprocess
            import sys
            import threading
            import time
            import urllib.parse
            from xml.sax.saxutils import escape

            LISTADO, FICHA, ANTENAS, CERTIFICADO, CLAVE, CARPETA, CELDA = sys.argv[1:8]
            CUBOS = os.path.join(CARPETA, "r2")
            PETICIONES = os.path.join(CARPETA, "peticiones.log")
            # Con este fichero, el origen público de R2 contesta 503: el build de Vercel no llega.
            R2_CAIDO = os.path.join(CARPETA, "r2-publico-caido")
            VERCEL = os.path.join(CARPETA, "vercel")
            DESPLIEGUES = os.path.join(CARPETA, "despliegues.log")
            despliegues = []


            def desplegar():
                """Un build: la orden reserva de R2 a una carpeta nueva, que se sirve si acaba bien."""
                despliegues.append(None)
                numero = len(despliegues)
                destino = os.path.join(VERCEL, str(numero))
                build = subprocess.run([CELDA, "reserva", "https://capas.prueba", destino], capture_output=True, text=True)
                if build.returncode == 0:
                    os.symlink(str(numero), os.path.join(VERCEL, "nuevo"))
                    os.replace(os.path.join(VERCEL, "nuevo"), os.path.join(VERCEL, "actual"))
                with open(DESPLIEGUES, "a") as registro:
                    registro.write(f"{numero} {'servido' if build.returncode == 0 else 'fallido'}\n")
                print(build.stdout, build.stderr, flush=True)


            def leer(ruta):
                with open(ruta, "rb") as fichero:
                    return fichero.read()


            def listado(consulta):
                oeste, sur, este, norte = (float(g) for g in consulta["bbox"][0].split(","))
                grabado = json.loads(leer(LISTADO).decode("latin-1"))
                dentro = []
                for elemento in grabado["features"]:
                    longitud, latitud = elemento["geometry"]["coordinates"]
                    if oeste <= longitud <= este and sur <= latitud <= norte:
                        dentro.append(elemento)
                if not dentro:
                    return b"{}"
                return json.dumps({"type": "FeatureCollection", "features": dentro}, ensure_ascii=False).encode("latin-1")


            def showf():
                marcadores = []
                for nombre in ("v1-showf-er5_extracto-campus-nord.json", "v1-showf-er5_extracto-er5-barcelona.json"):
                    marcadores.extend(json.loads(leer(os.path.join(ANTENAS, nombre))))
                # Una ER5 sin compañía fuera de Cataluña: nunca se pide su detalle.
                marcadores.append([40.4168, -3.7038, ["MV-MADRID-PRUEBA"], "er5", ""])
                # Sin espacios, como la respuesta real.
                return json.dumps(marcadores, ensure_ascii=False, separators=(",", ":")).encode()


            def detalle(consulta):
                ruta = os.path.join(ANTENAS, f"v1-markers_{consulta['id'][0]}.json")
                return leer(ruta) if os.path.isfile(ruta) else b"[]"


            class Fuentes(http.server.BaseHTTPRequestHandler):
                protocol_version = "HTTP/1.1"

                def responder(self, estado, cuerpo=b"", tipo="text/plain"):
                    self.send_response(estado)
                    self.send_header("Content-Type", tipo)
                    self.send_header("Content-Length", str(len(cuerpo)))
                    self.end_headers()
                    self.wfile.write(cuerpo)

                def apuntar(self):
                    host = self.headers.get("Host", "").split(":")[0]
                    firma = self.headers.get("Authorization", "")
                    with open(PETICIONES, "a") as registro:
                        registro.write(f"{time.monotonic():.3f} {self.command} {host} {self.path} {firma}\n")
                    ruta = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
                    return host, ruta, firma

                def do_GET(self):
                    host, ruta, firma = self.apuntar()
                    if host == "geoportal.minetur.gob.es":
                        if ruta == "/robots.txt":
                            return self.responder(200, b"User-agent: *\nAllow: /\n")
                        if ruta == "/VCTEL/infoantenasGeoJSON.do":
                            consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                            return self.responder(200, listado(consulta), "application/json")
                        if ruta == "/VCTEL/detalleEstacion.do":
                            return self.responder(200, leer(FICHA), "text/html")
                        return self.responder(404)
                    if host == "capas.prueba":
                        if os.path.exists(R2_CAIDO):
                            return self.responder(503)
                        fichero = os.path.join(CUBOS, "celda", ruta.lstrip("/"))
                        if not os.path.isfile(fichero):
                            return self.responder(404)
                        return self.responder(200, leer(fichero), "application/json")
                    if host == "celda.prueba":
                        fichero = os.path.join(VERCEL, "actual", ruta.removeprefix("/capas/"))
                        if not ruta.startswith("/capas/") or not os.path.isfile(fichero):
                            return self.responder(404)
                        return self.responder(200, leer(fichero), "application/json")
                    if host == "antenasmoviles.es":
                        if ruta == "/robots.txt":
                            return self.responder(200, leer(os.path.join(ANTENAS, "robots.txt")))
                        if ruta == "/v1/showf":
                            return self.responder(200, showf(), "application/json")
                        if ruta == "/v1/markers":
                            consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                            return self.responder(200, detalle(consulta), "application/json")
                        return self.responder(404)
                    if firma == "":
                        return self.responder(403)
                    clave = ruta.lstrip("/")
                    if "/" not in clave:
                        cubo = os.path.join(CUBOS, clave)
                        claves = sorted(
                            os.path.relpath(os.path.join(carpeta, nombre), cubo)
                            for carpeta, _, nombres in os.walk(cubo)
                            for nombre in nombres
                        )
                        xml = "".join(f"<Key>{escape(c)}</Key>" for c in claves)
                        xml = f"<ListBucketResult>{xml}</ListBucketResult>"
                        return self.responder(200, xml.encode(), "application/xml")
                    fichero = os.path.join(CUBOS, clave)
                    if not os.path.isfile(fichero):
                        return self.responder(404, b"<Error><Code>NoSuchKey</Code></Error>")
                    return self.responder(200, leer(fichero), "application/json")

                def do_POST(self):
                    host, ruta, _ = self.apuntar()
                    if host != "api.vercel.com" or not ruta.startswith("/v1/integrations/deploy/"):
                        return self.responder(404)
                    os.makedirs(VERCEL, exist_ok=True)
                    threading.Thread(target=desplegar).start()
                    return self.responder(201, b'{"job":{"state":"PENDING"}}', "application/json")

                def do_PUT(self):
                    _, ruta, firma = self.apuntar()
                    cuerpo = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    if firma == "":
                        return self.responder(403)
                    fichero = os.path.join(CUBOS, ruta.lstrip("/"))
                    if self.headers.get("If-None-Match") == "*" and os.path.exists(fichero):
                        return self.responder(412)
                    os.makedirs(os.path.dirname(fichero), exist_ok=True)
                    with open(fichero, "wb") as salida:
                        salida.write(cuerpo)
                    return self.responder(200)

                def do_DELETE(self):
                    _, ruta, firma = self.apuntar()
                    if firma == "":
                        return self.responder(403)
                    fichero = os.path.join(CUBOS, ruta.lstrip("/"))
                    if os.path.isfile(fichero):
                        os.remove(fichero)
                    return self.responder(204)


            servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 443), Fuentes)
            contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            contexto.load_cert_chain(CERTIFICADO, CLAVE)
            servidor.socket = contexto.wrap_socket(servidor.socket, server_side=True)
            servidor.serve_forever()
          '';
    in
    {
      checks.celda-nocturna = config.packages.celda-nocturna;

      # El módulo de NixOS en una máquina virtual: dispara el temporizador contra las fuentes de
      # prueba y comprueba la base, la copia, lo publicado y las credenciales.
      checks.celda-nocturna-nixos =
        mkIf pkgs.stdenv.hostPlatform.isLinux
        <| pkgs.testers.runNixOSTest {
          name = "celda-nocturna";

          nodes.maquina = {
            imports = singleton self.nixosModules.celda-nocturna;

            services.celda-nocturna = {
              enable = true;
              horario = "*-*-* 04:00:00";
              credenciales.r2 = "/run/secretos/celda-r2.env";
              credenciales.vercel = "/run/secretos/celda-vercel.env";
              copias.directorio = "/srv/copias/celda";
              origenPublico = "https://capas.prueba";
              origenDeReserva = "https://celda.prueba/capas";
              # Una ficha cada 4 s durante los 2 primeros minutos de la noche: el listado se lleva
              # medio, y no caben las 40. Las zonas y la prioridad de las fichas son las de por
              # defecto, las de toda España: la primera noche barre Cataluña.
              registroOficial.fichas.ritmo = 4;
              registroOficial.fichas.ventana = 2;
              antenasmoviles.enable = true;
              antenasmoviles.maxDetalles = 4;
              antenasmoviles.zonas = singleton "cataluna";
            };

            # La prueba mueve el reloj para disparar el temporizador.
            services.timesyncd.enable = false;

            networking.hosts."127.0.0.1" = [
              "geoportal.minetur.gob.es"
              "antenasmoviles.es"
              "cuenta.r2.cloudflarestorage.com"
              "capas.prueba"
              "api.vercel.com"
              "celda.prueba"
            ];

            systemd.services.celda-nocturna.environment.NODE_EXTRA_CA_CERTS = "${certificados}/ca.pem";

            systemd.services.fuentes-de-prueba = {
              wantedBy = singleton "multi-user.target";

              # El build de Vercel lee de `capas.prueba` con el certificado de la prueba.
              environment.NODE_EXTRA_CA_CERTS = "${certificados}/ca.pem";

              serviceConfig = {
                ExecStart = "${getExe fuentesDePrueba} ${../docs/investigacion/muestras/geojson-campus-nord.iso-8859-1.json} ${../docs/investigacion/muestras/detalle-telefonica-0800942.iso-8859-1.html} ${../docs/investigacion/muestras/antenasmoviles} ${certificados}/servidor.pem ${certificados}/servidor.key /var/lib/fuentes-de-prueba ${getExe config.packages.celda-nocturna}";
                StateDirectory = "fuentes-de-prueba";
              };
            };
          };

          testScript =
            { nodes, ... }:
            /* python */ ''
              import subprocess

              maquina.wait_for_unit("multi-user.target")
              maquina.wait_for_unit("fuentes-de-prueba.service")
              maquina.wait_for_open_port(443)

              with subtest("las credenciales se crean en la máquina, fuera del almacén de Nix"):
                  maquina.succeed(
                      "mkdir --parents /run/secretos",
                      "umask 077; {"
                      " echo CELDA_R2_CUENTA=cuenta;"
                      " echo CELDA_R2_CUBO=celda;"
                      " echo CELDA_R2_ID_CLAVE=clave$(od --address-radix=n --format=x1 --read-bytes=12 /dev/urandom | tr --delete ' \\n');"
                      " echo CELDA_R2_SECRETO=secreto$(od --address-radix=n --format=x1 --read-bytes=24 /dev/urandom | tr --delete ' \\n');"
                      " } > /run/secretos/celda-r2.env",
                  )
                  id_clave = maquina.succeed("sed --quiet 's/^CELDA_R2_ID_CLAVE=//p' /run/secretos/celda-r2.env").strip()
                  secreto = maquina.succeed("sed --quiet 's/^CELDA_R2_SECRETO=//p' /run/secretos/celda-r2.env").strip()
                  maquina.succeed(
                      "umask 077; echo CELDA_VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/prj_prueba/"
                      "hook$(od --address-radix=n --format=x1 --read-bytes=12 /dev/urandom | tr --delete ' \\n')"
                      " > /run/secretos/celda-vercel.env"
                  )
                  hook = maquina.succeed("sed --quiet 's/^CELDA_VERCEL_DEPLOY_HOOK=//p' /run/secretos/celda-vercel.env").strip()
                  secreto_del_hook = hook.rsplit("/", 1)[1]

              with subtest("el temporizador recupera las noches perdidas y dispara la noche a su hora"):
                  assert maquina.succeed("systemctl show celda-nocturna.timer --property=Persistent --value").strip() == "yes"
                  siguiente = maquina.succeed(
                      "systemctl show celda-nocturna.timer --property=NextElapseUSecRealtime --value --timestamp=unix"
                  ).strip()
                  maquina.succeed(f"date --set={siguiente}")
                  maquina.wait_until_succeeds(
                      "systemctl show celda-nocturna.service --property=ExecMainExitTimestampMonotonic --value"
                      " | grep --invert-match --line-regexp 0",
                      timeout=300,
                  )
                  print(maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager"))
                  assert maquina.succeed("systemctl show celda-nocturna.service --property=Result --value").strip() == "success"

              with subtest("la base, la copia y lo publicado están donde dicen las opciones"):
                  maquina.succeed("test \"$(stat --format=%U /var/lib/celda-nocturna/ingesta.sqlite)\" = celda-nocturna")
                  maquina.succeed("ls /srv/copias/celda/ingesta-*.sqlite")
                  maquina.succeed("test -s /var/lib/fuentes-de-prueba/r2/celda/vigente.json")
                  maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/resumen@*.json")
                  maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/provincias/08/*.json")
                  maquina.succeed(f"grep --fixed-strings 'Credential={id_clave}/' /var/lib/fuentes-de-prueba/peticiones.log")

              with subtest("la orden de estado se lanza como el usuario del servicio"):
                  estado = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna estado")
                  print(estado)
                  assert "completada" in estado
                  assert "Última versión publicada: ninguna" not in estado

              with subtest("por defecto las siete zonas se turnan: la primera noche barre Cataluña, cuadro a cuadro"):
                  entorno = maquina.succeed("systemctl show celda-nocturna.service --property=Environment")
                  for variable in (
                      "CELDA_REGISTRO_ZONAS=ninguna",
                      "CELDA_REGISTRO_ZONAS_EN_TURNO=cataluna,centro,andalucia,levante,norte,ebro-y-duero,oeste-y-canarias",
                      "CELDA_REGISTRO_ZONAS_POR_NOCHE=1",
                      "CELDA_REGISTRO_MAX_PETICIONES=400",
                  ):
                      assert variable in entorno, entorno
                  assert "- cataluna: completado, 9 cuadros" in estado, estado
                  assert "- centro: completado" not in estado, estado
                  assert "40 registros" in estado, estado
                  # Por zona: cuándo se barrió y cuántas fichas le faltan, y cuál va la noche siguiente.
                  assert "- cataluna: último barrido completado" in estado, estado
                  assert "- centro: ningún barrido completado; fichas por leer: ninguna" in estado, estado
                  assert "La próxima noche barre: centro" in estado, estado
                  # Los 9 cuadros de Cataluña, una petición cada uno: ninguno llega al tope.
                  listados = maquina.succeed("grep --count infoantenasGeoJSON.do /var/lib/fuentes-de-prueba/peticiones.log").strip()
                  assert listados == "9", listados

              with subtest("antenasmoviles.es: un listado y el detalle de las ER5 pendientes de Cataluña, hasta el tope"):
                  assert "antenasmoviles: encendida" in estado, estado
                  assert "- cataluna: completado, 9 cuadros, 4 peticiones, 0 kB, 83 registros" in estado, estado
                  listados = maquina.succeed("grep --count 'GET antenasmoviles.es /v1/showf' /var/lib/fuentes-de-prueba/peticiones.log").strip()
                  assert listados == "1", listados
                  detalles = [
                      linea.split()[3].removeprefix("/v1/markers?id=")
                      for linea in maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                      if " GET antenasmoviles.es /v1/markers?" in linea
                  ]
                  # Primero las dos ER5 sin compañía de Barcelona; nunca la de Madrid ni las copias del registro.
                  assert detalles == ["ER5-08033-1", "MIC-08902-1", "CATR2888X", "CATR6031A"], detalles
                  # La ER5 de Orange de Urquinaona se publica citando antenasmoviles.es con su enlace.
                  maquina.succeed("grep --recursive --fixed-strings --quiet 'https://antenasmoviles.es/#19/41.389648/2.173639' /var/lib/fuentes-de-prueba/r2/celda")

              with subtest("las fichas van a su ritmo y paran al cerrar la ventana, dejando el resto en la cola"):
                  entorno = maquina.succeed("systemctl show celda-nocturna.service --property=Environment")
                  for variable in (
                      "CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS=4",
                      "CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS=2",
                      "CELDA_REGISTRO_FICHAS_PRIORIDAD=08,17,25,43",
                      "CELDA_REGISTRO_FICHAS_RELECTURA_DIAS=30",
                  ):
                      assert variable in entorno, entorno
                  assert "CELDA_INGESTA_MAX_FICHAS" not in entorno, entorno
                  # 2 minutos de ventana, la hora de espera antes de repetir la publicación y una hora más.
                  tiempo = maquina.succeed("systemctl show celda-nocturna.service --property=TimeoutStartUSec --value").strip()
                  assert tiempo == "2h 2min", tiempo

                  lineas = maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                  geoportal = [linea.split() for linea in lineas if " geoportal.minetur.gob.es " in linea]
                  inicio = float(geoportal[0][0])
                  fichas = [float(campos[0]) for campos in geoportal if "/VCTEL/detalleEstacion.do" in campos[3]]
                  huecos = [b - a for a, b in zip(fichas, fichas[1:])]
                  print(f"{len(fichas)} fichas, huecos de {min(huecos):.2f} a {max(huecos):.2f} s")
                  assert 5 <= len(fichas) < 40, len(fichas)
                  assert min(huecos) >= 3.9, huecos
                  assert fichas[-1] - inicio < 120, fichas[-1] - inicio
                  assert f"fichas {len(fichas)} leídas" in estado, estado
                  assert f"- provincia 08 (Barcelona): {40 - len(fichas)} sin leer, 0 por releer" in estado, estado
                  assert f"; fichas por leer: {40 - len(fichas)} sin leer, 0 por releer" in estado, estado
                  assert "ventana cerrada" in maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")
                  # Se publica a mitad de la ventana y otra vez al cerrarla.
                  capas = maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/ | grep --count '^ficheros@'").strip()
                  assert capas == "2", capas

              def llamadas_al_hook():
                  return [
                      linea.split()[3]
                      for linea in maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                      if " POST api.vercel.com " in linea
                  ]

              def publicar_a_mano():
                  # Como el servicio: su usuario, sus credenciales y la configuración de la máquina.
                  salida = maquina.succeed(
                      "systemd-run --wait --pipe --collect --quiet"
                      " --uid=celda-nocturna --gid=celda-nocturna"
                      " --property=LoadCredential=r2:/run/secretos/celda-r2.env"
                      " --property=LoadCredential=vercel:/run/secretos/celda-vercel.env"
                      " --setenv=NODE_EXTRA_CA_CERTS=${certificados}/ca.pem"
                      " /run/current-system/sw/bin/celda-nocturna publicar 2>&1"
                  )
                  print(salida)
                  return salida

              servida = "/var/lib/fuentes-de-prueba/vercel/actual"
              r2 = "/var/lib/fuentes-de-prueba/r2/celda"

              with subtest("tras publicar, la noche llama una vez al deploy hook y Vercel sirve solo la versión vigente"):
                  assert "Copia de reserva: despliegue pedido para sitios@" in maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")
                  assert llamadas_al_hook() == [hook.removeprefix("https://api.vercel.com")], llamadas_al_hook()
                  maquina.wait_until_succeeds("grep --line-regexp '1 servido' /var/lib/fuentes-de-prueba/despliegues.log", timeout=60)
                  maquina.succeed(f"cmp {servida}/vigente.json {r2}/vigente.json")
                  # R2 tiene las dos versiones de la noche; la copia, solo la vigente.
                  assert maquina.succeed(f"ls {servida} | grep --count '^ficheros@'").strip() == "1"
                  manifiesto = maquina.succeed(f"ls {servida} | grep '^ficheros@'").strip()
                  listados = maquina.succeed(f"grep --only-matching '\"[a-z]*/[0-9a-f/]*\\.json\"' {servida}/{manifiesto} | wc --lines").strip()
                  ficheros = maquina.succeed(f"find -L {servida} -type f | wc --lines").strip()
                  # Sus capas, lotes y partes del índice de claves, el manifiesto, el resumen y vigente.json.
                  assert int(ficheros) == int(listados) + 3, (ficheros, listados)
                  maquina.succeed(f"cd {servida} && find . -type f -exec cmp {{}} {r2}/{{}} \\;")

              with subtest("con la copia al día, publicar otra vez no llama al hook"):
                  salida = publicar_a_mano()
                  assert "Copia de reserva: ya sirve sitios@" in salida, salida
                  assert len(llamadas_al_hook()) == 1, llamadas_al_hook()

              with subtest("un build que no llega a R2 falla, y Vercel sigue sirviendo la copia anterior"):
                  # La copia servida es de otra versión y R2 no contesta al build.
                  maquina.succeed(
                      "cp --recursive --dereference /var/lib/fuentes-de-prueba/vercel/1 /var/lib/fuentes-de-prueba/vercel/anterior",
                      "echo '{\"version\":\"sitios@2026-01-01T00:00:00Z\",\"fecha\":0,\"emplazamientos\":0,\"lotes\":0}'"
                      " > /var/lib/fuentes-de-prueba/vercel/anterior/vigente.json",
                      f"ln --symbolic --force --no-dereference anterior {servida}",
                      "touch /var/lib/fuentes-de-prueba/r2-publico-caido",
                  )
                  salida = publicar_a_mano()
                  assert "Copia de reserva: despliegue pedido para sitios@" in salida, salida
                  assert len(llamadas_al_hook()) == 2, llamadas_al_hook()
                  maquina.wait_until_succeeds("grep --line-regexp '2 fallido' /var/lib/fuentes-de-prueba/despliegues.log", timeout=60)
                  assert maquina.succeed(f"readlink {servida}").strip() == "anterior"
                  maquina.succeed(f"grep --fixed-strings 2026-01-01 {servida}/vigente.json")
                  # El despliegue fallido no llegó a escribir vigente.json.
                  maquina.fail("test -e /var/lib/fuentes-de-prueba/vercel/2/vigente.json")

              with subtest("cuando R2 vuelve, la siguiente publicación despliega la copia al día"):
                  maquina.succeed("rm /var/lib/fuentes-de-prueba/r2-publico-caido")
                  publicar_a_mano()
                  assert len(llamadas_al_hook()) == 3, llamadas_al_hook()
                  maquina.wait_until_succeeds("grep --line-regexp '3 servido' /var/lib/fuentes-de-prueba/despliegues.log", timeout=60)
                  maquina.succeed(f"cmp {servida}/vigente.json {r2}/vigente.json")
                  assert "Copia de reserva: ya sirve sitios@" in publicar_a_mano()
                  assert len(llamadas_al_hook()) == 3, llamadas_al_hook()

              with subtest("el servicio corre endurecido"):
                  print(maquina.succeed("systemd-analyze security celda-nocturna.service --no-pager"))

              with subtest("ningún secreto acaba en el almacén de Nix"):
                  for valor in (secreto, secreto_del_hook):
                      maquina.fail(f"systemctl show celda-nocturna.service | grep --fixed-strings {valor}")
                  with open("${
                    pkgs.closureInfo { rootPaths = singleton nodes.maquina.system.build.toplevel; }
                  }/store-paths") as rutas:
                      almacen = rutas.read().split()

                  def buscar(valor):
                      return subprocess.run(
                          ["${getExe pkgs.gnugrep}", "--recursive", "--fixed-strings", "--files-with-matches", "--no-messages", valor, *almacen],
                          capture_output=True,
                          text=True,
                      )

                  # La búsqueda encuentra lo que sí está en el almacén: la configuración del servicio.
                  assert buscar("Celda (ingesta; contacto en celda.elies.site)").returncode == 0
                  for valor in (id_clave, secreto, secreto_del_hook):
                      encontrado = buscar(valor)
                      assert encontrado.returncode == 1, f"secreto en el almacén: {encontrado.stdout}"
            '';
        };
    };
}
