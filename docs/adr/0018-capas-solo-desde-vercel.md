# Las capas, solo desde Vercel; R2, almacén privado, y nada de Cloudflare en la ruta pública

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Sustituye tres partes del ADR 0010: R2 como origen principal detrás de un Worker o una Pages Function, la copia de reserva con solo la versión vigente y el cliente con dos orígenes. Del ADR 0008 deja sin objeto el límite de la función que sirve R2. Lo lleva a cabo el #54; lo que se decidió al hacerlo va en «Cómo quedó».

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

**La noche.** `ponerAlDiaVercel` compara el `vigente.json` de R2 con el de `CELDA_ALMACEN_ORIGEN`, que en producción es `https://celda.elies.site/capas` y es también la URL que se apunta con cada versión. El diario dice «Vercel no sirve sitios@…: build lanzado» o «Vercel ya sirve sitios@…: no hace falta otro build». `CELDA_RESERVA_ORIGEN` desaparece, y la opción `origenDeReserva` del módulo de NixOS da un error que dice que va en `origenPublico`.

**El punto abierto, el deploy hook.** Se queda el deploy hook, que ya usaba la noche, y el proyecto de Vercel tiene que estar conectado a Git. El usuario no eligió antes del #54; desplegar con la CLI desde la noche no está hecho, y si se elige es otro ticket.

**Las copias de la base.** Tras el `VACUUM INTO`, la noche comprime la copia con gzip y la sube a `copias/ingesta-<fecha>.sqlite.gz` del mismo cubo, con la clave de la ingesta (`AlmacenDeCopias`, `copiasEnR2`). Allí se conservan tantas como en el disco (`copias.conservar`, 14). Si la subida falla, queda en el diario y la noche acaba bien. La subida se hace en una sola petición, firmada con su contenido, así que la copia comprimida pasa entera por la memoria del proceso. La clave de solo lectura del build también ve `copias/`: R2 da permisos por cubo, no por prefijo, y la base solo guarda lo que ya dicen las fuentes públicas.

**Lo que hace el usuario** está en `docs/patterns/nixos.md`, «Las cuentas de R2 y Vercel»: quitar el acceso público del cubo, crear la clave de solo lectura y ponerla en las variables de producción de Vercel, la alerta de facturación, conectar el proyecto a Git para el hook y borrar el Worker de la exploración 05 si se llegó a desplegar. Ese Worker no está en la rama de Celda: solo en la de la exploración.

## Consecuencias

- **Si Vercel cae, Celda cae.** No hay otro origen al que pasar. Se acepta a esta escala. Vercel también ha sido bloqueado alguna vez (ADR 0010); entonces la web lo dice si llega a cargar, y si no carga no hay nada que hacer desde el cliente.
- **R2 no corta al pasar de lo gratuito: cobra el exceso.** El uso es pequeño (unas pocas versiones y las copias de la base, sin lecturas del público), pero hay que poner una alerta de facturación en la cuenta de Cloudflare.
- La cuota diaria de Workers deja de contar: ni el público ni el build pasan por un Worker.
- Una versión nueva se ve cuando acaba el build, unos minutos después de que la noche escriba `vigente.json` en R2.
- Una pestaña abierta durante más de tres publicaciones pide lotes que ya no están. Lee entonces la vigente y lo dice, como explica el ADR 0004.
- La web en producción lee de `/capas`, en su mismo origen, sin `VITE_CAPAS_ORIGEN`. La URL pública que la ingesta apunta con cada versión (`origenPublico`, `CELDA_ALMACEN_ORIGEN`) pasa a ser la de Vercel, y `origenDeReserva` sobra.
- El mapa base sigue siendo OpenFreeMap, en Cloudflare, y durante un bloqueo cae (ADR 0010: se pintan los emplazamientos sobre un fondo liso y se dice). Cambiarlo queda fuera de este ADR.

## Alternativas descartadas

- **Todo en Cloudflare Pages.** La carga no lo pide, y durante un partido la primera visita no recibe ni el HTML (ADR 0010).
- **R2 detrás de un Worker como origen principal, con Vercel de reserva**, lo que había. Dos orígenes, CORS, hasta 3 s de espera en cada bloqueo y la cuota diaria de Workers, para un público que cabe entero en Vercel.
- **Subir las capas con la CLI de Vercel.** Las fichas de España no caben en los 100 MB.
- **Solo la versión vigente en Vercel**, como la copia de reserva. Cada publicación dejaría sin lotes a las pestañas abiertas.
