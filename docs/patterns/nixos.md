# Ingesta nocturna en NixOS

El flake de Celda exporta la ingesta nocturna (ADR 0015) de dos formas:

- `packages.<sistema>.celda-nocturna`: el programa de `apps/nocturna` en un solo fichero, con el Node 24 de nixpkgs. Acepta las mismas órdenes que `pnpm run ingesta`: `noche`, `estado`, `publicar`, `copia`, `releer-archivo`, `restaurar-archivo`, `comprobar-historial`, `capas` y `cuadros-de-borde`.
- `nixosModules.celda-nocturna`: un servicio de systemd que lanza `noche` una vez al día con su temporizador, su usuario y sus directorios.

El módulo no sabe nada de la máquina que lo usa. El horario, las rutas y las credenciales van en la configuración de esa máquina, en su propio repositorio.

## Probar el paquete

Desde la raíz de Celda:

```sh
nix build .#celda-nocturna
nix run .#celda-nocturna -- estado
nix flake check
```

Sin variables de entorno, el programa usa `datos/ingesta.sqlite`, `datos/archivo.sqlite` y `datos/copias/` del directorio desde el que se lanza, como `pnpm run ingesta`. La configuración y sus variables están en [convex.md](convex.md#configuración).

`nix flake check` construye el paquete y lanza una máquina virtual de NixOS con el módulo (`nix/nocturna-pruebas.mod.nix`). Hace falta KVM. La máquina tiene un geoportal, un R2, un Vercel y un buzón de Convex de mentira que contestan por HTTPS. El R2 es privado, como el de verdad (ADR 0018): no contesta nada sin firma, y con la clave de solo lectura del build no deja escribir ni borrar. El Vercel, en cada llamada al deploy hook, construye un despliegue con `celda-nocturna capas <carpeta>` y las variables de R2 del build, con esa clave, y si acaba bien lo sirve en `celda.prueba/capas`; si falla, sigue sirviendo el anterior. El geoportal da, para cada caja, los elementos del listado grabado en el Campus Nord que caen en ella, y una ficha grabada. La prueba:

1. crea los ficheros de credenciales de R2, del deploy hook y del buzón de Convex con valores al azar;
2. adelanta el reloj hasta la hora del temporizador y espera a que la noche acabe bien;
3. comprueba que la noche leyó lo aceptado del buzón de Convex de mentira con la clave de publicación de su credencial, y que la base está en `/var/lib/celda-nocturna`, que la copia está en el directorio de copias y que `vigente.json` y la capa llegaron al cubo, firmados con la clave del fichero, y que la copia también llegó al cubo, comprimida, bajo `copias/`;
4. lanza `celda-nocturna estado` como el usuario del servicio;
5. comprueba que, con las zonas por defecto, la primera noche barrió Cataluña con una petición por cuadro, y que la orden de estado dice, por zona, cuándo se barrió y cuántas fichas le faltan, y que la siguiente barre `centro`;
6. comprueba que las fichas llegaron a una cada 4 s como mínimo, que pararon al cerrarse su ventana de 2 minutos con las demás en la cola, y que se publicó a mitad de la ventana y al cerrarla;
7. comprueba que la noche llamó una vez al deploy hook y que Vercel monta las dos versiones de la noche, la vigente y su anterior, igual byte a byte que R2, leyendo con la clave de solo lectura y sin escribir nada con ella;
8. comprueba que el archivo de páginas tiene una lectura por cada respuesta del geoportal y un contenido por página distinta, que su paquete está en la carpeta de copias y, igual byte a byte, bajo `archivo/` en R2, que Vercel no monta nada de `archivo/` ni de `copias/` ni lo pide al cubo, que `celda-nocturna releer-archivo` lee todas las fichas archivadas sin pedir nada al geoportal y que `celda-nocturna comprobar-historial` da el historial de los 40 registros igual que la tabla de observaciones;
9. publica a mano con `systemd-run`, como el servicio, y comprueba que con Vercel al día no se llama al hook;
10. deja servido un despliegue de otra versión y hace que R2 no conteste al build: la publicación llama al hook, el build falla sin escribir `vigente.json` y Vercel sigue sirviendo el anterior. Con R2 de vuelta, la siguiente publicación lo pone al día;
11. lanza `celda-nocturna cuadros-de-borde` como el usuario del servicio y comprueba que pide una vez cada uno de los cuatro cuadros de borde, que en el Campus Nord no traen nada, y que no toca la base;
12. comprueba que el servicio no tiene `CELDA_RESERVA_ORIGEN` y que su `CELDA_ALMACEN_ORIGEN` es la URL de las capas en Vercel;
13. busca las dos claves de R2, sus secretos, el hook y la clave de publicación en todo el almacén de Nix de la máquina y no los encuentra.

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
              credenciales.convex = "/etc/secretos/celda-convex.env";
              copias.directorio = "/srv/copias/celda";
              origenPublico = "https://celda.example.org/capas";
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

Es la clave de la ingesta, la que escribe: publica en el cubo, retira las versiones viejas y sube allí la copia de la base. El build de Vercel usa otra, de solo lectura (abajo, «Las cuentas de R2 y Vercel»).

El módulo solo guarda la ruta. systemd copia el fichero a un directorio privado del servicio al arrancarlo (`LoadCredential=`), y el programa lee cada fichero de `$CREDENTIALS_DIRECTORY` detrás de las variables de entorno (`apps/nocturna/src/credenciales.ts`). Los secretos no pasan por el entorno del proceso. Las opciones de credenciales rechazan rutas del almacén de Nix, así que un `./secreto.env` del repositorio no se acepta. Si el fichero no existe, el servicio no arranca.

`credenciales.vercel` funciona igual, con el deploy hook del proyecto de Vercel:

```sh
CELDA_VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/prj_…/…
```

`credenciales.convex` también, con la conexión con el buzón de Convex (ADR 0020):

```sh
CELDA_CONVEX_SITE_URL=https://nombre-del-despliegue.convex.site
CELDA_PUBLICACION_CLAVE=la-misma-que-en-el-despliegue
```

La clave es la clave de publicación, la variable `CELDA_PUBLICACION_CLAVE` del despliegue ([convex.md](convex.md#antes-del-primer-despliegue-del-buzón)). Solo abre la acción HTTP que da lo aceptado para publicar, sin identidades ni huellas de IP. **Nunca pongas aquí una clave de despliegue de Convex**: lo puede todo (desplegar código, leer todas las aportaciones y las huellas, vetar), y esta máquina no la necesita. La clave de despliegue se queda en el portátil de quien modera. Con la de publicación, cada noche lee lo aceptado en la moderación desde la última vez y lo publica en las fichas ([convex.md](convex.md#moderar)). El diario dice «Buzón de Convex: N aceptadas leídas, M nuevas» o, si Convex no contesta, que no está disponible y que la noche publica lo demás. Sin el fichero, la comunidad queda apagada.

Con el hook y `origenPublico`, la noche compara tras publicar el `vigente.json` de R2, leído por la API S3, con el que sirve Vercel en `origenPublico` y, si no coinciden, llama al hook. El build de Vercel monta entonces las capas desde R2 (ADR 0018). El diario lo dice en los dos casos: «Vercel no sirve sitios@…: build lanzado» o «Vercel ya sirve sitios@…: no hace falta otro build». Sin `origenPublico`, llama al hook en cada noche.

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
| `copias.directorio` | `/var/lib/celda-nocturna/copias` | Dónde van las copias de la base y, en su carpeta `archivo`, los paquetes del archivo de páginas |
| `copias.conservar` | 14 | Copias que se conservan, en el disco y en R2 |
| `credenciales.r2` | `null` | Fichero de credenciales de R2, con la clave que escribe; sin él no se publica ni se suben la copia ni los paquetes del archivo |
| `credenciales.vercel` | `null` | Fichero del deploy hook de Vercel; sin él no se lanza ningún build |
| `credenciales.convex` | `null` | Fichero con la URL de las acciones HTTP del buzón y su clave de publicación (nunca una clave de despliegue); sin él no se publica lo aceptado en la moderación |
| `origenPublico` | `null` | URL pública de las capas en Vercel, `https://celda.elies.site/capas` (`CELDA_ALMACEN_ORIGEN`) |
| `reintentoDePublicacion` | 60 | Minutos antes de repetir una publicación fallida |
| `memoria.monton` | 512 | Megabytes del montón de V8 (`NODE_OPTIONS=--max-old-space-size`) |
| `memoria.alta` | el doble del montón, `1024M` | Desde dónde systemd frena el servicio (`MemoryHigh=`) |
| `memoria.maxima` | el triple del montón, `1536M` | Lo más que puede usar antes de que systemd lo pare (`MemoryMax=`) |
| `registroOficial.enable` | `true` | Interruptor del registro oficial |
| `registroOficial.cambioMasivo.porCiento` y `.minimo` | 20 y 50 | Cuánto puede cambiar el registro en un cuadro o una zona antes de parar la noche sin publicar ([convex.md](convex.md#cambio-masivo)) |
| `registroOficial.motivo` | `apagado en la configuración de la ingesta` | Lo que se apunta si está apagado |
| `registroOficial.pausa` | 3 | Segundos entre peticiones del listado, entre 3 y 3600 |
| `registroOficial.maxPeticiones` | 400 | Tope de peticiones del listado por noche; deja barrer toda España en una |
| `registroOficial.fichas.ritmo` | 3 | Segundos entre una ficha y la siguiente, entre 1 y 3600 |
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

Las zonas de barrido son `cataluna`, `centro`, `andalucia`, `levante`, `norte`, `ebro-y-duero` y `oeste-y-canarias` (la guía de la ingesta, en [convex.md](convex.md), dice qué comunidades lleva cada una). Por defecto se turnan las siete, una por noche: toda España en siete noches, con unas 31 peticiones de listado cada una y Cataluña la primera. Para barrer Cataluña todas las noches y las demás por turnos, unas 61 peticiones y toda España en seis noches:

```nix
services.celda-nocturna.registroOficial.zonas = [ "cataluna" ];
```

Y toda España cada noche, unas 215 peticiones y 15 minutos de listado:

```nix
services.celda-nocturna.registroOficial.zonasPorNoche = 7;
```

Las fichas se leen a una cada `fichas.ritmo` segundos hasta que pasan `fichas.ventana` minutos desde que empezó la noche: con los valores por defecto, unas 5.500. Primero van las de las provincias de `fichas.prioridad` (Barcelona y el resto de Cataluña), luego las de cada zona de barrido en el orden de `zonas` y `zonasEnTurno`, y al final las demás. Cómo funciona la cola está en [convex.md](convex.md#las-fichas). Si el ministerio pide menos peticiones, basta con subir el ritmo:

```nix
services.celda-nocturna.registroOficial.fichas.ritmo = 10;
```

El mínimo es 1 s. Para leer las fichas a una por segundo, pon en la configuración del host:

```nix
services.celda-nocturna.registroOficial.fichas.ritmo = 1;
```

y aplícalo con `nixos-rebuild switch`. La noche siguiente lo usa; `systemctl show celda-nocturna.service --property=Environment` debe decir `CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS=1`. Siguen yendo de una en una: el segundo cuenta desde el final de una ficha hasta la petición de la siguiente, así que con un geoportal que tarda casi un segundo sale una cada 1,9 s, unas 11.000 en 6 horas. El ministerio podría bloquear ese ritmo (ADR 0014): si responde 401, 403, 429, un 503 que pide esperar más de un minuto o una página que no es una ficha, la noche deja de pedir fichas y lo apunta en los errores. Las primeras noches, mira `sudo --user=celda-nocturna celda-nocturna estado` y el diario, y al primer rechazo vuelve a 3.

`tiempoMaximo` sigue a la ventana. Si lo pones a mano, que cubra la ventana, la hora de espera antes de repetir una publicación y la copia.

Cualquier variable del programa se puede poner también a mano, sin secretos:

```nix
systemd.services.celda-nocturna.environment.CELDA_REGISTRO_MAX_PETICIONES = "100";
```

### Cuándo vale una configuración nueva

`nixos-rebuild switch` no reinicia el servicio (`restartIfChanged = false` en el módulo). La noche que esté corriendo sigue con el paquete y la configuración con que empezó, y la nueva vale desde la noche siguiente. Así `switch` no corta una noche a medias ni se queda horas esperando a que acabe la que arrancaría otra vez. Con el servicio parado, tampoco lo arranca: lo arranca el temporizador a su hora.

Para que valga ya, para la noche y arráncala otra vez, sin esperar a que acabe:

```sh
sudo systemctl stop celda-nocturna.service
sudo systemctl start --no-block celda-nocturna.service
```

Parar una noche a medias no pierde lo leído: el barrido sigue por el primer cuadro sin guardar ([convex.md](convex.md#el-barrido-por-zonas)), y las fichas que faltan siguen en la cola. `--no-block` devuelve en cuanto la noche arranca; síguela con `journalctl --unit=celda-nocturna.service --follow`.

### El directorio de copias en otro disco

Si `copias.directorio` está fuera de `/var/lib/celda-nocturna`, tmpfiles lo crea con el usuario del servicio. Las copias de fuera de casa van a R2 (abajo). El servicio espera a que se monte su disco (`WantsMountsFor=`), pero no depende de él: si el disco no está, la noche corre igual. En ese caso la copia va al directorio vacío del disco del sistema, o falla con un aviso en el diario si no se puede escribir.

## Las cuentas de R2 y Vercel

Desde el ADR 0018, R2 es un almacén privado y la web, las capas y las fichas se sirven solo desde Vercel. Esto lo hace quien administra las cuentas, una vez; nada de ello va en Celda ni en el almacén de Nix.

**En Cloudflare:**

1. Quita el acceso público del cubo: en R2 → el cubo → Settings, desactiva «Public Development URL» (`r2.dev`) y borra cualquier dominio propio. Nada lee el cubo sin firma.
2. Si se llegó a desplegar el Worker de la exploración 05, que servía el cubo, bórralo (Workers & Pages → el Worker → Settings → Delete). Celda no lo usa en ningún sitio.
3. Crea una clave de API de R2 de solo lectura para ese cubo (R2 → Manage R2 API Tokens → Create API Token, permiso «Object Read only», solo ese cubo). Apunta su Access Key ID y su Secret Access Key: son para Vercel.
4. La clave de la ingesta, la de `credenciales.r2`, tiene que ser «Object Read & Write» en el mismo cubo.
5. Pon una alerta de facturación en la cuenta (Notifications → Add → «Usage Based Billing», para R2). R2 no corta al pasar de lo gratuito: cobra el exceso. Con las versiones que retiene la ingesta y catorce copias comprimidas de la base, el uso queda lejos de los 10 GB gratis.

**En Vercel**, en el proyecto de `celda.elies.site`, con la raíz en `apps/web`:

1. Variables de entorno de producción (Settings → Environment Variables, entorno «Production», marcadas como «Sensitive» las dos de la clave):

   | Variable | Valor |
   |---|---|
   | `CELDA_R2_CUENTA` | el identificador de la cuenta de Cloudflare |
   | `CELDA_R2_CUBO` | el nombre del cubo |
   | `CELDA_R2_ID_CLAVE` | el Access Key ID de la clave de solo lectura |
   | `CELDA_R2_SECRETO` | el Secret Access Key de la clave de solo lectura |

   Borra `VITE_CAPAS_ORIGEN` y `VITE_CAPAS_RESERVA` si están: la web ya no las lee y `vercel.sh` construye sin ellas. Sin las cuatro de R2, el build falla y Vercel sigue sirviendo el despliegue anterior.
2. El deploy hook solo existe con el proyecto conectado a Git (Settings → Git → Connect Git Repository, rama de producción). Conectado, crea un hook de la rama de producción (Settings → Git → Deploy Hooks) y guárdalo en la máquina de la ingesta como `credenciales.vercel`. La otra opción del ADR 0018, desplegar con la CLI desde la noche, no está hecha.

**En la máquina de la ingesta:** `origenPublico = "https://celda.elies.site/capas";`, sin `origenDeReserva`, que ya no existe y da un error que lo explica.

Para comprobarlo tras la primera noche:

```sh
journalctl --unit=celda-nocturna.service | grep -E 'Vercel|Copia de la base en R2'
curl --silent https://celda.elies.site/capas/vigente.json   # el mismo que el de R2
curl --silent --output /dev/null --write-out '%{http_code}\n' https://celda.elies.site/capas/no-esta.json   # 404
```

El build de Vercel dice en su registro «Capas de sitios@… y de sitios@…, sitios@…: N ficheros».

### Restaurar la base desde R2

Las copias de R2 están en `copias/ingesta-<fecha>.sqlite.gz`, comprimidas con gzip. Para restaurar, para la ingesta, baja una con cualquier cliente S3 y la clave de la ingesta, y descomprímela encima de la base:

```sh
gzip --decompress --stdout ingesta-2026-10-03T02-15-00.000Z.sqlite.gz > /var/lib/celda-nocturna/ingesta.sqlite
rm -f /var/lib/celda-nocturna/ingesta.sqlite-wal /var/lib/celda-nocturna/ingesta.sqlite-shm
chown celda-nocturna:celda-nocturna /var/lib/celda-nocturna/ingesta.sqlite
```

Una subida que falla queda en el diario («No se ha podido subir la copia de la base a R2: …») y la noche acaba bien; la copia del disco sigue ahí, y la noche siguiente sube la suya.

### El archivo de páginas

El archivo de páginas del registro (ADR 0027) es `/var/lib/celda-nocturna/archivo.sqlite`, y sus paquetes, `archivo-<fecha>-<número>.sqlite`, de 8 MiB como mucho, van a la carpeta `archivo` de `copias.directorio` y a `archivo/` del cubo de R2. Una noche normal saca uno, y una de la relectura de España, unos quince. Ninguno se borra. Los de antes del 07/10/2026 son un solo fichero por noche, `archivo-<fecha>.sqlite`. Uno de esos de más de 16 MiB que aún no está en R2 se parte al subirlo, y el entero se queda en `archivo/enteros/`. No hace falta ninguna opción ni credencial nueva. Para comprobarlo tras una noche:

```sh
journalctl --unit=celda-nocturna.service | grep 'Archivo de páginas'
ls /var/lib/celda-nocturna/copias/archivo/
sudo --user=celda-nocturna celda-nocturna releer-archivo   # sin red; dice cuántas fichas archivadas se leen
```

Una subida que falla queda en el diario («No se han podido subir los paquetes del archivo a R2: …», con la causa) y la noche acaba bien. Los paquetes que llegaron antes del fallo se quedan en R2, y los demás suben la noche siguiente.

Para rehacerlo, para la ingesta, junta los paquetes en una carpeta (los de la carpeta de copias o los de `archivo/` en R2, bajados con la clave de la ingesta; los de `enteros/` no hacen falta, porque sus partes llevan las mismas filas) y lanza:

```sh
sudo --user=celda-nocturna celda-nocturna restaurar-archivo /ruta/de/los/paquetes
```

Tras subir `VERSION_DE_LECTURA` y desplegar, `releer-archivo --aplicar`, también como el usuario del servicio y con la noche parada, lleva la lectura nueva a las fichas archivadas sin pedirlas otra vez ([convex.md](convex.md#el-archivo-de-páginas)).

## Consultar lo que hizo cada noche

Por SSH, en la máquina:

```sh
sudo --user=celda-nocturna celda-nocturna estado   # la base: ejecuciones, fichas pendientes, errores y lo publicado
journalctl --unit=celda-nocturna.service           # el diario de cada noche
systemctl list-timers celda-nocturna.timer         # la próxima noche
sudo systemctl start celda-nocturna.service        # una noche ahora, con peticiones reales
```

El módulo instala `celda-nocturna` con la configuración de la máquina pero sin credenciales. Sirve para `estado`, `releer-archivo` y `restaurar-archivo`, y para `copia` en el disco. Para una noche entera o para publicar, usa el servicio, que es el que tiene las credenciales.

### Los cuadros de borde

Los cuadros de las zonas salen del listado propio del registro (ADR 0019 y [convex.md](convex.md#los-cuadros-de-las-zonas)). Los que tocan alguna provincia y no están en ninguna zona se piden una vez, por SSH, en la máquina:

```sh
sudo --user=celda-nocturna celda-nocturna cuadros-de-borde /var/lib/celda-nocturna/cuadros-de-borde.json
```

Usa el extractor del registro con la configuración de la máquina: su ritmo, su `User-Agent`, `robots.txt` y su tope. No abre la base ni el almacén, así que no le hacen falta credenciales. Lánzala fuera de la ventana de la noche, para no pedir a la vez que el servicio. Con los límites del IGN de hoy son cuatro cuadros y unos 15 s. Después, en el repositorio, con el fichero y la última copia de la base:

```sh
scp maquina:/var/lib/celda-nocturna/cuadros-de-borde.json maquina:/ruta/de/copias/ingesta-<fecha>.sqlite .
cd apps/nocturna
pnpm run cuadros ../../ingesta-<fecha>.sqlite ../../cuadros-de-borde.json
```

La orden suma los cuadros que traigan algún registro, dice en qué zona va cada uno y deja la pasada en `cuadros-del-registro.json`. Los cuadros nuevos se añaden a `ZONAS_DE_BARRIDO`, y la pasada se anota en la investigación 08, apartado 7.

## Certificados del geoportal

La primera noche en el portátil de producción (01/10/2026) falló en todas las zonas con `FuenteNoDisponible: TransportError (https://geoportal.minetur.gob.es/robots.txt)`. El geoportal entregó su certificado sin el intermedio de la FNMT que lo firma, «AC Componentes Informáticos», y Node no pudo llegar a la raíz. La noche anterior había funcionado desde otra máquina de la misma red, así que el fallo parece depender del servidor que conteste.

No hay que tocar nada en la máquina. El intermedio va en el código de Celda (`packages/ingesta/src/registro-oficial/intermedio.ts`) y solo lo usa el cliente HTTP del registro oficial, que confía en las raíces de Node más ese intermedio. No hace falta `NODE_EXTRA_CA_CERTS` ni `security.pki.certificateFiles`, y no conviene usarlos para esto: cambiarían la confianza de todo el proceso o de toda la máquina para arreglar una sola fuente, y el arreglo no viajaría con el paquete. Si una máquina pone `NODE_EXTRA_CA_CERTS`, como la máquina virtual de la prueba con su autoridad de mentira, el cliente del registro también confía en esos certificados.

Ese cliente (`apps/nocturna/src/conexionDelRegistro.ts`) es el de `node:https` de `@effect/platform-node` (`NodeHttpClient.layerNodeHttpNoAgent`), con un agente propio (`NodeHttpClient.layerAgentOptions`) que lleva esas raíces y ese intermedio, mantiene viva la conexión entre peticiones y se cierra al cerrar la capa. No es `fetch`, así que hace a mano lo que `fetch` hacía solo: sigue hasta 20 redirecciones y pide el cuerpo sin comprimir (`Accept-Encoding: identity`). El geoportal no comprime aunque se le pida; si un día contesta comprimido, la petición falla con `DecodeError: respuesta comprimida con …` en vez de leer un listado o una ficha ilegibles.

Si la noche falla por un certificado, el diario lo dice: `el certificado del servidor no se pudo verificar, falta el certificado de su emisor (UNABLE_TO_GET_ISSUER_CERT_LOCALLY: …)`. Para ver qué cadena envía el geoportal:

```sh
openssl s_client -connect geoportal.minetur.gob.es:443 -servername geoportal.minetur.gob.es -showcerts </dev/null
```

Hay que revisarlo antes del 24/06/2028, cuando caduca el intermedio (una prueba falla desde 90 días antes), y si el ministerio renueva el certificado del geoportal con otra autoridad intermedia. Cómo se comprueba y se cambia: [registro-oficial.md](../investigacion/registro-oficial.md#certificado-del-geoportal).

## Qué puede hacer el servicio

- Corre como el usuario `celda-nocturna`, sin capacidades ni privilegios nuevos.
- Solo escribe en su directorio de estado y en el de copias: el resto del sistema de ficheros es de solo lectura, y `/home` y `/root` no se ven.
- Su montón de V8 no pasa de `memoria.monton` y el proceso, de `memoria.maxima`. Sin límite, V8 deja crecer el montón con la basura de la publicación hasta 2 GB de RSS con toda España; con 512 MB, la noche más pesada medida acabó con unos 760 MB ([convex.md](convex.md#toda-españa-memoria-y-tiempo)). Si una noche acaba sin memoria («JavaScript heap out of memory» en el diario), sube `memoria.monton`.
- Solo abre sockets IPv4 e IPv6. Sin sockets locales no llega a nscd, así que resuelve los nombres con `/etc/hosts` y el DNS de `/etc/resolv.conf`.
- Filtra las llamadas al sistema a las de un servicio (`@system-service`). No lleva `MemoryDenyWriteExecute`, porque el compilador de V8 escribe y ejecuta su código.

`systemd-analyze security celda-nocturna.service` le da un 1,1 sobre 10 de exposición en la prueba de máquina virtual.
