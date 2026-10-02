# Las capas, solo desde Vercel; R2, almacén privado, y nada de Cloudflare en la ruta pública

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Sustituye tres partes del ADR 0010: R2 como origen principal detrás de un Worker o una Pages Function, la copia de reserva con solo la versión vigente y el cliente con dos orígenes. Del ADR 0008 deja sin objeto el límite de la función que sirve R2. Lo lleva a cabo el #54.

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
