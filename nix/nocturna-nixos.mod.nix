{ self, ... }:
{
  # El servicio de NixOS de la ingesta (ADR 0015 y 0029): una ejecución el primer sábado de cada
  # mes y otra el domingo siguiente, que solo lee lo que la del sábado dejó pendiente. Genérico: la
  # máquina, las rutas y las credenciales los pone la configuración de quien lo usa
  # (docs/patterns/nixos.md).
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
      inherit (lib.modules) mkIf mkRemovedOptionModule mkRenamedOptionModule;
      inherit (lib.options) literalExpression mkEnableOption mkOption;
      inherit (lib.strings) concatStringsSep hasPrefix splitString toIntBase10;
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

      cfg = config.services.celda-nocturna;

      # La hora de cada ejecución, en minutos desde la medianoche.
      minutoDelDia =
        let
          partes = map toIntBase10 (splitString ":" cfg.hora);
        in
        builtins.elemAt partes 0 * 60 + builtins.elemAt partes 1;

      # Minutos que puede llegar tarde un disparo del temporizador y que la ejecución corra.
      holgura = 15;

      # Solo deja correr un disparo del temporizador el primer sábado de cada mes o el domingo
      # siguiente, y a su hora (`ExecCondition=`). Con `Persistent=` apagado, un disparo tardío solo
      # llega tras una suspensión o un salto del reloj, y uno entre semana iría contra el ADR 0029.
      # Una ejecución lanzada a mano corre cualquier día.
      aSuHora = pkgs.writeShellApplication {
        name = "celda-nocturna-a-su-hora";
        runtimeInputs = singleton pkgs.coreutils;
        runtimeEnv.TZDIR = "${pkgs.tzdata}/share/zoneinfo";
        text = /* bash */ ''
          if [ -z "''${TRIGGER_UNIT:-}" ]; then
            exit 0
          fi
          read -r dia fecha horas minutos < <(TZ=${cfg.zonaHoraria} date '+%u %-d %-H %-M')
          ahora=$((horas * 60 + minutos))
          if { { [ "$dia" = 6 ] && [ "$fecha" -le 7 ]; } || { [ "$dia" = 7 ] && [ "$fecha" -ge 2 ] && [ "$fecha" -le 8 ]; }; } \
            && [ "$ahora" -ge ${toString minutoDelDia} ] && [ "$ahora" -lt ${toString (minutoDelDia + holgura)} ]; then
            exit 0
          fi
          printf 'El temporizador se ha disparado el día %s a las %02d:%02d (%s), quizá tras una suspensión o un salto del reloj. La ingesta solo corre el primer sábado de cada mes y el domingo siguiente a las %s, así que espera al disparo siguiente.\n' \
            "$fecha" "$horas" "$minutos" ${cfg.zonaHoraria} ${cfg.hora}
          exit 1
        '';
      };
    in
    {
      imports = [
        (mkRenamedOptionModule
          [ "services" "celda-nocturna" "registroOficial" "maxFichas" ]
          [ "services" "celda-nocturna" "registroOficial" "fichas" "maximo" ]
        )
        # Las capas se sirven solo desde Vercel (ADR 0018): su URL es la de `origenPublico`.
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "origenDeReserva" ]
          "Las capas se sirven solo desde Vercel (ADR 0018): pon su URL, https://celda.elies.site/capas, en services.celda-nocturna.origenPublico."
        )
        # Una ejecución al mes, el primer fin de semana (ADR 0029).
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "horario" ]
          "La ingesta corre el primer sábado de cada mes y el domingo siguiente (ADR 0029). Quita horario: la hora va en services.celda-nocturna.hora (00:30 por defecto) y su zona horaria en services.celda-nocturna.zonaHoraria (Europe/Madrid por defecto)."
        )
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "recuperarNochesPerdidas" ]
          "Una ejecución perdida ya no se recupera al encender la máquina, para no correr entre semana (ADR 0029): si la máquina está apagada el sábado, la ejecución la hace el domingo, y si tampoco, espera al mes siguiente."
        )
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "registroOficial" "fichas" "relectura" ]
          "Cada ejecución lee las fichas que no se han leído en el último día y medio (ADR 0029): la del primer sábado del mes, todas, y la del domingo, las que dejó la del sábado."
        )
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "registroOficial" "fichas" "prioridad" ]
          "Las fichas van en el mismo orden en toda España, sin provincias por delante (ADR 0029): primero las nuevas y las de listado cambiado, y luego de la leída hace más tiempo a la más reciente."
        )
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "registroOficial" "zonasEnTurno" ]
          "Cada ejecución barre todas las zonas de services.celda-nocturna.registroOficial.zonas, las siete por defecto (ADR 0029). Las zonas ya no se turnan."
        )
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "registroOficial" "zonasPorNoche" ]
          "Cada ejecución barre todas las zonas de services.celda-nocturna.registroOficial.zonas, las siete por defecto (ADR 0029). Las zonas ya no se turnan."
        )
        # El despliegue lo lanza un flujo de GitHub Actions (ADR 0018, #84).
        (mkRemovedOptionModule
          [ "services" "celda-nocturna" "credenciales" "vercel" ]
          "Despliega un flujo de GitHub Actions, y la ingesta ya no lanza ningún build de Vercel (ADR 0018). Quita services.celda-nocturna.credenciales.vercel y borra de la máquina el fichero del deploy hook."
        )
      ];

      options.services.celda-nocturna = {
        enable = mkEnableOption "la ingesta de Celda: el registro oficial, la publicación y la copia de la base, el primer sábado de cada mes y, si queda algo pendiente, el domingo siguiente";

        package = mkOption {
          type = package;
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.celda-nocturna;
          defaultText = literalExpression "celda.packages.\${pkgs.stdenv.hostPlatform.system}.celda-nocturna";
          description = "El paquete de la ingesta.";
        };

        hora = mkOption {
          type = strMatching "([01][0-9]|2[0-3]):[0-5][0-9]";
          default = "00:30";
          example = "01:00";
          description = ''
            A qué hora empieza cada ejecución, `HH:MM`, en `zonaHoraria`. El temporizador lanza una
            el primer sábado de cada mes y otra el domingo siguiente, que solo pide al registro lo
            que la del sábado dejó pendiente (ADR 0029). Una ejecución tiene que acabar el mismo
            día: la hora, `tiempoMaximo` y 15 minutos de margen no pueden pasar de la medianoche.
          '';
        };

        zonaHoraria = mkOption {
          type = str;
          default = "Europe/Madrid";
          example = "Atlantic/Canary";
          description = "Zona horaria de `hora` y de los días de cada ejecución, de la base de datos de la IANA.";
        };

        tiempoMaximo = mkOption {
          type = ints.positive;
          default =
            config.services.celda-nocturna.registroOficial.fichas.ventana
            + config.services.celda-nocturna.reintentoDePublicacion
            + 15;
          defaultText = literalExpression "registroOficial.fichas.ventana + reintentoDePublicacion + 15";
          description = ''
            Minutos que puede durar una ejecución (`TimeoutStartSec=`). Por defecto cubre la ventana
            de fichas, la espera antes de repetir una publicación fallida y un cuarto de hora para
            publicar, copiar la base y subir el archivo de páginas: 23 h 15 min con los valores por
            defecto, así que la ejecución de las 00:30 acaba antes de las 23:45.
          '';
        };

        directorioDeEstado = mkOption {
          type = strMatching "[^/].*";
          default = "celda-nocturna";
          description = "Directorio de la base dentro de `/var/lib`. Lo crea systemd (`StateDirectory=`). La base es `ingesta.sqlite`, y el archivo de páginas del registro, `archivo.sqlite` (ADR 0027).";
        };

        copias.directorio = mkOption {
          type = externalPath;
          default = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/copias";
          defaultText = literalExpression ''"/var/lib/''${config.services.celda-nocturna.directorioDeEstado}/copias"'';
          example = "/srv/copias/celda";
          description = "Dónde se guardan las copias de la base y, en su carpeta `archivo`, los paquetes del archivo de páginas (ADR 0027). Puede estar en otro disco: el servicio espera a que se monte, pero la ejecución corre aunque no se monte.";
        };

        copias.conservar = mkOption {
          type = ints.positive;
          default = 14;
          description = "Copias de la base que se conservan en `copias.directorio` y, con `credenciales.r2`, también en R2; las más viejas se borran.";
        };

        credenciales.r2 = mkOption {
          type = nullOr externalPath;
          default = null;
          example = "/etc/secretos/celda-r2.env";
          description = ''
            Fichero con las credenciales del cubo privado de R2, fuera del almacén de Nix y legible
            solo por root. Va en formato `.env`, con `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`,
            `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`, de una clave que puede escribir en el cubo.
            systemd lo pasa al servicio como credencial (`LoadCredential=`). Cada ejecución publica
            ahí, sube a `copias/` la copia comprimida de la base (ADR 0018) y a `archivo/` los
            paquetes del archivo de páginas que aún no están (ADR 0027). Sin él, la ejecución
            ingiere pero no publica, y la copia y los paquetes se quedan en `copias.directorio`.
          '';
        };

        credenciales.convex = mkOption {
          type = nullOr externalPath;
          default = null;
          example = "/etc/secretos/celda-convex.env";
          description = ''
            Fichero con la conexión con el buzón de Convex (ADR 0020), fuera del almacén de Nix y
            legible solo por root. Va en formato `.env`, con `CELDA_CONVEX_SITE_URL` (las acciones
            HTTP del despliegue, `https://<nombre>.convex.site`) y `CELDA_PUBLICACION_CLAVE` (la
            misma que la variable de entorno del despliegue). Esa clave solo abre la acción que da lo
            aceptado, sin identidades ni huellas de IP. Nunca pongas aquí una clave de despliegue de
            Convex: lo puede todo. Se pasa como la credencial de R2. Cada ejecución lee de ahí lo
            aceptado en la moderación desde la última vez y lo publica en las fichas. Si Convex no
            contesta, publica lo demás y lo dice en el diario. Sin él, la comunidad queda apagada y
            no se publica ninguna corrección.
          '';
        };

        origenPublico = mkOption {
          type = nullOr str;
          default = null;
          example = "https://celda.example.org/capas";
          description = "URL pública de las capas, las de la web en Vercel (`CELDA_ALMACEN_ORIGEN`). Se apunta en la base con cada versión.";
        };

        reintentoDePublicacion = mkOption {
          type = ints.unsigned;
          default = 60;
          description = "Minutos de espera antes de repetir una publicación fallida en la misma ejecución.";
        };

        memoria.monton = mkOption {
          type = ints.positive;
          default = 512;
          description = ''
            Megabytes del montón de V8 (`--max-old-space-size`). Sin límite, V8 deja crecer el
            montón con la basura de la publicación y la ejecución llega a 2 GB de RSS con toda
            España. Con 512, una ronda entera, las siete zonas y todas las fichas, cabe con margen
            (ADR 0029). Si una ejecución acaba sin memoria, súbelo.
          '';
        };

        memoria.alta = mkOption {
          type = str;
          default = "${toString (config.services.celda-nocturna.memoria.monton * 2)}M";
          defaultText = literalExpression ''"''${toString (memoria.monton * 2)}M"'';
          description = "A partir de cuánta memoria systemd frena el servicio y le quita páginas (`MemoryHigh=`). Por defecto, el doble del montón: 1024M.";
        };

        memoria.maxima = mkOption {
          type = str;
          default = "${toString (config.services.celda-nocturna.memoria.monton * 3)}M";
          defaultText = literalExpression ''"''${toString (memoria.monton * 3)}M"'';
          description = "Lo más que puede usar el servicio antes de que systemd lo pare (`MemoryMax=`). Por defecto, el triple del montón: 1536M.";
        };

        registroOficial.enable = mkOption {
          type = bool;
          default = true;
          description = "Interruptor del registro oficial. Apagado, su ejecución queda omitida y no le pide nada.";
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
          description = "Tope de peticiones del listado por ejecución, `robots.txt` y reintentos incluidos. Con el valor por defecto cabe toda España en una: unas 250 peticiones la primera vez y unas 215 después. Las fichas tienen el suyo: las que caben en su ventana.";
        };

        registroOficial.fichas.ritmo = mkOption {
          type = ints.between 1 3600;
          default = 1;
          example = 3;
          description = "Segundos entre el final de una ficha y la petición de la siguiente (ADR 0014 y 0029). Nunca menos de 1, y siempre de una en una. A 1 s, con el geoportal contestando en unos 0,1 s, sale una cada 1,1 s, y las de toda España caben en una ejecución. Si el ministerio pide menos peticiones, se sube aquí, y lo que no quepa lo lee la ejecución del domingo o la del mes siguiente.";
        };

        registroOficial.fichas.ventana = mkOption {
          type = ints.positive;
          default = 1320;
          example = 120;
          description = "Minutos durante los que se leen fichas, desde que empieza la ejecución. Al cerrarse, las que quedan las lee la ejecución del domingo, o la del mes siguiente si ya era la del domingo. Con 22 horas a una cada 1,1 s caben unas 72.000, más que las unas 69.700 de España.";
        };

        registroOficial.fichas.maximo = mkOption {
          type = nullOr ints.unsigned;
          default = null;
          example = 250;
          description = "Tope de fichas por ejecución. Sin él, se leen hasta cerrar la ventana; con 0 solo se lee el listado.";
        };

        registroOficial.cambioMasivo.porCiento = mkOption {
          type = ints.unsigned;
          default = 20;
          example = 100;
          description = ''
            Parte de las observaciones vigentes de un cuadro o de una zona, en tanto por ciento,
            que puede cambiar en una ejecución (altas, cambios y estaciones que faltan) antes de que
            la ejecución se pare sin guardar ese cuadro, sin contar ausencias y sin publicar (ADR
            0027). Si el cambio es de verdad, se sube a 100 en una ejecución y se vuelve a bajar.
          '';
        };

        registroOficial.cambioMasivo.minimo = mkOption {
          type = ints.unsigned;
          default = 50;
          description = "Por debajo de cuántos cambios en un cuadro o en una zona nunca se para la ejecución, sea cual sea la parte.";
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
          default = zonasDeBarrido;
          example = singleton "cataluna";
          description = ''
            Zonas de barrido del listado de cada ronda (ADR 0014 y 0029), en este orden. La
            ejecución del primer sábado del mes las barre todas y la del domingo, las que el sábado
            no completó. Por defecto, las siete: toda España, unas 215 peticiones a una cada 3 s,
            unos 11 minutos.
          '';
        };

        registroOficial.userAgent = mkOption {
          type = str;
          default = "Celda (ingesta; contacto en celda.elies.site)";
          example = "Celda (ingesta; contacto en ejemplo.org)";
          description = "Se envía en cada petición. Su primer producto es el nombre con el que se busca a la ingesta en `robots.txt`. Si montas tu propia ingesta, pon tu contacto.";
        };
      };

      config = {
        assertions = singleton {
          assertion = !cfg.enable || minutoDelDia + holgura + cfg.tiempoMaximo <= 24 * 60;
          message = ''
            services.celda-nocturna: una ejecución que empieza a las ${cfg.hora} y dura hasta ${toString cfg.tiempoMaximo} minutos (tiempoMaximo) acabaría al día siguiente. Tiene que acabar el mismo día, con ${toString holgura} minutos de margen, para no correr entre semana ni pisar la del domingo (ADR 0029): adelanta services.celda-nocturna.hora o acorta registroOficial.fichas.ventana.
          '';
        };

        users.users.celda-nocturna = mkIf config.services.celda-nocturna.enable {
          description = "Ingesta de Celda";
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
          description = "Ingesta de Celda, el primer fin de semana de cada mes";

          after = singleton "network-online.target";
          wants = singleton "network-online.target";

          # Espera al disco de copias si lo hay, sin depender de él.
          unitConfig.WantsMountsFor = config.services.celda-nocturna.copias.directorio;

          # Una configuración nueva vale desde la ejecución siguiente. Activarla no corta la que
          # está corriendo ni deja `nixos-rebuild switch` esperando horas a que acabe la que
          # arrancaría otra vez. Sin reinicio, `stopIfChanged` no se usa. Cómo aplicarla ya, en
          # docs/patterns/nixos.md.
          restartIfChanged = false;

          environment = {
            CELDA_ALMACEN_ORIGEN = mkIf (
              config.services.celda-nocturna.origenPublico != null
            ) config.services.celda-nocturna.origenPublico;
            CELDA_INGESTA_ARCHIVO = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/archivo.sqlite";
            CELDA_INGESTA_BASE = "/var/lib/${config.services.celda-nocturna.directorioDeEstado}/ingesta.sqlite";
            CELDA_INGESTA_COPIAS = config.services.celda-nocturna.copias.directorio;
            CELDA_INGESTA_COPIAS_CONSERVADAS = toString config.services.celda-nocturna.copias.conservar;
            CELDA_INGESTA_HORA = config.services.celda-nocturna.hora;
            CELDA_INGESTA_MAX_FICHAS =
              mkIf (config.services.celda-nocturna.registroOficial.fichas.maximo != null)
              <| toString config.services.celda-nocturna.registroOficial.fichas.maximo;
            CELDA_INGESTA_ZONA_HORARIA = config.services.celda-nocturna.zonaHoraria;
            CELDA_PUBLICAR_REINTENTO_MINUTOS = toString config.services.celda-nocturna.reintentoDePublicacion;
            CELDA_REGISTRO_ACTIVO = boolToString config.services.celda-nocturna.registroOficial.enable;
            CELDA_REGISTRO_CAMBIO_MASIVO_MINIMO = toString config.services.celda-nocturna.registroOficial.cambioMasivo.minimo;
            CELDA_REGISTRO_CAMBIO_MASIVO_POR_CIENTO = toString config.services.celda-nocturna.registroOficial.cambioMasivo.porCiento;
            CELDA_REGISTRO_ESPERA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.espera;
            CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.fichas.ritmo;
            CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS = toString config.services.celda-nocturna.registroOficial.fichas.ventana;
            CELDA_REGISTRO_MAX_PETICIONES = toString config.services.celda-nocturna.registroOficial.maxPeticiones;
            CELDA_REGISTRO_MOTIVO = config.services.celda-nocturna.registroOficial.motivo;
            CELDA_REGISTRO_PAUSA_SEGUNDOS = toString config.services.celda-nocturna.registroOficial.pausa;
            CELDA_REGISTRO_REINTENTOS = toString config.services.celda-nocturna.registroOficial.reintentos;
            CELDA_REGISTRO_USER_AGENT = config.services.celda-nocturna.registroOficial.userAgent;
            CELDA_REGISTRO_ZONAS = listaDelPrograma config.services.celda-nocturna.registroOficial.zonas;
            NODE_OPTIONS = "--max-old-space-size=${toString config.services.celda-nocturna.memoria.monton}";
          };

          serviceConfig = {
            ExecCondition = getExe aSuHora;
            ExecStart = "${getExe config.services.celda-nocturna.package} noche";
            Type = "oneshot";
            TimeoutStartSec = "${toString config.services.celda-nocturna.tiempoMaximo}min";

            # MEMORIA
            # El montón de V8 va en NODE_OPTIONS; esto es el techo de todo el proceso, con margen
            # sobre lo medido con el montón a 512 MB en una ronda entera (ADR 0029).
            MemoryHigh = config.services.celda-nocturna.memoria.alta;
            MemoryMax = config.services.celda-nocturna.memoria.maxima;

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
                config.services.celda-nocturna.credenciales.convex != null
              ) "convex:${config.services.celda-nocturna.credenciales.convex}";

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

        # El primer sábado de cada mes, que cae entre el 1 y el 7, y el domingo siguiente, entre el
        # 2 y el 8. Sin `Persistent=`: una ejecución perdida con la máquina apagada no se recupera
        # al encenderla, que podría ser entre semana. La del domingo la sustituye.
        systemd.timers.celda-nocturna = mkIf config.services.celda-nocturna.enable {
          description = "Ejecuciones de la ingesta de Celda, el primer sábado de cada mes y el domingo siguiente";

          wantedBy = singleton "timers.target";

          timerConfig = {
            OnCalendar = [
              "Sat *-*-01..07 ${cfg.hora}:00 ${cfg.zonaHoraria}"
              "Sun *-*-02..08 ${cfg.hora}:00 ${cfg.zonaHoraria}"
            ];
            Persistent = false;
          };
        };
      };
    };
}
