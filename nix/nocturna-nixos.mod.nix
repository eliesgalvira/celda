{ self, ... }:
{
  # El servicio de NixOS de la ingesta nocturna (ADR 0015). Genérico: la máquina, el horario, las
  # rutas y las credenciales los pone la configuración de quien lo usa (docs/patterns/nixos.md).
  flake.nixosModules.celda-nocturna =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (lib.attrsets) filterAttrs;
      inherit (lib.lists) optional singleton unique;
      inherit (lib.meta) getExe;
      inherit (lib.modules) mkIf mkRenamedOptionModule;
      inherit (lib.options) literalExpression mkEnableOption mkOption;
      inherit (lib.strings) concatStringsSep hasPrefix;
      inherit (lib.trivial) boolToString;
      inherit (lib.types)
        bool
        enum
        externalPath
        ints
        listOf
        nullOr
        package
        str
        strMatching
        ;

      # Las zonas de barrido del programa, `ZONAS_DE_BARRIDO` en packages/dominio/src/barrido.ts,
      # en su orden. Una prueba de apps/nocturna comprueba que son las mismas.
      zonasDeBarrido = [
        "cataluna"
        "centro"
        "andalucia"
        "levante"
        "norte"
        "ebro-y-duero"
        "oeste-y-canarias"
      ];

      zonaDeBarrido = enum zonasDeBarrido;

      # Una lista como la lee el programa: separada por comas, o `ninguna`.
      listaDelPrograma = zonas: if zonas == [ ] then "ninguna" else concatStringsSep "," zonas;
    in
    {
      imports =
        singleton
        <|
          mkRenamedOptionModule
            [ "services" "celda-nocturna" "registroOficial" "maxFichas" ]
            [ "services" "celda-nocturna" "registroOficial" "fichas" "maximo" ];

      options.services.celda-nocturna = {
        enable = mkEnableOption "la ingesta nocturna de Celda: el registro oficial, antenasmoviles.es si se enciende, la publicación y la copia de la base, una vez por noche";

        package = mkOption {
          type = package;
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.celda-nocturna;
          defaultText = literalExpression "celda.packages.\${pkgs.stdenv.hostPlatform.system}.celda-nocturna";
          description = "El paquete de la ingesta.";
        };

        horario = mkOption {
          type = str;
          default = "*-*-* 02:15:00 UTC";
          example = "*-*-* 04:30:00 Europe/Madrid";
          description = "Cuándo empieza la noche, en el formato de `OnCalendar=` de systemd (systemd.time(7)).";
        };

        recuperarNochesPerdidas = mkOption {
          type = bool;
          default = true;
          description = "Si la máquina estaba apagada a la hora de la noche, la lanza al encenderse (`Persistent=` del temporizador).";
        };

        tiempoMaximo = mkOption {
          type = str;
          default = "${
            toString (
              config.services.celda-nocturna.registroOficial.fichas.ventana
              + config.services.celda-nocturna.reintentoDePublicacion
              + 60
            )
          }min";
          defaultText = literalExpression ''"''${toString (registroOficial.fichas.ventana + reintentoDePublicacion + 60)}min"'';
          description = "Lo más que puede durar una noche (`TimeoutStartSec=`). Por defecto cubre la ventana de fichas, la espera antes de repetir una publicación fallida y una hora más; con los valores por defecto, 8 horas.";
        };

        directorioDeEstado = mkOption {
          type = strMatching "[^/].*";
          default = "celda-nocturna";
          description = "Directorio de la base dentro de `/var/lib`. Lo crea systemd (`StateDirectory=`) y la base es `ingesta.sqlite`.";
        };

        copias.directorio = mkOption {
          type = externalPath;
          default = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/copias";
          defaultText = literalExpression ''"/var/lib/''${config.services.celda-nocturna.directorioDeEstado}/copias"'';
          example = "/srv/copias/celda";
          description = "Dónde se guardan las copias de la base. Puede estar en otro disco: el servicio espera a que se monte, pero la noche corre aunque no se monte.";
        };

        copias.conservar = mkOption {
          type = ints.positive;
          default = 14;
          description = "Copias de la base que se conservan; las más viejas se borran.";
        };

        credenciales.r2 = mkOption {
          type = nullOr externalPath;
          default = null;
          example = "/etc/secretos/celda-r2.env";
          description = ''
            Fichero con las credenciales del cubo de R2, fuera del almacén de Nix y legible solo por
            root. Va en formato `.env`, con `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y
            `CELDA_R2_SECRETO`. systemd lo pasa al servicio como credencial (`LoadCredential=`). Sin
            él, la noche ingiere pero no publica.
          '';
        };

        credenciales.vercel = mkOption {
          type = nullOr externalPath;
          default = null;
          example = "/etc/secretos/celda-vercel.env";
          description = ''
            Fichero con el deploy hook del proyecto de Vercel (`CELDA_VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/…`),
            fuera del almacén de Nix y legible solo por root. Se pasa como la credencial de R2. Tras
            publicar, si la copia de reserva no sirve la versión vigente, la noche llama al hook y el
            build de Vercel copia esa versión de R2 (ADR 0010). Sin él, la copia no se toca.
          '';
        };

        origenPublico = mkOption {
          type = nullOr str;
          default = null;
          example = "https://capas.example.org";
          description = "URL pública desde la que la web lee lo publicado (`CELDA_ALMACEN_ORIGEN`). Se apunta en la base con cada versión.";
        };

        origenDeReserva = mkOption {
          type = nullOr str;
          default = null;
          example = "https://celda.example.org/capas";
          description = ''
            URL pública de la copia de reserva de Vercel (`CELDA_RESERVA_ORIGEN`). La noche lee su
            `vigente.json` y solo llama al deploy hook si no coincide con el de R2. Sin ella, cada
            noche con `credenciales.vercel` pide un despliegue.
          '';
        };

        reintentoDePublicacion = mkOption {
          type = ints.unsigned;
          default = 60;
          description = "Minutos de espera antes de repetir una publicación fallida la misma noche.";
        };

        registroOficial.enable = mkOption {
          type = bool;
          default = true;
          description = "Interruptor del registro oficial. Apagado, la noche apunta su ejecución como omitida y no le pide nada.";
        };

        registroOficial.motivo = mkOption {
          type = str;
          default = "apagado en la configuración de la ingesta";
          description = "Lo que se apunta en la ejecución si el registro oficial está apagado.";
        };

        registroOficial.pausa = mkOption {
          type = ints.between 3 3600;
          default = 3;
          description = "Segundos entre el final de una respuesta del listado y la petición siguiente. Nunca menos de 3. Las fichas van a su ritmo, `fichas.ritmo`.";
        };

        registroOficial.maxPeticiones = mkOption {
          type = ints.positive;
          default = 400;
          description = "Tope de peticiones del listado por noche, `robots.txt` y reintentos incluidos. Con el valor por defecto cabe toda España en una noche: unas 250 peticiones la primera vez y unas 215 después. Las fichas tienen el suyo: las que caben en su ventana.";
        };

        registroOficial.fichas.ritmo = mkOption {
          type = ints.between 3 3600;
          default = 3;
          description = "Segundos entre el final de una ficha y la petición de la siguiente (ADR 0014). Nunca menos de 3. Si el ministerio pide menos peticiones, se sube aquí.";
        };

        registroOficial.fichas.ventana = mkOption {
          type = ints.positive;
          default = 360;
          example = 120;
          description = "Minutos durante los que se leen fichas, desde que empieza la noche. Al cerrarse, las que quedan esperan a la noche siguiente. A una cada 3 s, 6 horas son unas 5.500 fichas.";
        };

        registroOficial.fichas.relectura = mkOption {
          type = ints.positive;
          default = 30;
          description = "Días tras los que se vuelve a leer una ficha ya leída.";
        };

        registroOficial.fichas.prioridad = mkOption {
          type = listOf <| strMatching "[0-9]{2}";
          default = [
            "08"
            "17"
            "25"
            "43"
          ];
          example = singleton "08";
          description = ''
            Provincias, por su código INE de dos cifras, cuyas fichas se leen antes que las de
            ninguna zona de barrido, en este orden. Después van las de cada zona de barrido, en el
            orden de `zonas` y `zonasEnTurno`, y al final las demás. Por defecto, Barcelona (08) y
            luego Girona, Lleida y Tarragona.
          '';
        };

        registroOficial.fichas.maximo = mkOption {
          type = nullOr ints.unsigned;
          default = null;
          example = 250;
          description = "Tope de fichas por noche. Sin él, se leen hasta cerrar la ventana; con 0 solo se lee el listado.";
        };

        registroOficial.reintentos = mkOption {
          type = ints.unsigned;
          default = 3;
          description = "Reintentos de un fallo pasajero, con espera exponencial.";
        };

        registroOficial.espera = mkOption {
          type = ints.positive;
          default = 10;
          description = "Segundos que se espera una respuesta antes de darla por fallida.";
        };

        registroOficial.zonas = mkOption {
          type = listOf zonaDeBarrido;
          default = [ ];
          example = singleton "cataluna";
          description = ''
            Zonas de barrido del listado que se barren todas las noches (ADR 0014). Por defecto
            ninguna: todas se turnan. Cataluña son 9 cuadros de 1° y unas 30 peticiones cada noche.
          '';
        };

        registroOficial.zonasEnTurno = mkOption {
          type = listOf zonaDeBarrido;
          default = zonasDeBarrido;
          example = [
            "centro"
            "andalucia"
            "levante"
            "norte"
            "ebro-y-duero"
            "oeste-y-canarias"
          ];
          description = ''
            Zonas de barrido que se turnan: cada noche se barren `zonasPorNoche` de ellas, primero
            la que quedó a medias, luego las que nunca se han completado, en este orden, y luego las
            que llevan más tiempo sin barrer. Una zona que también está en `zonas` se barre todas
            las noches. Por defecto, las siete: toda España en siete noches, unas 31 peticiones cada
            una.
          '';
        };

        registroOficial.zonasPorNoche = mkOption {
          type = ints.unsigned;
          default = 1;
          example = 7;
          description = "Cuántas de las zonas que se turnan se barren cada noche. Con 7 y las zonas por defecto, toda España cada noche: unas 215 peticiones y 15 minutos.";
        };

        registroOficial.userAgent = mkOption {
          type = str;
          default = "Celda (ingesta; contacto en celda.elies.site)";
          example = "Celda (ingesta; contacto en ejemplo.org)";
          description = "Se envía en cada petición. Su primer producto es el nombre con el que se busca a la ingesta en `robots.txt`. Si montas tu propia ingesta, pon tu contacto.";
        };

        antenasmoviles.enable = mkEnableOption ''
          antenasmoviles.es: su listado una vez por noche y el detalle de las ER5 pendientes. Déjalo
          apagado hasta escribir a su administrador (docs/investigacion/fuentes-comunitarias.md);
          apagado, la noche apunta su ejecución como omitida y no le pide nada
        '';

        antenasmoviles.motivo = mkOption {
          type = str;
          default = "apagado por defecto hasta escribir a su administrador antes de publicar sus datos";
          description = "Lo que se apunta en la ejecución si antenasmoviles.es está apagado.";
        };

        antenasmoviles.pausa = mkOption {
          type = ints.between 5 3600;
          default = 5;
          description = "Segundos entre el final de una respuesta y la petición siguiente. Nunca menos de 5: es una web sin ánimo de lucro.";
        };

        antenasmoviles.maxDetalles = mkOption {
          type = ints.unsigned;
          default = 100;
          description = ''
            Detalles de ER5 que se leen cada noche, como mucho. Solo se leen los de las ER5 nuevas o
            cambiadas en el listado, sin repaso de las ya leídas. Con 0 solo se lee el listado.
          '';
        };

        antenasmoviles.maxPeticiones = mkOption {
          type = ints.positive;
          default = config.services.celda-nocturna.antenasmoviles.maxDetalles + 10;
          defaultText = literalExpression "config.services.celda-nocturna.antenasmoviles.maxDetalles + 10";
          description = "Tope de peticiones por noche, `robots.txt`, el listado y reintentos incluidos.";
        };

        antenasmoviles.zonas = mkOption {
          type = listOf zonaDeBarrido;
          default = unique (
            config.services.celda-nocturna.registroOficial.zonas
            ++ config.services.celda-nocturna.registroOficial.zonasEnTurno
          );
          defaultText = literalExpression "unique (config.services.celda-nocturna.registroOficial.zonas ++ config.services.celda-nocturna.registroOficial.zonasEnTurno)";
          example = singleton "cataluna";
          description = ''
            Zonas de barrido cuyos marcadores se guardan. El listado es de toda España y se pide una
            vez por noche, así que todas se barren cada noche. Un marcador que falta en dos barridos
            seguidos de su zona se retira.
          '';
        };

        antenasmoviles.userAgent = mkOption {
          type = str;
          default = config.services.celda-nocturna.registroOficial.userAgent;
          defaultText = literalExpression "config.services.celda-nocturna.registroOficial.userAgent";
          description = "Se envía en cada petición a antenasmoviles.es.";
        };
      };

      config = {
        warnings =
          optional
            (
              config.services.celda-nocturna.enable
              && config.services.celda-nocturna.origenDeReserva != null
              && config.services.celda-nocturna.credenciales.vercel == null
            )
            "services.celda-nocturna.origenDeReserva no hace nada sin credenciales.vercel: la noche no puede desplegar la copia de reserva.";

        users.users.celda-nocturna = mkIf config.services.celda-nocturna.enable {
          description = "Ingesta nocturna de Celda";
          group = "celda-nocturna";
          isSystemUser = true;
        };

        users.groups.celda-nocturna = mkIf config.services.celda-nocturna.enable { };

        # La orden con la configuración de esta máquina y sin credenciales, para lanzarla como el
        # usuario del servicio: sudo --user=celda-nocturna celda-nocturna estado
        environment.systemPackages =
          mkIf config.services.celda-nocturna.enable
          <| singleton
          <| pkgs.writeShellApplication {
            name = "celda-nocturna";
            runtimeEnv = filterAttrs (
              nombre: _: hasPrefix "CELDA_" nombre
            ) config.systemd.services.celda-nocturna.environment;
            text = /* bash */ ''
              exec ${getExe config.services.celda-nocturna.package} "$@"
            '';
          };

        # Un directorio de copias fuera del de estado lo crea tmpfiles, con el dueño del servicio.
        systemd.tmpfiles.settings.celda-nocturna =
          mkIf
            (
              config.services.celda-nocturna.enable
              && !hasPrefix "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/" config.services.celda-nocturna.copias.directorio
            )
            {
              ${config.services.celda-nocturna.copias.directorio}.d = {
                group = "celda-nocturna";
                mode = "0750";
                user = "celda-nocturna";
              };
            };

        systemd.services.celda-nocturna = mkIf config.services.celda-nocturna.enable {
          description = "Ingesta nocturna de Celda";

          after = singleton "network-online.target";
          wants = singleton "network-online.target";

          # Espera al disco de copias si lo hay, sin depender de él.
          unitConfig.WantsMountsFor = config.services.celda-nocturna.copias.directorio;

          environment = {
            CELDA_ALMACEN_ORIGEN = mkIf (
              config.services.celda-nocturna.origenPublico != null
            ) config.services.celda-nocturna.origenPublico;
            CELDA_ANTENASMOVILES_ACTIVO = boolToString config.services.celda-nocturna.antenasmoviles.enable;
            CELDA_ANTENASMOVILES_MAX_DETALLES = toString config.services.celda-nocturna.antenasmoviles.maxDetalles;
            CELDA_ANTENASMOVILES_MAX_PETICIONES = toString config.services.celda-nocturna.antenasmoviles.maxPeticiones;
            CELDA_ANTENASMOVILES_MOTIVO = config.services.celda-nocturna.antenasmoviles.motivo;
            CELDA_ANTENASMOVILES_PAUSA_SEGUNDOS = toString config.services.celda-nocturna.antenasmoviles.pausa;
            CELDA_ANTENASMOVILES_USER_AGENT = config.services.celda-nocturna.antenasmoviles.userAgent;
            CELDA_ANTENASMOVILES_ZONAS = listaDelPrograma config.services.celda-nocturna.antenasmoviles.zonas;
            CELDA_INGESTA_BASE = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/ingesta.sqlite";
            CELDA_INGESTA_COPIAS = config.services.celda-nocturna.copias.directorio;
            CELDA_INGESTA_COPIAS_CONSERVADAS = toString config.services.celda-nocturna.copias.conservar;
            CELDA_INGESTA_MAX_FICHAS =
              mkIf (config.services.celda-nocturna.registroOficial.fichas.maximo != null)
              <| toString config.services.celda-nocturna.registroOficial.fichas.maximo;
            CELDA_PUBLICAR_REINTENTO_MINUTOS = toString config.services.celda-nocturna.reintentoDePublicacion;
            CELDA_RESERVA_ORIGEN = mkIf (
              config.services.celda-nocturna.origenDeReserva != null
            ) config.services.celda-nocturna.origenDeReserva;
            CELDA_REGISTRO_ACTIVO = boolToString config.services.celda-nocturna.registroOficial.enable;
            CELDA_REGISTRO_ESPERA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.espera;
            CELDA_REGISTRO_FICHAS_PRIORIDAD = listaDelPrograma config.services.celda-nocturna.registroOficial.fichas.prioridad;
            CELDA_REGISTRO_FICHAS_RELECTURA_DIAS = toString config.services.celda-nocturna.registroOficial.fichas.relectura;
            CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.fichas.ritmo;
            CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS = toString config.services.celda-nocturna.registroOficial.fichas.ventana;
            CELDA_REGISTRO_MAX_PETICIONES = toString config.services.celda-nocturna.registroOficial.maxPeticiones;
            CELDA_REGISTRO_MOTIVO = config.services.celda-nocturna.registroOficial.motivo;
            CELDA_REGISTRO_PAUSA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.pausa;
            CELDA_REGISTRO_REINTENTOS = toString config.services.celda-nocturna.registroOficial.reintentos;
            CELDA_REGISTRO_USER_AGENT = config.services.celda-nocturna.registroOficial.userAgent;
            CELDA_REGISTRO_ZONAS = listaDelPrograma config.services.celda-nocturna.registroOficial.zonas;
            CELDA_REGISTRO_ZONAS_EN_TURNO = listaDelPrograma config.services.celda-nocturna.registroOficial.zonasEnTurno;
            CELDA_REGISTRO_ZONAS_POR_NOCHE = toString config.services.celda-nocturna.registroOficial.zonasPorNoche;
          };

          serviceConfig = {
            ExecStart = "${getExe config.services.celda-nocturna.package} noche";
            Type = "oneshot";
            TimeoutStartSec = config.services.celda-nocturna.tiempoMaximo;

            # USUARIO Y DIRECTORIOS
            Group = "celda-nocturna";
            User = "celda-nocturna";
            UMask = "0027";

            ReadWritePaths = singleton "-${config.services.celda-nocturna.copias.directorio}";
            StateDirectory = config.services.celda-nocturna.directorioDeEstado;
            StateDirectoryMode = "0750";
            WorkingDirectory = "%S/${config.services.celda-nocturna.directorioDeEstado}";

            # CREDENCIALES
            LoadCredential =
              optional (
                config.services.celda-nocturna.credenciales.r2 != null
              ) "r2:${config.services.celda-nocturna.credenciales.r2}"
              ++ optional (
                config.services.celda-nocturna.credenciales.vercel != null
              ) "vercel:${config.services.celda-nocturna.credenciales.vercel}";

            # ENDURECIMIENTO
            # Sin MemoryDenyWriteExecute: el compilador de V8 escribe y ejecuta su código.
            AmbientCapabilities = "";
            CapabilityBoundingSet = "";
            LockPersonality = true;
            NoNewPrivileges = true;
            PrivateDevices = true;
            PrivateTmp = true;
            PrivateUsers = true;
            ProcSubset = "pid";
            ProtectClock = true;
            ProtectControlGroups = true;
            ProtectHome = true;
            ProtectHostname = true;
            ProtectKernelLogs = true;
            ProtectKernelModules = true;
            ProtectKernelTunables = true;
            ProtectProc = "invisible";
            ProtectSystem = "strict";
            RemoveIPC = true;
            RestrictNamespaces = true;
            RestrictRealtime = true;
            RestrictSUIDSGID = true;
            SystemCallArchitectures = "native";
            SystemCallFilter = [
              "@system-service"
              "~@privileged"
              "~@resources"
            ];

            # RED
            # Solo IP. Sin sockets locales, los nombres se resuelven con /etc/hosts y el DNS de
            # /etc/resolv.conf, sin pasar por nscd.
            RestrictAddressFamilies = [
              "AF_INET"
              "AF_INET6"
            ];
          };
        };

        systemd.timers.celda-nocturna = mkIf config.services.celda-nocturna.enable {
          description = "Noche de la ingesta de Celda";

          wantedBy = singleton "timers.target";

          timerConfig = {
            OnCalendar = config.services.celda-nocturna.horario;
            Persistent = config.services.celda-nocturna.recuperarNochesPerdidas;
          };
        };
      };
    };
}
