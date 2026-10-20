# Las capas, solo desde Vercel; R2, almacén privado, y nada de Cloudflare en la ruta pública

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Sustituye tres partes del ADR 0010: R2 como origen principal detrás de un Worker o una Pages Function, la copia de reserva con solo la versión vigente y el cliente con dos orígenes. Del ADR 0008 deja sin objeto el límite de la función que sirve R2. Lo lleva a cabo el #54; lo que se decidió al hacerlo va en «Cómo quedó». Revisada el 20/10/2026 con el #78: Celda se despliega desde GitHub Actions, y solo cuando cambian la web o los datos (ver «Cómo quedó el despliegue»).

## Contexto

El ADR 0010 servía las capas y las fichas desde R2, detrás de un Worker, y dejaba en Vercel una copia de reserva con la versión vigente. El cliente pedía a R2 con 3 s de plazo y, si no contestaba, pasaba a la copia.

El 02/10/2026 se revisó con tres datos:

- **El público será pequeño.** La web más visitada del autor tuvo unas 7.000 visitas en una semana. Una visita que abre tres fichas descarga unos 500 KB (ADR 0008), así que una semana así son unos 3,5 GB, frente a los 100 GB al mes y el millón de peticiones de Vercel Hobby. La carga no decide nada, y pasar todo a Cloudflare Pages se descartó.
- **Lo que decide es aguantar los bloqueos de LaLiga.** Durante los partidos, los operadores españoles bloquean rangos de IP de Cloudflare. Comprobado el 02/10/2026: OpenFreeMap y el Worker de R2 están en Cloudflare; Vercel, Nominatim y el mapa base del IGN, que sirve CloudFront, no.
- **El gasto tiene que ser 0 €.**

Hay un límite que condiciona cómo llegan los ficheros a Vercel: una subida por la CLI en Hobby admite 100 MB de ficheros fuente, y las fichas de toda España son unos 135 MB sin comprimir. La salida de un build no tiene ese tope (ADR 0010).

## Decisión

- **Un solo origen.** La web, las capas y las fichas se sirven desde Vercel, en `celda.elies.site` y `celda.elies.site/capas/…`. Nada de lo que carga el público depende de Cloudflare. No hay Worker ni Pages Function en la ruta pública ni peticiones a otro origen: sin CORS, sin peticiones previas y con una conexión TLS menos.
- **R2 es un almacén privado.** La ingesta nocturna publica cada versión en un cubo sin acceso público, por la API S3, con el `AlmacenDeFicheros` de siempre (`almacenEnR2`). La retención de R2 no cambia (ADR 0010).
- **El build monta las capas.** El build de Vercel (`apps/web/scripts/vercel.sh`) descarga de R2, por la API S3 y con una clave de solo lectura, la versión vigente y los ficheros de las dos anteriores, y los deja en `dist/capas`. Las dos anteriores son para las pestañas abiertas con un `vigente.json` viejo: sus capas de provincia y sus lotes siguen ahí y no dan 404. Las versiones comparten los ficheros nombrados por su contenido (ADR 0016), así que cada versión de más solo añade lo que cambió.
- **Por qué en el build.** Subir los ficheros con la CLI no cabe en los 100 MB. El build los lee de servidor a servidor, fuera de España, y los bloqueos no le afectan.
- **Si algo falta, el build falla.** Como hoy: si no llega a R2, si falta un fichero o si una huella no cuadra, el build falla y Vercel sigue sirviendo el despliegue anterior entero. `vigente.json` se escribe el último.
- **Tras publicar, la noche lanza el build.** Punto abierto: el deploy hook de Vercel solo existe con el proyecto conectado a Git. Si no se conecta, la noche despliega con la CLI el código de la web, que es pequeño, y el build descarga las capas igual.
- **Las copias de la base también van a R2.** La copia de seguridad de la base SQLite de la ingesta (ADR 0015) se sube a R2, fuera de casa. Es la parte «copias en otro disco» del #42.
- **Se retira lo que queda de los dos orígenes:** el cliente de `apps/web/src/capa/origenes.ts` (3 s de plazo, una hora de recuerdo y sondeo cada 5 min), `VITE_CAPAS_RESERVA` y el Worker de la exploración 05.
- Cabeceras como en el ADR 0010: los ficheros con versión o huella en el nombre, `public, max-age=31536000, immutable`; `vigente.json`, `public, max-age=0, must-revalidate`; un fichero que no existe da 404 y no la página de la web.

