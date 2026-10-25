# API pública: una función de Vercel que lee la publicación vigente de su propio origen

Estado: aceptada el 25/10/2026, con la decisión del usuario del mismo día. Añade una función pública a lo que fijó el ADR 0008, que solo dejaba al público leer ficheros estáticos. La documentación para quien la use está en [docs/api.md](../api.md).

## Contexto

Celda quiere que sus datos sirvan para construir otras cosas, y no solo para su mapa. Los ficheros de `/capas` ya son públicos: el mapa los lee desde el mismo origen y Vercel los sirve con `Access-Control-Allow-Origin: *`. Pero leerlos para una pregunta sencilla, como qué emplazamientos hay a 500 m de un punto, obliga a entender el formato 8 por columnas, a elegir las provincias que toca el círculo y a calcular las distancias.

Lo que pide la API mínima:

- buscar los emplazamientos más cercanos a un punto, con su distancia y sus compañías;
- llegar desde cada uno a su ficha, con las bandas y las medidas de exposición del ministerio;
- no costar dinero con poco tráfico, y no dejar que unas pocas IP agoten la cuota.

El plan Hobby de Vercel incluye al mes un millón de invocaciones de funciones, 4 horas de CPU activa, un millón de peticiones a la CDN y 100 GB de transferencia, para uso personal sin ánimo de lucro. Al pasarse no cobra: deja de servir hasta el mes siguiente. Incluye además una regla de límite de peticiones del cortafuegos por proyecto, de ventana fija y por IP, que contesta 429 antes de llegar a la función. El 25/10/2026, `vercel firewall status` dice que el proyecto no tenía ninguna regla y que «Bypass» pide Pro o Enterprise, así que el equipo está en Hobby.

## Decisión

- **Una función de Vercel, `GET /api/emplazamientos`**, en `apps/web/api/emplazamientos.ts`. Recibe `lat`, `lon`, `radio` (hasta 10 km), `compania` y `limite` (hasta 50), y devuelve los emplazamientos dentro del radio, del más cercano al más lejano, con `total` y `hayMas` cuando hay más que el límite. No pagina: con 10 km y 50 resultados no hace falta, y un cursor tendría que caducar con cada publicación.
- **Lee los mismos ficheros que el mapa, por HTTP, de su propio origen**: `vigente.json`, el resumen de esa versión y las capas de las provincias cuya caja de emplazamientos queda a `radio` metros del punto o menos. Nunca pide nada a R2, a Convex ni al ministerio. Toda una respuesta sale de la versión del `vigente.json` que leyó, y el resumen se comprueba contra ella como en la web (`leerResumen`).
- **Lo leído se queda en la memoria de la instancia.** El resumen y las capas se nombran por su contenido y no cambian; se guardan hasta 64 ficheros. `vigente.json` se vuelve a leer a los cinco minutos. Una lectura que falla no se guarda, y la consulta contesta 503.
- **Las fichas no pasan por la función.** Cada emplazamiento de la respuesta lleva la URL de su lote de fichas en `/capas` y el enlace a su ficha en el mapa. Quien quiera las bandas o las medidas de exposición las lee del fichero estático, que la CDN sirve sin gastar invocaciones.
- **La caché.** Una respuesta lleva `Cache-Control: public, max-age=300, s-maxage=86400`. Los datos solo cambian con un despliegue nuevo, y cada despliegue vacía la caché de la CDN, así que la caché compartida puede guardar una respuesta un día sin servir datos viejos. Los errores llevan `no-store`.
- **El límite.** La regla del cortafuegos «API: 60 por minuto por IP» (`rule_api_60_por_minuto_por_ip_CaybMH`, ventana fija de 60 s, por IP, para las rutas que empiezan por `/api/`) se creó y publicó con `vercel firewall` el 25/10/2026. La regla vive en la configuración del proyecto en Vercel y no en el repositorio: `vercel.json` no admite reglas del cortafuegos.
- **La consulta es estricta.** Un parámetro desconocido o repetido da 400 en lugar de ignorarse, para que `radius=500` no devuelva en silencio el radio por defecto. Los mensajes van en castellano.
- **La respuesta lleva las licencias** de `vigente.json`, con el crédito que pide el registro oficial (ADR 0021).

## Cómo quedó

