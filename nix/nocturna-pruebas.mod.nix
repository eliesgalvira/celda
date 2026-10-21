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

      # Una autoridad y un certificado para el geoportal, el R2 y el Convex de mentira. Son de la
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
            printf "subjectAltName=DNS:geoportal.minetur.gob.es,DNS:cuenta.r2.cloudflarestorage.com,DNS:buzon.convex.prueba" > san
            openssl x509 -req -in servidor.csr -CA "$out/ca.pem" -CAkey ca.key -CAcreateserial \
              -days 36500 -extfile san -out "$out/servidor.pem"
          '';

      # El geoportal contesta el listado de cada caja con los elementos grabados en el Campus Nord
      # que caen en ella, y cada ficha con una grabada. R2 guarda lo que le llega en una carpeta
      # y apunta la firma de cada petición; no contesta nada sin firma ni deja escribir con la clave
      # de solo lectura del build de Vercel. El buzón de Convex contesta a su acción HTTP de lo
      # aceptado, solo con la clave de publicación de la credencial de la ingesta, con una página sin
      # nada aceptado.
      fuentesDePrueba =
        pkgs.writers.writePython3Bin "fuentes-de-prueba" { flakeIgnore = singleton "E501"; }
          /* python */ ''
            import http.server
            import json
            import os
            import ssl
            import sys
            import time
            import urllib.parse
            from xml.sax.saxutils import escape

            LISTADO, FICHA, CERTIFICADO, CLAVE, CARPETA = sys.argv[1:6]
            CUBOS = os.path.join(CARPETA, "r2")
            PETICIONES = os.path.join(CARPETA, "peticiones.log")
            # Con este fichero, el geoportal da las fichas que dice y luego un 429 a cada una.
            FICHAS_QUE_QUEDAN = os.path.join(CARPETA, "fichas-que-quedan")
            # Con este fichero, R2 contesta 503 a la clave del build: el build de Vercel no llega.
            R2_CAIDO = os.path.join(CARPETA, "r2-caido-para-el-build")
            # Las variables de R2 del proyecto de Vercel, con la clave de solo lectura. Las escribe
            # la prueba.
            CLAVE_DEL_BUILD = "/run/secretos/vercel-r2.env"
            # La conexión de la ingesta con el buzón. La escribe la prueba.
            CONEXION_CON_CONVEX = "/run/secretos/celda-convex.env"


            def variables_del_build():
                if not os.path.exists(CLAVE_DEL_BUILD):
                    return {}
                with open(CLAVE_DEL_BUILD) as fichero:
                    return dict(linea.strip().split("=", 1) for linea in fichero if "=" in linea)


            def clave_de_publicacion():
                if not os.path.exists(CONEXION_CON_CONVEX):
                    return None
                with open(CONEXION_CON_CONVEX) as fichero:
                    variables = dict(linea.strip().split("=", 1) for linea in fichero if "=" in linea)
                return variables.get("CELDA_PUBLICACION_CLAVE")


            def es_del_build(firma):
                clave = variables_del_build().get("CELDA_R2_ID_CLAVE")
                return clave is not None and f"Credential={clave}/" in firma


            def leer(ruta):
                with open(ruta, "rb") as fichero:
                    return fichero.read()


            def queda_otra_ficha():
                """Si el geoportal da otra ficha, o pide que se espere."""
                if not os.path.exists(FICHAS_QUE_QUEDAN):
                    return True
                with open(FICHAS_QUE_QUEDAN) as fichero:
                    quedan = int(fichero.read().strip() or "0")
                if quedan <= 0:
                    return False
                with open(FICHAS_QUE_QUEDAN, "w") as fichero:
                    fichero.write(str(quedan - 1))
                return True


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
                    if host == "buzon.convex.prueba":
                        if ruta != "/aportaciones/aceptadas":
                            return self.responder(404)
                        if firma != f"Bearer {clave_de_publicacion()}":
                            return self.responder(401)
                        return self.responder(200, b'{"aportaciones":[],"ultima":null}', "application/json")
                    if host == "geoportal.minetur.gob.es":
                        if ruta == "/robots.txt":
                            return self.responder(200, b"User-agent: *\nAllow: /\n")
                        if ruta == "/VCTEL/infoantenasGeoJSON.do":
                            consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                            return self.responder(200, listado(consulta), "application/json")
                        if ruta == "/VCTEL/detalleEstacion.do":
                            if not queda_otra_ficha():
                                return self.responder(429)
                            return self.responder(200, leer(FICHA), "text/html")
                        return self.responder(404)
                    if firma == "":
                        return self.responder(403)
                    if es_del_build(firma) and os.path.exists(R2_CAIDO):
                        return self.responder(503)
                    clave = ruta.lstrip("/")
                    if "/" not in clave:
                        cubo = os.path.join(CUBOS, clave)
                        consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                        prefijo = consulta.get("prefix", [""])[0]
                        claves = sorted(
                            c
                            for c in (
                                os.path.relpath(os.path.join(carpeta, nombre), cubo)
                                for carpeta, _, nombres in os.walk(cubo)
                                for nombre in nombres
                            )
                            if c.startswith(prefijo)
                        )
                        xml = "".join(f"<Key>{escape(c)}</Key>" for c in claves)
                        xml = f"<ListBucketResult>{xml}</ListBucketResult>"
                        return self.responder(200, xml.encode(), "application/xml")
                    fichero = os.path.join(CUBOS, clave)
                    if not os.path.isfile(fichero):
                        return self.responder(404, b"<Error><Code>NoSuchKey</Code></Error>")
                    return self.responder(200, leer(fichero), "application/json")

                def do_PUT(self):
                    _, ruta, firma = self.apuntar()
                    cuerpo = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    if firma == "" or es_del_build(firma):
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
                    if firma == "" or es_del_build(firma):
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
      # prueba y comprueba el calendario de las ejecuciones, la base, la copia, lo publicado y las
      # credenciales.
      checks.celda-nocturna-nixos =
        mkIf pkgs.stdenv.hostPlatform.isLinux
        <| pkgs.testers.runNixOSTest {
          name = "celda-nocturna";

          nodes.maquina = {
            imports = singleton self.nixosModules.celda-nocturna;

            services.celda-nocturna = {
              enable = true;
              credenciales.r2 = "/run/secretos/celda-r2.env";
              credenciales.convex = "/run/secretos/celda-convex.env";
              copias.directorio = "/srv/copias/celda";
              origenPublico = "https://celda.prueba/capas";
              # Solo Cataluña, donde cae la muestra del Campus Nord: 9 peticiones de listado en vez
              # de las unas 100 de las siete zonas. La hora, la zona horaria y el ritmo de las fichas
              # son los de por defecto, los de producción. En 2 minutos de ventana caben el listado
              # y las 40 fichas, a una por segundo.
              registroOficial.zonas = singleton "cataluna";
              registroOficial.fichas.ventana = 2;
            };

            # La prueba mueve el reloj para disparar el temporizador.
            services.timesyncd.enable = false;

            networking.hosts."127.0.0.1" = [
              "geoportal.minetur.gob.es"
              "cuenta.r2.cloudflarestorage.com"
              "buzon.convex.prueba"
            ];

            systemd.services.celda-nocturna.environment.NODE_EXTRA_CA_CERTS = "${certificados}/ca.pem";

            systemd.services.fuentes-de-prueba = {
              wantedBy = singleton "multi-user.target";

              serviceConfig = {
                ExecStart = "${getExe fuentesDePrueba} ${../docs/investigacion/muestras/geojson-campus-nord.iso-8859-1.json} ${../docs/investigacion/muestras/detalle-telefonica-0800942.iso-8859-1.html} ${certificados}/servidor.pem ${certificados}/servidor.key /var/lib/fuentes-de-prueba";
                StateDirectory = "fuentes-de-prueba";
              };
            };
          };

          testScript =
            { nodes, ... }:
            /* python */ ''
              import json
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
                  # La clave de solo lectura del cubo, en las variables del proyecto de Vercel.
                  maquina.succeed(
                      "umask 077; {"
                      " echo CELDA_R2_CUENTA=cuenta;"
                      " echo CELDA_R2_CUBO=celda;"
                      " echo CELDA_R2_ID_CLAVE=lectura$(od --address-radix=n --format=x1 --read-bytes=12 /dev/urandom | tr --delete ' \\n');"
                      " echo CELDA_R2_SECRETO=secreto$(od --address-radix=n --format=x1 --read-bytes=24 /dev/urandom | tr --delete ' \\n');"
                      " } > /run/secretos/vercel-r2.env",
                  )
                  id_de_lectura = maquina.succeed("sed --quiet 's/^CELDA_R2_ID_CLAVE=//p' /run/secretos/vercel-r2.env").strip()
                  secreto_de_lectura = maquina.succeed("sed --quiet 's/^CELDA_R2_SECRETO=//p' /run/secretos/vercel-r2.env").strip()
                  # La clave de publicación del buzón de Convex: solo abre lo aceptado.
                  maquina.succeed(
                      "umask 077; {"
                      " echo CELDA_CONVEX_SITE_URL=https://buzon.convex.prueba;"
                      " echo CELDA_PUBLICACION_CLAVE=publicacion$(od --address-radix=n --format=x1 --read-bytes=24 /dev/urandom | tr --delete ' \\n');"
                      " } > /run/secretos/celda-convex.env",
                  )
                  clave_de_publicacion_convex = maquina.succeed("sed --quiet 's/^CELDA_PUBLICACION_CLAVE=//p' /run/secretos/celda-convex.env").strip()
                  assert len(clave_de_publicacion_convex) > 32, clave_de_publicacion_convex

              DIA = 86400

              def proximo_disparo():
                  """Cuándo se dispara el temporizador, en segundos desde 1970."""
                  return int(maquina.succeed(
                      "systemctl show celda-nocturna.timer --property=NextElapseUSecRealtime --value --timestamp=unix"
                  ).strip().lstrip("@"))

              def en_madrid(instante):
                  """El día de la semana (6 es sábado, 7 domingo), el del mes y la hora en Madrid."""
                  dia, fecha, hora = maquina.succeed(f"TZ=Europe/Madrid date --date=@{instante} '+%u %-d %H:%M'").split()
                  return int(dia), int(fecha), hora

              def es_primer_sabado(instante):
                  dia, fecha, hora = en_madrid(instante)
                  return dia == 6 and fecha <= 7 and hora == "00:30"

              def es_domingo_siguiente(instante):
                  dia, fecha, hora = en_madrid(instante)
                  return dia == 7 and 2 <= fecha <= 8 and hora == "00:30"

              def acabadas():
                  return maquina.succeed(
                      "systemctl show celda-nocturna.service --property=ExecMainExitTimestampMonotonic --value"
                  ).strip()

              def disparar(instante):
                  """Lleva el reloj a la hora del disparo y espera a que acabe la ejecución que lanza."""
                  antes = acabadas()
                  maquina.succeed(f"date --set=@{instante}")
                  # Mientras corre, la hora de salida vale 0.
                  maquina.wait_until_succeeds(
                      "systemctl show celda-nocturna.service --property=ExecMainExitTimestampMonotonic --value"
                      f" | grep --invert-match --line-regexp --regexp=0 --regexp={antes}",
                      timeout=300,
                  )
                  assert maquina.succeed("systemctl show celda-nocturna.service --property=Result --value").strip() == "success"

              def del_geoportal():
                  return [
                      linea.split()
                      # Antes de la primera petición, el fichero aún no existe.
                      for linea in maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log 2>/dev/null || true").splitlines()
                      if " geoportal.minetur.gob.es " in linea
                  ]

              def el_diario():
                  return maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")

              with subtest("el temporizador lanza el primer sábado de cada mes y el domingo siguiente, a las 00:30 de Madrid, sin recuperar las perdidas"):
                  assert maquina.succeed("systemctl show celda-nocturna.timer --property=Persistent --value").strip() == "no"
                  calendario = maquina.succeed("systemctl show celda-nocturna.timer --property=TimersCalendar --value")
                  print(calendario)
                  assert "Sat *-*-01..07 00:30:00 Europe/Madrid" in calendario, calendario
                  assert "Sun *-*-02..08 00:30:00 Europe/Madrid" in calendario, calendario
                  siguiente = proximo_disparo()
                  assert es_primer_sabado(siguiente) or es_domingo_siguiente(siguiente), en_madrid(siguiente)

              with subtest("un disparo tardío entre semana, como tras una suspensión o un salto del reloj, no lanza la ejecución"):
                  # El reloj salta dos días y una hora por encima del próximo disparo: el temporizador
                  # se dispara tarde, un lunes o un martes, y la condición del servicio lo deja pasar.
                  maquina.succeed(f"date --set=@{proximo_disparo() + 2 * DIA + 3600}")
                  maquina.wait_until_succeeds(
                      "journalctl --unit=celda-nocturna.service --no-pager"
                      " | grep --fixed-strings 'quizá tras una suspensión o un salto del reloj'",
                      timeout=60,
                  )
                  print(el_diario())
                  assert acabadas() == "0", acabadas()
                  assert del_geoportal() == []
                  # Y el siguiente es el primer sábado del mes que viene.
                  assert es_primer_sabado(proximo_disparo()), en_madrid(proximo_disparo())

              with subtest("el primer sábado del mes la ejecución barre la zona y lee todas las fichas, y el siguiente disparo es el del domingo"):
                  sabado = proximo_disparo()
                  disparar(sabado)
                  print(el_diario())
                  assert proximo_disparo() - sabado == DIA
                  assert es_domingo_siguiente(proximo_disparo()), en_madrid(proximo_disparo())
                  assert "La ronda está entera, así que la ejecución del domingo" in el_diario()

              with subtest("la base, la copia y lo publicado están donde dicen las opciones"):
                  maquina.succeed("test \"$(stat --format=%U /var/lib/celda-nocturna/ingesta.sqlite)\" = celda-nocturna")
                  maquina.succeed("ls /srv/copias/celda/ingesta-*.sqlite")
                  maquina.succeed("test -s /var/lib/fuentes-de-prueba/r2/celda/vigente.json")
                  maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/resumen@*.json")
                  maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/provincias/08/*.json")
                  maquina.succeed(f"grep --fixed-strings 'Credential={id_clave}/' /var/lib/fuentes-de-prueba/peticiones.log")

              with subtest("la copia de la base también va a R2, comprimida y bajo copias/"):
                  local = maquina.succeed("ls /srv/copias/celda/ | grep '^ingesta-'").split()
                  en_r2 = maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/copias/").split()
                  assert en_r2 == [f"{copia}.gz" for copia in local], (local, en_r2)
                  maquina.succeed(
                      f"gzip --decompress --stdout /var/lib/fuentes-de-prueba/r2/celda/copias/{en_r2[0]}"
                      f" | cmp - /srv/copias/celda/{local[0]}"
                  )
                  assert "Copia de la base en R2: " in maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")

              with subtest("la ejecución lee lo aceptado del buzón con la clave de publicación de su credencial"):
                  diario = maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")
                  assert "Buzón de Convex: 0 aceptadas leídas, 0 nuevas" in diario, diario
                  maquina.succeed(
                      f"grep --fixed-strings 'GET buzon.convex.prueba /aportaciones/aceptadas Bearer {clave_de_publicacion_convex}'"
                      " /var/lib/fuentes-de-prueba/peticiones.log"
                  )

              with subtest("la orden de estado se lanza como el usuario del servicio y dice cuándo es la próxima ejecución"):
                  estado = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna estado")
                  print(estado)
                  assert "completada" in estado
                  assert "Última versión publicada: ninguna" not in estado
                  assert "Próxima ejecución: el domingo " in estado, estado
                  assert "a las 00:30 (Europe/Madrid). Retoma la ronda" in estado, estado
                  assert "Ahora no queda nada, así que no pedirá nada." in estado, estado

              with subtest("la ronda barre Cataluña cuadro a cuadro, con la hora y la zona horaria de producción"):
                  entorno = maquina.succeed("systemctl show celda-nocturna.service --property=Environment")
                  for variable in (
                      "CELDA_REGISTRO_ZONAS=cataluna",
                      "CELDA_REGISTRO_MAX_PETICIONES=400",
                      "CELDA_INGESTA_HORA=00:30",
                      "CELDA_INGESTA_ZONA_HORARIA=Europe/Madrid",
                  ):
                      assert variable in entorno, entorno
                  for retirada in ("ZONAS_EN_TURNO", "ZONAS_POR_NOCHE", "FICHAS_PRIORIDAD", "FICHAS_RELECTURA"):
                      assert f"CELDA_REGISTRO_{retirada}" not in entorno, entorno
                  assert "- cataluna: completado, 9 cuadros" in estado, estado
                  assert "40 registros" in estado, estado
                  # Por zona: cuándo se barrió y cuántas fichas le faltan, y cuáles barre la siguiente.
                  assert "- cataluna: último barrido completado" in estado, estado
                  assert "; fichas por leer: ninguna" in estado, estado
                  assert "La próxima ejecución barre: ninguna zona" in estado, estado
                  # Los 9 cuadros de Cataluña, una petición cada uno: ninguno llega al tope.
                  listados = maquina.succeed("grep --count infoantenasGeoJSON.do /var/lib/fuentes-de-prueba/peticiones.log").strip()
                  assert listados == "9", listados

              with subtest("activar una configuración nueva no reinicia la ejecución"):
                  unidad = maquina.succeed("cat /etc/systemd/system/celda-nocturna.service")
                  assert "X-RestartIfChanged=false" in unidad.splitlines(), unidad

              with subtest("la ejecución corre con el montón de V8 a 512 MB y la memoria del servicio limitada"):
                  assert "NODE_OPTIONS=--max-old-space-size=512" in entorno, entorno
                  alta = maquina.succeed("systemctl show celda-nocturna.service --property=MemoryHigh --value").strip()
                  maxima = maquina.succeed("systemctl show celda-nocturna.service --property=MemoryMax --value").strip()
                  assert alta == str(1024 * 1024 * 1024), alta
                  assert maxima == str(1536 * 1024 * 1024), maxima
                  # El Node del paquete lee el límite de NODE_OPTIONS: con 1024 su montón crece 512 MB.
                  def limite(megas):
                      return int(maquina.succeed(
                          f"systemd-run --wait --pipe --collect --quiet --setenv=NODE_OPTIONS=--max-old-space-size={megas}"
                          " ${getExe pkgs.nodejs-slim_24} --print 'v8.getHeapStatistics().heap_size_limit'"
                      ).strip())
                  assert limite(1024) - limite(512) == 512 * 1024 * 1024, (limite(512), limite(1024))

              with subtest("las fichas van a una por segundo, de una en una, caben las 40 en la ventana y se publica a mitad y al acabar"):
                  entorno = maquina.succeed("systemctl show celda-nocturna.service --property=Environment")
                  for variable in (
                      "CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS=1",
                      "CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS=2",
                  ):
                      assert variable in entorno, entorno
                  assert "CELDA_INGESTA_MAX_FICHAS" not in entorno, entorno
                  # 2 minutos de ventana, la hora de espera antes de repetir la publicación y un cuarto de hora.
                  tiempo = maquina.succeed("systemctl show celda-nocturna.service --property=TimeoutStartUSec --value").strip()
                  assert tiempo == "1h 17min", tiempo

                  geoportal = del_geoportal()
                  inicio = float(geoportal[0][0])
                  fichas = [float(campos[0]) for campos in geoportal if "/VCTEL/detalleEstacion.do" in campos[3]]
                  huecos = [b - a for a, b in zip(fichas, fichas[1:])]
                  print(f"{len(fichas)} fichas, huecos de {min(huecos):.2f} a {max(huecos):.2f} s")
                  assert len(fichas) == 40, len(fichas)
                  assert min(huecos) >= 0.99, huecos
                  assert fichas[-1] - inicio < 120, fichas[-1] - inicio
                  assert "fichas 40 leídas" in estado, estado
                  assert "ventana cerrada" not in el_diario()
                  # Se publica a mitad de la ventana y otra vez al acabar.
                  capas = maquina.succeed("ls /var/lib/fuentes-de-prueba/r2/celda/ | grep --count '^ficheros@'").strip()
                  assert capas == "2", capas

              def build_de_vercel(destino):
                  """El build de Vercel (`vercel.sh`): la orden capas, de R2 a una carpeta nueva, con la clave de solo lectura."""
                  estado, salida = maquina.execute(
                      "systemd-run --wait --pipe --collect --quiet"
                      " --property=EnvironmentFile=/run/secretos/vercel-r2.env"
                      " --setenv=NODE_EXTRA_CA_CERTS=${certificados}/ca.pem"
                      f" ${getExe config.packages.celda-nocturna} capas {destino} 2>&1"
                  )
                  print(salida)
                  return estado

              montada = "/var/lib/build-de-vercel/1/capas"
              r2 = "/var/lib/fuentes-de-prueba/r2/celda"

              with subtest("la ejecución no dice nada de Vercel, y el build monta de R2 la vigente y la anterior"):
                  assert "Vercel" not in el_diario(), el_diario()
                  assert build_de_vercel(montada) == 0
                  maquina.succeed(f"cmp {montada}/vigente.json {r2}/vigente.json")
                  # R2 tiene las dos versiones de la ejecución, y el build las monta: la vigente y su anterior.
                  assert maquina.succeed(f"ls {montada} | grep --count '^ficheros@'").strip() == "2"
                  listados = maquina.succeed(
                      f"cat {montada}/ficheros@*.json | grep --only-matching '\"[a-z]*/[0-9a-f/]*\\.json\"' | sort --unique | wc --lines"
                  ).strip()
                  ficheros = maquina.succeed(f"find {montada} -type f | wc --lines").strip()
                  # Sus capas, lotes y partes del índice de claves, los dos manifiestos, el resumen y vigente.json.
                  assert int(ficheros) == int(listados) + 4, (ficheros, listados)
                  maquina.succeed(f"cd {montada} && find . -type f -exec cmp {{}} {r2}/{{}} \\;")
                  # El build lee R2 con la clave de solo lectura, que nunca escribe ni borra.
                  peticiones = maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                  del_build = [linea.split()[1] for linea in peticiones if f"Credential={id_de_lectura}/" in linea]
                  assert del_build and set(del_build) == {"GET"}, set(del_build)

              with subtest("el archivo de páginas guarda lo leído, y su paquete va a las copias y a R2, nunca a Vercel"):
                  # Como el usuario del servicio, para que SQLite no deje ficheros de root a su lado.
                  sqlite = "runuser --user=celda-nocturna -- ${pkgs.sqlite}/bin/sqlite3"
                  archivo = "/var/lib/celda-nocturna/archivo.sqlite"
                  maquina.succeed(f"test \"$(stat --format=%U {archivo})\" = celda-nocturna")
                  geoportal = [
                      linea.split()
                      for linea in maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                      if " geoportal.minetur.gob.es " in linea and "/robots.txt" not in linea
                  ]
                  # Cada respuesta del geoportal es una lectura. Las fichas son todas la misma página,
                  # y los listados, la del Campus Nord y la de un cuadro vacío: tres contenidos.
                  lecturas, paginas, contenidos = maquina.succeed(
                      f"{sqlite} -separator ' ' {archivo}"
                      " 'SELECT (SELECT count(*) FROM lecturas), (SELECT count(*) FROM paginas), (SELECT count(*) FROM contenidos)'"
                  ).split()
                  assert int(lecturas) == len(geoportal), (lecturas, len(geoportal))
                  assert int(paginas) == len(geoportal), (paginas, len(geoportal))
                  assert contenidos == "3", contenidos
                  paquetes = maquina.succeed("ls /srv/copias/celda/archivo/").split()
                  assert len(paquetes) == 1 and paquetes[0].startswith("archivo-"), paquetes
                  en_r2 = maquina.succeed(f"ls {r2}/archivo/").split()
                  assert en_r2 == paquetes, (paquetes, en_r2)
                  maquina.succeed(f"cmp {r2}/archivo/{en_r2[0]} /srv/copias/celda/archivo/{paquetes[0]}")
                  en_paquete = maquina.succeed(
                      f"{sqlite} /srv/copias/celda/archivo/{paquetes[0]} 'SELECT count(*) FROM lecturas'"
                  ).strip()
                  assert en_paquete == lecturas, (en_paquete, lecturas)
                  assert "Archivo de páginas en R2: " in maquina.succeed("journalctl --unit=celda-nocturna.service --no-pager")
                  # El build de Vercel no monta nada privado ni lo pide al cubo.
                  maquina.fail(f"find {montada} -path '*archivo*' -o -path '*copias*' | grep .")
                  peticiones = maquina.succeed("cat /var/lib/fuentes-de-prueba/peticiones.log").splitlines()
                  privadas = [
                      linea for linea in peticiones
                      if f"Credential={id_de_lectura}/" in linea and ("/celda/archivo/" in linea or "/celda/copias/" in linea)
                  ]
                  assert privadas == [], privadas

              with subtest("las fichas se releen del archivo sin pedir nada al registro"):
                  antes = maquina.succeed("grep --count geoportal.minetur.gob.es /var/lib/fuentes-de-prueba/peticiones.log").strip()
                  relectura = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna releer-archivo 2>&1")
                  print(relectura)
                  fichas = len([campos for campos in geoportal if "/VCTEL/detalleEstacion.do" in campos[3]])
                  assert f"Fichas archivadas: {fichas}" in relectura, relectura
                  assert f"- leídas con la lectura de hoy: {fichas}," in relectura, relectura
                  despues = maquina.succeed("grep --count geoportal.minetur.gob.es /var/lib/fuentes-de-prueba/peticiones.log").strip()
                  assert antes == despues, (antes, despues)

              with subtest("el historial de cada registro da lo que publica la tabla de observaciones"):
                  comprobacion = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna comprobar-historial 2>&1")
                  print(comprobacion)
                  assert "Registros comprobados: 40, distintos: 0" in comprobacion, comprobacion

              with subtest("un build de Vercel que no llega a R2 falla sin escribir vigente.json"):
                  maquina.succeed("touch /var/lib/fuentes-de-prueba/r2-caido-para-el-build")
                  assert build_de_vercel("/var/lib/build-de-vercel/2/capas") != 0
                  maquina.fail("test -e /var/lib/build-de-vercel/2/capas/vigente.json")
                  maquina.succeed("rm /var/lib/fuentes-de-prueba/r2-caido-para-el-build")

              with subtest("la pasada por los cuadros de borde pide cada uno una vez y no toca la base"):
                  base = "/var/lib/celda-nocturna/ingesta.sqlite"
                  antes = maquina.succeed(f"sha256sum {base}")
                  listados = int(maquina.succeed("grep --count infoantenasGeoJSON.do /var/lib/fuentes-de-prueba/peticiones.log"))
                  print(maquina.succeed(
                      "systemd-run --wait --pipe --collect --quiet"
                      " --uid=celda-nocturna --gid=celda-nocturna"
                      " --setenv=NODE_EXTRA_CA_CERTS=${certificados}/ca.pem"
                      " /run/current-system/sw/bin/celda-nocturna cuadros-de-borde /var/lib/celda-nocturna/cuadros-de-borde.json 2>&1"
                  ))
                  pasada = json.loads(maquina.succeed("cat /var/lib/celda-nocturna/cuadros-de-borde.json"))
                  # Los cuatro cuadros que tocan España fuera de las zonas; en el Campus Nord no cae ninguno.
                  assert [c["cuadro"] for c in pasada["cuadros"]] == ["-17,27", "-19,28", "-4,35", "-8,40"], pasada
                  assert all(c["registros"] == 0 for c in pasada["cuadros"]), pasada
                  assert pasada["errores"] == [], pasada
                  despues = int(maquina.succeed("grep --count infoantenasGeoJSON.do /var/lib/fuentes-de-prueba/peticiones.log"))
                  assert despues - listados == 4, (listados, despues)
                  assert maquina.succeed(f"sha256sum {base}") == antes

              with subtest("el domingo, tras un sábado que lo leyó todo, la ejecución no pide nada al registro"):
                  antes = len(del_geoportal())
                  domingo = proximo_disparo()
                  assert es_domingo_siguiente(domingo), en_madrid(domingo)
                  disparar(domingo)
                  print(el_diario())
                  assert len(del_geoportal()) == antes, del_geoportal()[antes:]
                  assert "No hay nada que pedir al registro" in el_diario()
                  estado = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna estado")
                  print(estado)
                  assert "Próxima ejecución: el sábado " in estado, estado
                  assert "Empieza otra ronda, en la que barre su zona y lee todas las fichas" in estado, estado
                  assert "La próxima ejecución barre: cataluna" in estado, estado
                  assert es_primer_sabado(proximo_disparo()), en_madrid(proximo_disparo())

              with subtest("entre semana el temporizador no lanza nada"):
                  siguiente = proximo_disparo()
                  antes = acabadas()
                  # El miércoles después del domingo.
                  maquina.succeed(f"date --set=@{domingo + 3 * DIA}")
                  maquina.sleep(5)
                  assert proximo_disparo() == siguiente
                  assert acabadas() == antes
                  assert maquina.succeed("systemctl is-active celda-nocturna.service || true").strip() == "inactive"

              with subtest("si la fuente para la ejecución del sábado, la del domingo lo intenta una vez más, sin repetir ninguna ficha, y si vuelve a parar, lo que falta espera al mes siguiente"):
                  def fichas_desde(antes):
                      return [campos[3] for campos in del_geoportal()[antes:] if "/VCTEL/detalleEstacion.do" in campos[3]]

                  def listados_desde(antes):
                      return [campos[3] for campos in del_geoportal()[antes:] if "infoantenasGeoJSON.do" in campos[3]]

                  # El sábado del mes siguiente el geoportal da diez fichas y luego un 429.
                  maquina.succeed("echo 10 > /var/lib/fuentes-de-prueba/fichas-que-quedan")
                  antes = len(del_geoportal())
                  sabado = proximo_disparo()
                  assert es_primer_sabado(sabado), en_madrid(sabado)
                  disparar(sabado)
                  print(el_diario())
                  # Una ronda nueva: vuelve a barrer Cataluña y empieza a releer las fichas.
                  assert len(listados_desde(antes)) == 9, listados_desde(antes)
                  del_sabado = fichas_desde(antes)
                  assert len(del_sabado) == 11, del_sabado
                  assert "paradas: FuentePideEsperar: HTTP 429" in el_diario()
                  assert "Lo que queda de la ronda, 30 fichas, lo lee la ejecución del domingo" in el_diario()
                  estado = maquina.succeed("runuser --user=celda-nocturna -- celda-nocturna estado")
                  print(estado)
                  assert "Ahora quedan 30 fichas." in estado, estado
                  assert "Fichas paradas: FuentePideEsperar: HTTP 429" in estado, estado

                  # El domingo no barre y retoma las fichas por la que paró, y otra vez diez y un 429.
                  maquina.succeed("echo 10 > /var/lib/fuentes-de-prueba/fichas-que-quedan")
                  antes = len(del_geoportal())
                  disparar(proximo_disparo())
                  print(el_diario())
                  assert listados_desde(antes) == []
                  del_domingo = fichas_desde(antes)
                  assert len(del_domingo) == 11, del_domingo
                  assert del_domingo[0] == del_sabado[-1]
                  # Las veinte que se han leído en la ronda son distintas.
                  assert len(set(del_sabado[:10] + del_domingo[:10])) == 20
                  assert (
                      "Lo que queda de la ronda, 20 fichas, se queda sin leer este mes, porque no hay otra ejecución hasta la del sábado"
                      in el_diario()
                  )
                  assert es_primer_sabado(proximo_disparo()), en_madrid(proximo_disparo())
                  maquina.succeed("rm /var/lib/fuentes-de-prueba/fichas-que-quedan")

              with subtest("el servicio corre endurecido"):
                  print(maquina.succeed("systemd-analyze security celda-nocturna.service --no-pager"))

              with subtest("ningún secreto acaba en el almacén de Nix"):
                  for valor in (secreto, clave_de_publicacion_convex):
                      maquina.fail(f"systemctl show celda-nocturna.service | grep --fixed-strings '{valor}'")
                  assert "CELDA_RESERVA_ORIGEN" not in entorno, entorno
                  assert "CELDA_ALMACEN_ORIGEN=https://celda.prueba/capas" in entorno, entorno
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
                  for valor in (id_clave, secreto, id_de_lectura, secreto_de_lectura, clave_de_publicacion_convex):
                      encontrado = buscar(valor)
                      assert encontrado.returncode == 1, f"secreto en el almacén: {encontrado.stdout}"
            '';
        };
    };
}