## Cómo quedó (#54)

**El build.** `vercel.sh` exige las cuatro variables de R2 del proyecto (`CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`, de una clave de solo lectura), construye la web sin las credenciales ni `VITE_CAPAS_ORIGEN` y lanza `celda-nocturna capas dist/capas`. La orden lee con el `AlmacenDeFicheros` de R2 por la API S3 (`montarCapas` en `packages/publicacion/src/vercel.ts`, que sustituye a `copiarVigente` y a la lectura por HTTP):

1. lee `vigente.json` una vez, el resumen y el manifiesto de la vigente, y comprueba que el resumen es de esa versión y que el manifiesto lista sus capas;
2. lista el cubo y toma los manifiestos de las dos versiones anteriores a la vigente (`ANTERIORES_EN_VERCEL`); una posterior a la vigente es otra publicación a medias y no se toca;
3. copia una vez cada fichero que listan los tres manifiestos, con su huella comprobada, y reintenta tres veces un fallo del cubo;
4. escribe los manifiestos, el resumen y, al final, `vigente.json`.

Si falta un fichero de cualquiera de las tres versiones, el build falla: es un cubo roto, porque la retención guarda siete anteriores. No se monta el resumen de las anteriores: la pestaña que lo usa ya lo tiene, y al recargar lee la vigente.

**La web.** Solo lee de `/capas`. `VITE_CAPAS_ORIGEN` queda para el desarrollo, que lee del origen estático local de `tools/capas`; el build la quita aunque el proyecto de Vercel la tenga. `/capas` ya no manda `Access-Control-Allow-Origin`.