- **La lógica va en `apps/web/src/api/`**: `consulta.ts` lee los parámetros con esquemas de Effect, `publicacion.ts` lee y guarda los ficheros, `cercanos.ts` busca y ordena, `respuesta.ts` tiene los esquemas de lo que se contesta y `emplazamientos.ts` lo junta. La función de `apps/web/api/` solo monta el entorno una vez por instancia y le pasa cada petición.
- **El dominio se importa por ruta relativa** (`../../../../packages/dominio/src/…`). El compilador de funciones de Vercel convierte los `.ts` del paquete en `.js` y reescribe las rutas relativas, pero no el `exports` de `@celda/dominio`, que apunta a `./src/*.ts`: con el nombre del paquete, la función fallaría en producción con `ERR_MODULE_NOT_FOUND`. Se comprobó con `vercel build` y ejecutando la función en una carpeta aparte.
- **`apps/web/api/tsconfig.json`** comprueba la función sin los tipos de `vite/client`, y `pnpm run typecheck` de la web pasa también por ella. La reescritura de `vercel.json` a `index.html` deja fuera `/api/`.
- **La huella de la web incluye el código de la API.** La señal de despliegue del #78 solo miraba `dist`, `vercel.json` y `vercel.sh`, y la función no deja nada en `dist`: un cambio solo en la API no se habría desplegado nunca. Ahora entran `api/` y `src/api/`, sin las pruebas ni sus ayudas (`CODIGO_DE_LA_API` en `packages/publicacion/src/despliegue.ts`), y la clave de la caché de la huella pasa a `celda-web-huella-2-`. El dominio que importa la función no entra: son los mismos lectores que usa la web, y un cambio en ellos cambia `dist`.
- **La función ocupa 4,1 MB**, casi todo Effect, lejos de los 250 MB del límite.
- **Medido el 25/10/2026 contra la publicación `sitios@2026-10-21T22:30:02Z`**, desde fuera de Vercel:
  - La capa de provincia más grande, Madrid, pesa 217 KB y se lee con su esquema en 18 ms; el resumen, 14 KB, en 4 ms.
  - Una instancia nueva hace tres peticiones para una consulta en Madrid (`vigente.json`, el resumen y la capa de Madrid) y tardó 0,5 s. La misma consulta después, ninguna petición y 1 ms. Un círculo de 10 km en Soria pidió tres capas, Soria, La Rioja y Navarra, porque sus cajas lo tocan. Un punto entre Madrid y Toledo devuelve emplazamientos de las dos.

## Consecuencias

- La regla del cortafuegos frena a una IP, pero no pone un techo global: muchas IP pueden sumar más. El techo de gasto lo pone el plan Hobby, que corta en lugar de cobrar. Si el uso pasara de la cuota, se pararían a la vez la API y la web, que comparten proyecto. Mientras el público sea el previsto en el ADR 0018, no llega.
- Detrás de una IP compartida, como un CGNAT o una red de universidad, varias personas reparten los 60 por minuto.
- La función pide los ficheros a la CDN de su propio dominio: cada fichero leído por una instancia nueva gasta una petición de CDN, no de R2.
- En un despliegue de vista previa protegido por la autenticación de Vercel, la función no puede leer `/capas` de su propio origen y contesta 503. En producción no hay protección.
- Cambiar el formato de las capas obliga a revisar la función, porque los lee con los mismos lectores del dominio.

## Alternativas descartadas

- **Un índice preparado en el build y empaquetado con la función** (`functions.includeFiles` en `vercel.json`). Ahorra las tres peticiones de una instancia nueva, pero añade un paso al build y un fichero más que mantener al día con la versión publicada. Leer y analizar las capas cuesta milisegundos, y con la caché por instancia solo se paga una vez.
- **Leer de R2.** Es privado desde el ADR 0018, cobra los excesos por operación y está en Cloudflare, que algunos proveedores españoles bloquean durante los partidos de LaLiga.
- **Copiar los emplazamientos en Convex.** Habría que cargar 35.000 emplazamientos y sus fichas cada mes, la copia podría separarse de lo que enseña el mapa, y las consultas gastarían del mismo millón de llamadas al mes que necesita el buzón (ADR 0020).
- **Envolver también las fichas en la función.** Gastaría una invocación por ficha para devolver un fichero que la CDN ya sirve.
- **Cloudflare Workers con D1.** Su plan gratuito cubre 100.000 peticiones al día, pero vuelve a poner Cloudflare en la ruta pública, que el ADR 0018 quitó.
