# Ingesta nocturna en NixOS

El flake de Celda exporta la ingesta nocturna (ADR 0015) de dos formas:

- `packages.<sistema>.celda-nocturna`: el programa de `apps/nocturna` en un solo fichero, con el Node 24 de nixpkgs. Acepta las mismas órdenes que `pnpm run ingesta`: `noche`, `estado`, `publicar`, `copia` y `reserva`.
- `nixosModules.celda-nocturna`: un servicio de systemd que lanza `noche` una vez al día con su temporizador, su usuario y sus directorios.

El módulo no sabe nada de la máquina que lo usa. El horario, las rutas y las credenciales van en la configuración de esa máquina, en su propio repositorio.

## Probar el paquete

Desde la raíz de Celda:

```sh
nix build .#celda-nocturna
nix run .#celda-nocturna -- estado
nix flake check
```

Sin variables de entorno, el programa usa `datos/ingesta.sqlite` y `datos/copias/` del directorio desde el que se lanza, como `pnpm run ingesta`. La configuración y sus variables están en [convex.md](convex.md#configuración).

`nix flake check` construye el paquete y lanza una máquina virtual de NixOS con el módulo (`nix/nocturna-pruebas.mod.nix`). Hace falta KVM. La máquina tiene un geoportal, un antenasmoviles.es, un R2 y un Vercel de mentira que contestan por HTTPS. El R2 sirve el cubo también sin firma, como el Worker, en `capas.prueba`. El Vercel, en cada llamada al deploy hook, construye un despliegue con `celda-nocturna reserva https://capas.prueba <carpeta>` y, si acaba bien, lo sirve en `celda.prueba/capas`; si falla, sigue sirviendo el anterior. El geoportal da, para cada caja, los elementos del listado grabado en el Campus Nord que caen en ella, y una ficha grabada. antenasmoviles.es da como listado los marcadores grabados en el Campus Nord, las 42 ER5 grabadas de Barcelona y una ER5 de Madrid, y los detalles grabados. La prueba enciende antenasmoviles.es con 4 detalles por noche y:

1. crea los ficheros de credenciales de R2 y del deploy hook con valores al azar;
2. adelanta el reloj hasta la hora del temporizador y espera a que la noche acabe bien;
3. comprueba que la base está en `/var/lib/celda-nocturna`, que la copia está en el directorio de copias y que `vigente.json` y la capa llegaron al cubo, firmados con la clave del fichero;
4. lanza `celda-nocturna estado` como el usuario del servicio;
5. comprueba que, con las zonas por defecto, la primera noche barrió Cataluña con una petición por cuadro, y que la orden de estado dice, por zona, cuándo se barrió y cuántas fichas le faltan, y que la siguiente barre `centro`;
6. comprueba que antenasmoviles.es recibió un solo `showf` y cuatro detalles, los de las dos ER5 sin compañía de Barcelona primero, ninguno de Madrid ni de una copia del registro, y que la ER5 de Urquinaona se publicó con su enlace a antenasmoviles.es;
7. comprueba que las fichas llegaron a una cada 4 s como mínimo, que pararon al cerrarse su ventana de 2 minutos con las demás en la cola, y que se publicó a mitad de la ventana y al cerrarla;
8. comprueba que la noche llamó una vez al deploy hook y que Vercel sirve una copia con solo la versión vigente, igual byte a byte que R2, aunque R2 tenga las dos de la noche;
9. publica a mano con `systemd-run`, como el servicio, y comprueba que con la copia al día no se llama al hook;
10. deja servida una copia de otra versión y tira el origen público de R2: la publicación llama al hook, el build falla sin escribir `vigente.json` y Vercel sigue sirviendo la copia anterior. Con R2 de vuelta, la siguiente publicación la pone al día;
11. busca la clave, el secreto y el hook en todo el almacén de Nix de la máquina y no los encuentra.

Con todo construido, la máquina virtual tarda unos 2 min 30 s en arrancar y pasar la prueba. Casi todo es la ventana de fichas.

## El hash de las dependencias de pnpm

El paquete no descarga nada durante la construcción. Las dependencias de producción de `@celda/nocturna` se descargan antes en una derivación aparte, fijada por su hash: `pnpmDeps.hash` en `nix/nocturna.mod.nix`. Solo entran las de producción. Con las de desarrollo, que traen los binarios de vite-plus para todas las plataformas, pesaba más de 1 GiB; así son 13 MiB. Por eso el paquete empaqueta con el esbuild de nixpkgs y no con `vp build`, pero con las mismas opciones que `apps/nocturna/vite.config.ts`.

Si un cambio de `pnpm-lock.yaml` toca las dependencias de la ingesta, el hash se queda viejo y la construcción falla de una de estas dos formas:

- En una máquina que no tiene las dependencias viejas, como la CI: `hash mismatch in fixed-output derivation '…-celda-nocturna-pnpm-deps.drv'`, con el hash esperado y el que ha salido.
- En una que sí las tiene: pnpm no encuentra un paquete sin red (`ERR_PNPM_NO_OFFLINE_TARBALL`), y el paquete dice qué hacer.

En los dos casos, pon `hash = "";` en `pnpmDeps`, lanza `nix build .#celda-nocturna` y copia el hash de la línea `got:`. Después comprueba que otra máquina saca lo mismo, sin reutilizar lo que ya tienes:

```sh
nix build .#celda-nocturna.pnpmDeps --rebuild
```

Un cambio del lockfile que no toca la ingesta, como subir una dependencia de la web, no cambia el hash.

## Activarlo en una máquina

La máquina necesita la función experimental `pipe-operators` de Nix, porque los módulos de Celda usan `<|`:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" "pipe-operators" ];
```

Un ejemplo mínimo del flake de la máquina:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  # La URL del flake de Celda. Si está en un subdirectorio de su repositorio, añade ?dir=<ruta>.
  inputs.celda.url = "github:ejemplo/celda";

  outputs =
    { nixpkgs, celda, ... }:
    {
      nixosConfigurations.maquina = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";

        modules = [
          celda.nixosModules.celda-nocturna
          {
            services.celda-nocturna = {
              enable = true;
              horario = "*-*-* 04:30:00 Europe/Madrid";
              credenciales.r2 = "/etc/secretos/celda-r2.env";
              credenciales.vercel = "/etc/secretos/celda-vercel.env";
              copias.directorio = "/srv/copias/celda";
              origenPublico = "https://capas.example.org";
              origenDeReserva = "https://celda.example.org/capas";
            };
          }
        ];
      };
    };
}
```

No hagas que `celda.inputs.nixpkgs` siga al nixpkgs de la máquina. Con otro nixpkgs cambia pnpm, y con él el hash de las dependencias.

### Credenciales

Los ficheros de credenciales se crean a mano en la máquina, fuera de cualquier repositorio y del almacén de Nix, y solo root los lee. Van en formato `.env`:

```sh
sudo install --directory --mode=0700 /etc/secretos
sudo install --mode=0600 /dev/null /etc/secretos/celda-r2.env
sudoedit /etc/secretos/celda-r2.env
```

```sh
CELDA_R2_CUENTA=identificador-de-la-cuenta-de-cloudflare
CELDA_R2_CUBO=nombre-del-cubo
CELDA_R2_ID_CLAVE=id-de-la-clave-de-api-de-r2
CELDA_R2_SECRETO=secreto-de-la-clave
```

El módulo solo guarda la ruta. systemd copia el fichero a un directorio privado del servicio al arrancarlo (`LoadCredential=`), y el programa lee cada fichero de `$CREDENTIALS_DIRECTORY` detrás de las variables de entorno (`apps/nocturna/src/credenciales.ts`). Los secretos no pasan por el entorno del proceso. Las opciones de credenciales rechazan rutas del almacén de Nix, así que un `./secreto.env` del repositorio no se acepta. Si el fichero no existe, el servicio no arranca.

`credenciales.vercel` funciona igual, con el deploy hook del proyecto de Vercel:

```sh
CELDA_VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/prj_…/…
```

Con él y `origenDeReserva`, la noche compara tras publicar el `vigente.json` de R2 con el de la copia de reserva y, si no coinciden, llama al hook. El build de Vercel copia entonces la versión vigente de R2 (ADR 0010, «La copia de reserva»). Sin `origenDeReserva`, llama al hook en cada noche.

### Opciones

Todas cuelgan de `services.celda-nocturna`. Los valores por defecto son los del programa.

| Opción | Por defecto | Qué es |
|---|---|---|
| `enable` | `false` | Activa el servicio y su temporizador |
| `package` | el paquete del flake de Celda | El programa |
| `horario` | `*-*-* 02:15:00 UTC` | Cuándo empieza la noche, en formato `OnCalendar=` |
| `recuperarNochesPerdidas` | `true` | Si la máquina estaba apagada, lanza la noche al encenderse (`Persistent=`) |
| `tiempoMaximo` | `fichas.ventana` + `reintentoDePublicacion` + 60 minutos, 8 h con los valores por defecto | Lo más que dura una noche (`TimeoutStartSec=`) |
| `directorioDeEstado` | `celda-nocturna` | Directorio de la base dentro de `/var/lib` |
| `copias.directorio` | `/var/lib/celda-nocturna/copias` | Dónde van las copias de la base |
| `copias.conservar` | 14 | Copias que se conservan |
| `credenciales.r2` | `null` | Fichero de credenciales de R2; sin él no se publica |
| `credenciales.vercel` | `null` | Fichero del deploy hook de Vercel; sin él no se toca la copia de reserva |
| `origenPublico` | `null` | URL pública de lo publicado (`CELDA_ALMACEN_ORIGEN`) |
| `origenDeReserva` | `null` | URL pública de la copia de reserva, `https://celda.elies.site/capas` (`CELDA_RESERVA_ORIGEN`) |
| `reintentoDePublicacion` | 60 | Minutos antes de repetir una publicación fallida |
| `registroOficial.enable` | `true` | Interruptor del registro oficial |
| `registroOficial.motivo` | `apagado en la configuración de la ingesta` | Lo que se apunta si está apagado |
| `registroOficial.pausa` | 3 | Segundos entre peticiones del listado, entre 3 y 3600 |
| `registroOficial.maxPeticiones` | 400 | Tope de peticiones del listado por noche; deja barrer toda España en una |
| `registroOficial.fichas.ritmo` | 3 | Segundos entre una ficha y la siguiente, entre 3 y 3600 |
| `registroOficial.fichas.ventana` | 360 | Minutos de fichas desde que empieza la noche |
| `registroOficial.fichas.relectura` | 30 | Días tras los que se vuelve a leer una ficha |
| `registroOficial.fichas.prioridad` | `[ "08" "17" "25" "43" ]` | Provincias, por código INE, cuyas fichas van primero |
| `registroOficial.fichas.maximo` | `null` | Tope de fichas por noche; sin él, las que quepan en la ventana. Antes se llamaba `maxFichas` |
| `registroOficial.reintentos` | 3 | Reintentos de un fallo pasajero |
| `registroOficial.espera` | 10 | Segundos que se espera una respuesta |
| `registroOficial.zonas` | `[ ]` | Zonas de barrido de todas las noches |
| `registroOficial.zonasEnTurno` | las siete, de `cataluna` a `oeste-y-canarias` | Zonas de barrido que se turnan |
| `registroOficial.zonasPorNoche` | 1 | Cuántas de las que se turnan se barren cada noche |
| `registroOficial.userAgent` | `Celda (ingesta; contacto en celda.elies.site)` | Se envía en cada petición. Si montas tu propia ingesta, pon tu contacto |
| `antenasmoviles.enable` | `false` | Interruptor de antenasmoviles.es. Déjalo apagado hasta escribir a su administrador |
| `antenasmoviles.motivo` | `apagado por defecto hasta escribir a su administrador…` | Lo que se apunta si está apagado |
| `antenasmoviles.pausa` | 5 | Segundos entre peticiones, entre 5 y 3600 |
| `antenasmoviles.maxDetalles` | 100 | Detalles de ER5 nuevas o cambiadas por noche |
| `antenasmoviles.maxPeticiones` | `maxDetalles` + 10 | Tope de peticiones por noche |
| `antenasmoviles.zonas` | `registroOficial.zonas` y `zonasEnTurno` | Zonas de barrido cuyos marcadores se guardan, todas cada noche |
| `antenasmoviles.userAgent` | `registroOficial.userAgent` | Se envía en cada petición |

Las zonas de barrido son `cataluna`, `centro`, `andalucia`, `levante`, `norte`, `ebro-y-duero` y `oeste-y-canarias` (la guía de la ingesta, en [convex.md](convex.md), dice qué comunidades lleva cada una). Por defecto se turnan las siete, una por noche: toda España en siete noches, con unas 31 peticiones de listado cada una y Cataluña la primera. Para barrer Cataluña todas las noches y las demás por turnos, unas 61 peticiones y toda España en seis noches:

```nix
services.celda-nocturna.registroOficial.zonas = [ "cataluna" ];
```

Y toda España cada noche, unas 215 peticiones y 15 minutos de listado:

```nix
services.celda-nocturna.registroOficial.zonasPorNoche = 7;
```

El listado de antenasmoviles.es es de toda España y se pide una vez por noche, así que sus zonas se barren todas cada noche, también las que el registro turna. Qué hace cada noche está en [convex.md](convex.md#antenasmovileses-en-la-noche).

Las fichas se leen a una cada `fichas.ritmo` segundos hasta que pasan `fichas.ventana` minutos desde que empezó la noche: con los valores por defecto, unas 5.500. Primero van las de las provincias de `fichas.prioridad` (Barcelona y el resto de Cataluña), luego las de cada zona de barrido en el orden de `zonas` y `zonasEnTurno`, y al final las demás. Cómo funciona la cola está en [convex.md](convex.md#las-fichas). Si el ministerio pide menos peticiones, basta con subir el ritmo:

```nix
services.celda-nocturna.registroOficial.fichas.ritmo = 10;
```

`tiempoMaximo` sigue a la ventana. Si lo pones a mano, que cubra la ventana, la hora de espera antes de repetir una publicación y la copia.

Cualquier variable del programa se puede poner también a mano, sin secretos:

```nix
systemd.services.celda-nocturna.environment.CELDA_REGISTRO_MAX_PETICIONES = "100";
```

### El directorio de copias en otro disco

Si `copias.directorio` está fuera de `/var/lib/celda-nocturna`, tmpfiles lo crea con el usuario del servicio. El servicio espera a que se monte su disco (`WantsMountsFor=`), pero no depende de él: si el disco no está, la noche corre igual. En ese caso la copia va al directorio vacío del disco del sistema, o falla con un aviso en el diario si no se puede escribir.

## Consultar lo que hizo cada noche

Por SSH, en la máquina:

```sh
sudo --user=celda-nocturna celda-nocturna estado   # la base: ejecuciones, fichas pendientes, errores y lo publicado
journalctl --unit=celda-nocturna.service           # el diario de cada noche
systemctl list-timers celda-nocturna.timer         # la próxima noche
sudo systemctl start celda-nocturna.service        # una noche ahora, con peticiones reales
```

El módulo instala `celda-nocturna` con la configuración de la máquina pero sin credenciales. Sirve para `estado` y `copia`. Para una noche entera o para publicar, usa el servicio, que es el que tiene las credenciales.

## Qué puede hacer el servicio

- Corre como el usuario `celda-nocturna`, sin capacidades ni privilegios nuevos.
- Solo escribe en su directorio de estado y en el de copias: el resto del sistema de ficheros es de solo lectura, y `/home` y `/root` no se ven.
- Solo abre sockets IPv4 e IPv6. Sin sockets locales no llega a nscd, así que resuelve los nombres con `/etc/hosts` y el DNS de `/etc/resolv.conf`.
- Filtra las llamadas al sistema a las de un servicio (`@system-service`). No lleva `MemoryDenyWriteExecute`, porque el compilador de V8 escribe y ejecuta su código.

`systemd-analyze security celda-nocturna.service` le da un 1,1 sobre 10 de exposición en la prueba de máquina virtual.