**Las variables de la web (#83, 20/10/2026).** La web solo lleva las variables de entorno de `VARIABLES_DE_LA_WEB` (`apps/web/src/variables.ts`), y el build falla si `dist` lleva otra `VITE_*`, una `CELDA_R2_*` o el valor de alguna. Antes llevaba todas las `VITE_*` del build, también las `VITE_VERCEL_*` de cada despliegue. Una prueba de `apps/web` comprueba que dos builds del mismo commit con `VITE_VERCEL_*` distintas dan el mismo `dist` byte a byte, sin contar `dist/capas`. Así deja de valer la razón de «Por qué la huella se calcula en GitHub», y la huella de la web del #78 podría calcularla `vercel.sh` sobre lo que construye y sirve. Las variables de la lista sí entran en el JavaScript, de modo que la huella de un build en GitHub solo coincide con la de Vercel si los dos tienen los mismos valores, como el de `VITE_CELDA_CONVEX_URL`.

**La noche.** `ponerAlDiaVercel` compara el `vigente.json` de R2 con el de `CELDA_ALMACEN_ORIGEN`, que en producción es `https://celda.elies.site/capas` y es también la URL que se apunta con cada versión. El diario dice «Vercel no sirve sitios@…: build lanzado» o «Vercel ya sirve sitios@…: no hace falta otro build». `CELDA_RESERVA_ORIGEN` desaparece, y la opción `origenDeReserva` del módulo de NixOS da un error que dice que va en `origenPublico`.

**El punto abierto, el deploy hook.** Se queda el deploy hook, que ya usaba la noche, y el proyecto de Vercel tiene que estar conectado a Git. El usuario no eligió antes del #54; desplegar con la CLI desde la noche no está hecho, y si se elige es otro ticket.

**Las copias de la base.** Tras el `VACUUM INTO`, la noche comprime la copia con gzip y la sube a `copias/ingesta-<fecha>.sqlite.gz` del mismo cubo, con la clave de la ingesta (`AlmacenDeCopias`, `copiasEnR2`). Allí se conservan tantas como en el disco (`copias.conservar`, 14). Si la subida falla, queda en el diario y la noche acaba bien. La subida se hace en una sola petición, firmada con su contenido, así que la copia comprimida pasa entera por la memoria del proceso. La clave de solo lectura del build también ve `copias/`: R2 da permisos por cubo, no por prefijo, y la base solo guarda lo que ya dicen las fuentes públicas.

**Lo que hace el usuario** está en `docs/patterns/nixos.md`, «Las cuentas de R2 y Vercel»: quitar el acceso público del cubo, crear la clave de solo lectura y ponerla en las variables de producción de Vercel, la alerta de facturación, conectar el proyecto a Git para el hook y borrar el Worker de la exploración 05 si se llegó a desplegar. Ese Worker no está en la rama de Celda: solo en la de la exploración.

## Cómo quedó el despliegue (#68, #70 y #78, 20/10/2026)

**Quién despliega.** El punto abierto del hook se cerró con el #68 (04/10/2026) por el otro lado. Despliega un flujo de GitHub Actions, `.github/workflows/celda-despliegue.yml` en la rama `main` del repositorio en el que vive Celda, porque GitHub solo programa los flujos de la rama por defecto. Sube el código de `celda/v1` con la CLI de Vercel y el secreto `VERCEL_TOKEN`, y Vercel construye la web y monta las capas desde R2 como explica «Cómo quedó (#54)». El proyecto de Vercel no está conectado al repositorio, así que no hay deploy hook, y la máquina de la ingesta no guarda ninguna clave de Vercel ni de GitHub. Su configuración no tiene `credenciales.vercel`, y `ponerAlDiaVercel` apunta cada noche «Sin deploy hook de Vercel». Desde el #70, tras un push a `celda/v1` el flujo espera a que la integración continua salga en verde, y solo despliega la punta de la rama.

**Lo que pesa un despliegue.** La web construida son unos 6 MB en 72 ficheros. Las capas pesan mucho más. La versión vigente sola son unos 104 MB en 375 ficheros (medido el 20/10/2026 en `celda.elies.site/capas`), y el build monta también lo que cambió en las dos anteriores. Hasta el #78 se desplegaba cada día a las 08:00 UTC y tras cada push en verde, cambiase algo o no. Desde el 9/10 el almacenamiento de despliegues del equipo crecía unos 130 MB al día, y el 20/10 llegaba a 6,34 GB de los 10 GB de Hobby. Al pasar de 10 GB, Vercel borra en el acto los despliegues viejos y puede bloquear los nuevos.

**La retención de Vercel.** Desde el 20/10/2026 los despliegues se guardan 1 día en todos los estados. La puso el usuario para todo el equipo en el panel de Vercel, y no está en Celda. Hobby guarda siempre los 3 últimos despliegues de producción, así que se puede volver a cualquiera de ellos y a nada más viejo.

**Dos señales (#78).** Un despliegue solo se lanza si algo ha cambiado, como en un sistema de build. La orden `celda-nocturna despliegue` (`packages/publicacion/src/despliegue.ts`) mira dos señales, y el flujo despliega con cualquiera de ellas:

- **La web.** La huella de la web es la de lo que construye `pnpm run build` en `apps/web/dist`, sin `dist/capas` ni `dist/despliegue.json`, junto con `vercel.json` y `scripts/vercel.sh`, que dicen cómo construye y sirve Vercel el despliegue. Es el SHA-256 de la lista de cada fichero con el SHA-256 de su contenido, y la calcula la orden `huella-web`. Si no es la huella que sirve producción en `/despliegue.json`, la web ha cambiado. El flujo pasa la huella y el commit al build de Vercel en `CELDA_DESPLIEGUE`, y `vercel.sh` los escribe en `dist/despliegue.json`. `vercel.json` deja ese fichero fuera de la reescritura a `index.html`, así que si falta da 404.
- **Los datos.** La orden lee de R2 lo que montaría un build nuevo (`planearCapas`, los pasos 1 a 3 de `montarCapas`), con la clave de solo lectura del build de Vercel guardada también como secretos del flujo. Compara byte a byte el `vigente.json` de R2 y los manifiestos de la vigente y de las anteriores que se montarían con los que sirve producción en `/capas`. Los manifiestos no cambian nunca y listan ficheros nombrados por su contenido, así que si coinciden, producción tiene las mismas capas. Una versión nueva, un barrido nuevo con los mismos datos (otro resumen nacional) o un build que pase a montar otra versión anterior cambian la señal.

Si una señal no se puede saber, porque producción no tiene `/despliegue.json`, R2 o Vercel no contestan o al flujo le faltan los secretos de R2, cuenta como un cambio y se despliega. Así una señal rota no deja una versión nueva sin desplegar, y lo peor que pasa es lo de antes del #78, un despliegue en cada ejecución. El registro de cada ejecución dice en una frase cada señal y en otra la decisión, y la última va también al resumen de la ejecución.

**La huella, guardada por commit.** La huella depende solo del commit de `celda/v1`, porque el mismo commit da siempre los mismos bytes. Por eso el flujo la calcula una vez por commit, como una caché de build. La primera ejecución que mira un commit, casi siempre la de tras su integración continua, construye la web con `nix develop` y `pnpm run build`, lanza `huella-web` y guarda la huella en la caché de GitHub Actions con la clave `celda-web-huella-1-<commit>`. Las demás ejecuciones de ese commit, como la de cada día cuando nadie ha empujado, la leen de ahí y no construyen nada. Si la caché no la tiene, se construye otra vez y sale la misma. El `1` de la clave sirve para tirar todas las guardadas si cambia la forma de calcularla. Las tres formas de lanzar el flujo corren en la rama `main`, así que leen y escriben la misma caché.

Se descartó sacar la huella del commit que dice `/despliegue.json`, que el flujo escribe junto a la huella. Solo vale para el commit desplegado. Tras un push que no cambia lo construido, la punta de `celda/v1` deja de ser ese commit, y cada ejecución diaria construiría la web hasta el siguiente despliegue. La caché guarda cualquier commit que se haya mirado, desplegado o no. GitHub borra una entrada que lleva 7 días sin leerse, pero la ejecución diaria lee cada día la de la punta, y una entrada perdida solo cuesta una construcción.

**Si un despliegue falla.** La caché solo guarda la huella de cada commit, y nunca qué está desplegado, que se lee siempre de producción en `/despliegue.json` y en `/capas`. Si el build de Vercel falla, producción sigue sirviendo el despliegue anterior, con su huella y su `vigente.json`. La ejecución siguiente vuelve a ver así las mismas señales y despliega otra vez, con la huella que ya tiene guardada.

**Lo que cuesta una ejecución.** La orden `despliegue` corre desde el paquete de Nix de la ingesta nocturna (`nix run .#celda-nocturna`), el mismo programa que publica en la máquina de la ingesta. Ese paquete solo instala las dependencias de producción de `@celda/nocturna` y de sus paquetes, sin las de la web, y en la integración continua del 20/10/2026 se construyó en 26 s. Con los pasos medidos ahí, una ejecución diaria sin cambios tarda unos 45 s, con unos 5 s para copiar el repositorio, 5 s para instalar Nix, 26 s para el paquete y unos 5 s para leer R2 y producción. GitHub cobra cada trabajo por minutos enteros, así que es 1 minuto al día. La primera ejecución de un commit suma `nix develop` (14 s), `pnpm install` (11 s), `pnpm run build` (6 s) y las cachés, y se queda en 1 o 2 minutos. El despliegue, cuando toca, es otro trabajo de 1 a 2 minutos que espera al build de Vercel.

El trabajo que decide copia el repositorio entero, como la integración continua. La copia parcial de `actions/checkout` (`sparse-checkout`) es un clon parcial (`blob:none`) que solo trae el contenido de los ficheros de la carpeta pedida, y Nix lee el flake de los objetos de git del repositorio entero. El trabajo que despliega sí copia solo la carpeta de Celda, porque la CLI de Vercel sube esa carpeta y no necesita Nix.

**Cuándo se mira.** El flujo mira las señales cada día a las 08:00 UTC, así que una versión nueva en R2 se despliega sola como mucho un día después de publicarse. También las mira tras la integración continua en verde de un push a `celda/v1`, con la punta de la rama. «Run workflow» despliega siempre, aunque las señales digan que no hace falta, y el registro dice igualmente lo que vio cada señal. Sirve para lo que ninguna señal ve, como un cambio en las variables del proyecto de Vercel.

**Por qué la huella de lo construido.** Una lista de rutas que cuentan como web habría que mantenerla a mano, y no ve lo que el build lee sin importarlo. Tailwind busca clases en todo `packages/ui/src`, pruebas incluidas, y las dependencias llegan del lockfile. La huella de lo construido no necesita ninguna lista y no deja pasar ningún cambio de lo construido. Un cambio en la documentación, la ingesta, Nix, una prueba o un comentario no despliega si no cambia lo construido, y cualquier cambio que llegue a lo construido despliega. El build de Vite da los mismos bytes cada vez con el mismo commit (comprobado el 20/10/2026). Cuesta construir la web una vez por commit.

**Por qué la huella se calcula en GitHub.** El build de Vercel mete en el JavaScript las variables de sistema `VITE_VERCEL_*` de cada despliegue, con su identificador y su URL, porque `apps/web/src/entrada.tsx` pasa `import.meta.env` entero a la configuración. Dos builds de Vercel del mismo commit dan bytes distintos. El de GitHub no tiene esas variables ni las del proyecto de Vercel, como `VITE_CELDA_CONVEX_URL`, y da siempre lo mismo. Por eso un cambio en las variables del proyecto de Vercel no cambia ninguna señal y se despliega a mano.

**Por qué la señal de los datos sale de GitHub.** Lo natural sería que la diera quien publica, la ingesta nocturna, pero entonces esa máquina necesitaría una clave de Vercel o de GitHub, y no la tiene a propósito. El cubo es privado y nada publica una copia de su `vigente.json`, así que sin una clave no se puede saber qué tiene R2. Se descartaron una función de Vercel que leyera R2 y lo dijera en público (una función más en una web estática, con la clave de R2 en tiempo de ejecución), un cubo público o `r2.dev` con una copia de `vigente.json` (Cloudflare otra vez, y más trabajo para el usuario) y las URL prefirmadas, que caducan como mucho a los 7 días. Los secretos del flujo son los de la clave que ya usa el build de Vercel, que solo lee. El usuario los pone con `gh secret set` (`docs/patterns/nixos.md`, «Las cuentas de R2 y Vercel»).

**Lo que sigue igual.** El código del deploy hook de la noche (`ponerAlDiaVercel`, `credenciales.vercel`) se queda sin usar en producción. Quitarlo, con su opción del módulo de NixOS y sus pasos de la máquina virtual, es otro ticket.

## Consecuencias

- **Si Vercel cae, Celda cae.** No hay otro origen al que pasar. Se acepta a esta escala. Vercel también ha sido bloqueado alguna vez (ADR 0010); entonces la web lo dice si llega a cargar, y si no carga no hay nada que hacer desde el cliente.
- **R2 no corta al pasar de lo gratuito: cobra el exceso.** El uso es pequeño (unas pocas versiones y las copias de la base, sin lecturas del público), pero hay que poner una alerta de facturación en la cuenta de Cloudflare.
- La cuota diaria de Workers deja de contar: ni el público ni el build pasan por un Worker.
- Una versión nueva se ve cuando acaba el build. Desde el #78, eso pasa como mucho un día después de que la noche escriba `vigente.json` en R2, tras la ejecución diaria del flujo de despliegue.
- Con la ingesta mensual (#77), la señal de los datos llega una o dos veces al mes. Con la retención de un día, Vercel guarda los 3 últimos despliegues de producción y los del último día, unos pocos cientos de MB.
- Una pestaña abierta durante más de tres publicaciones pide lotes que ya no están. Lee entonces la vigente y lo dice, como explica el ADR 0004.
- La web en producción lee de `/capas`, en su mismo origen, sin `VITE_CAPAS_ORIGEN`. La URL pública que la ingesta apunta con cada versión (`origenPublico`, `CELDA_ALMACEN_ORIGEN`) pasa a ser la de Vercel, y `origenDeReserva` sobra.
- El mapa base sigue siendo OpenFreeMap, en Cloudflare, y durante un bloqueo cae (ADR 0010: se pintan los emplazamientos sobre un fondo liso y se dice). Cambiarlo queda fuera de este ADR.

## Alternativas descartadas

- **Todo en Cloudflare Pages.** La carga no lo pide, y durante un partido la primera visita no recibe ni el HTML (ADR 0010).
- **R2 detrás de un Worker como origen principal, con Vercel de reserva**, lo que había. Dos orígenes, CORS, hasta 3 s de espera en cada bloqueo y la cuota diaria de Workers, para un público que cabe entero en Vercel.
- **Subir las capas con la CLI de Vercel.** Las fichas de España no caben en los 100 MB.
- **Solo la versión vigente en Vercel**, como la copia de reserva. Cada publicación dejaría sin lotes a las pestañas abiertas.
