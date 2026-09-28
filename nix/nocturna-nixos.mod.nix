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
      inherit (lib.lists) optional singleton;
      inherit (lib.meta) getExe;
      inherit (lib.modules) mkIf;
      inherit (lib.options) literalExpression mkEnableOption mkOption;
      inherit (lib.strings) hasPrefix;
      inherit (lib.trivial) boolToString;
      inherit (lib.types)
        bool
        externalPath
        ints
        nullOr
        package
        str
        strMatching
        ;
    in
    {
      options.services.celda-nocturna = {
        enable = mkEnableOption "la ingesta nocturna de Celda: el registro oficial, la publicación y la copia de la base, una vez por noche";

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
          default = "8h";
          description = "Lo más que puede durar una noche (`TimeoutStartSec=`). Cubre la ventana de fichas de 6 horas y la hora de espera antes de repetir una publicación fallida.";
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
          description = "Fichero con el deploy hook de Vercel (`CELDA_VERCEL_DEPLOY_HOOK=…`), fuera del almacén de Nix y legible solo por root. Se pasa como la credencial de R2.";
        };

        origenPublico = mkOption {
          type = nullOr str;
          default = null;
          example = "https://capas.example.org";
          description = "URL pública desde la que la web lee lo publicado (`CELDA_ALMACEN_ORIGEN`). Se apunta en la base con cada versión.";
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
          description = "Segundos entre el final de una respuesta y la petición siguiente. Nunca menos de 3.";
        };

        registroOficial.maxPeticiones = mkOption {
          type = ints.positive;
          default = 300;
          description = "Tope de peticiones por noche, `robots.txt` y reintentos incluidos.";
        };

        registroOficial.maxFichas = mkOption {
          type = ints.unsigned;
          default = 250;
          description = "Fichas que se leen cada noche. Con 0 solo se lee el listado.";
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

        registroOficial.userAgent = mkOption {
          type = str;
          default = "Celda (ingesta; contacto en celda.elies.site)";
          example = "Celda (ingesta; contacto en ejemplo.org)";
          description = "Se envía en cada petición. Su primer producto es el nombre con el que se busca a la ingesta en `robots.txt`. Si montas tu propia ingesta, pon tu contacto.";
        };
      };

      config = {
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
            CELDA_INGESTA_BASE = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/ingesta.sqlite";
            CELDA_INGESTA_COPIAS = config.services.celda-nocturna.copias.directorio;
            CELDA_INGESTA_COPIAS_CONSERVADAS = toString config.services.celda-nocturna.copias.conservar;
            CELDA_INGESTA_MAX_FICHAS = toString config.services.celda-nocturna.registroOficial.maxFichas;
            CELDA_PUBLICAR_REINTENTO_MINUTOS = toString config.services.celda-nocturna.reintentoDePublicacion;
            CELDA_REGISTRO_ACTIVO = boolToString config.services.celda-nocturna.registroOficial.enable;
            CELDA_REGISTRO_ESPERA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.espera;
            CELDA_REGISTRO_MAX_PETICIONES = toString config.services.celda-nocturna.registroOficial.maxPeticiones;
            CELDA_REGISTRO_MOTIVO = config.services.celda-nocturna.registroOficial.motivo;
            CELDA_REGISTRO_PAUSA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.pausa;
            CELDA_REGISTRO_REINTENTOS = toString config.services.celda-nocturna.registroOficial.reintentos;
            CELDA_REGISTRO_USER_AGENT = config.services.celda-nocturna.registroOficial.userAgent;
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
