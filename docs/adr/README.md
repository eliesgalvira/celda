# Decisiones de arquitectura

Cada ADR recoge una decisión de `../arquitectura.md`, la propuesta aceptada el 24/09/2026. El número del ADR es el de la decisión en ese documento, para poder seguirla de uno a otro. Las decisiones que no tenían número allí van a partir del 0011.

| ADR | Decisión |
|---|---|
| [0001](0001-monorepo-pnpm-autocontenido.md) | Monorepo pnpm autocontenido con las herramientas de Moli (sin `packages/sim` desde el 20/10/2026) |
| [0002](0002-solid-2-spa-sin-ssr.md) | Solid 2 como SPA, sin SSR |
| [0003](0003-convex-con-confect-v10.md) | Convex como fuente canónica, con funciones Effect mediante Confect v10 (desde el 0015 y el 0020, solo el buzón de aportaciones) |
| [0004](0004-mapa-desde-capas-estaticas.md) | El mapa y las fichas se leen de ficheros estáticos versionados (JSON, desde el formato 5 por provincias; fichas en lotes de 128), con marca de agua por vista |
| [0005](0005-simulaciones-puras-interfaz-fija.md) | Simulaciones como funciones puras detrás de una interfaz fija, sin Bend en la v1 (retirada el 20/10/2026: Celda ya no simula nada) |
| [0006](0006-libreria-de-componentes-unico-sitio-con-estilos.md) | La librería de componentes es el único sitio con estilos, y lo impone el lint |
| [0007](0007-aportaciones-locales-formato-definitivo.md) | Las aportaciones se guardan en el dispositivo con su formato definitivo |
| [0008](0008-limites-de-uso.md) | Límites de uso: el público solo lee ficheros estáticos y Convex no tiene funciones públicas |
| [0009](0009-ingesta-y-procedencia.md) | Ingesta automática por fuente, con la procedencia de cada dato (antenasmoviles.es la retira el 0019) |
| [0010](0010-alojamiento.md) | La web en Vercel, las capas y las fichas en R2 (servidas por un Worker o una Pages Function), con copia en Vercel y aviso ante bloqueos (en parte sustituida por el 0018) |
| [0011](0011-castellano-en-interfaz-y-codigo.md) | Castellano en la interfaz y en los nombres del dominio en el código |
| [0012](0012-fusion-a-15-metros.md) | Fusión: observaciones a 15 m o menos, de cualquier compañía, y hasta 60 m la misma estación y 30 m la misma dirección (sustituye la regla del 0009); desde el 07/10/2026, con claves estables |
| [0013](0013-busqueda-de-direcciones-con-nominatim.md) | Búsqueda de direcciones en toda España con el Nominatim público, solo al pedirla y con su límite de una petición por segundo (el 0025 amplía los topónimos) |
| [0014](0014-barrido-por-zonas-y-ritmo-en-espana.md) | Barrido del registro oficial por zonas, Cataluña primero y luego toda España, y fichas a una cada 3 s por defecto (a una por segundo en producción desde el 07/10/2026), sin correos al ministerio (los turnos de zonas y las fichas de cada noche los sustituye el 0029) |
| [0015](0015-ingesta-y-publicacion-fuera-de-convex.md) | La ingesta y la publicación, fuera de Convex, como servicio de NixOS con su estado en SQLite (el 0029 cambia su temporizador) |
| [0016](0016-capa-por-provincias-con-resumen-nacional.md) | Capa por provincias con resumen nacional, indexada en un Worker (el 0024 cambia el zoom del resumen y el sitio de los hexágonos; el 0026 le añade las combinaciones de compañías) |
| [0017](0017-provincias-y-municipios-con-el-padron-del-ine.md) | Provincias y municipios del IGN como zonas, con el padrón del INE (en parte sustituida por el 0024: sin ausencias en el mapa) |
| [0018](0018-capas-solo-desde-vercel.md) | Las capas y las fichas solo desde Vercel, montadas en su build desde un R2 privado, sin nada de Cloudflare en la ruta pública (sustituye parte del 0010); desde el #78, se despliega desde GitHub Actions solo cuando cambian la web o los datos |
| [0019](0019-fuentes-registro-y-aportaciones-propias.md) | Las fuentes son el registro oficial y las aportaciones propias; se retira antenasmoviles.es y, el 07/10/2026, se descarta OpenCelliD |
| [0020](0020-buzon-de-aportaciones-en-convex.md) | Buzón de aportaciones en Convex, con límites por dispositivo, IP y en total, sin captcha, sin imágenes y con moderación |
| [0021](0021-licencias.md) | CC0 para los datos y las aportaciones, 0BSD para el código, y los datos de terceros con su crédito |
| [0022](0022-mapa-base-como-google-y-foto-aerea.md) | Mapa base al estilo de Google Maps (paleta A) y la foto aérea del PNOA como función aparte, con «Edificio» |
| [0023](0023-limites-de-comunidades-y-provincias.md) | Límites de comunidades y provincias en ficheros propios servidos por la web: uno general de 8 KB y uno de detalle de 37 KB desde z7 |
| [0024](0024-datos-discretos-y-rotulos-sobre-los-datos.md) | Datos discretos: hexágonos más pequeños de lejos, rótulos por población, centro visual de cada provincia, sin ausencias en el mapa y sin rótulos extranjeros por debajo de z9 |
| [0025](0025-nombres-de-lugar-oficiales-en-una-sola-forma.md) | Nombres de lugar: el oficial, en una sola forma (la local en la Comunitat Valenciana, la castellana en el resto) |
| [0026](0026-filtro-de-companias-con-la-red-que-usan.md) | Filtro de compañías en chips, con la red de Movistar que usa DIGI y la de Orange que usa Yoigo aparte, celdas del filtro (retiradas el 20/10/2026 con el 0005) y combinaciones de compañías en el resumen sin cambiar de formato |
| [0027](0027-archivo-de-paginas-e-historial-del-registro.md) | Archivo privado de las páginas del registro, aparte de la base y con copia incremental en R2; el historial de cada registro con los hechos tal como los escribe el registro, publicado en las fichas; y la parada de la noche ante un cambio masivo |
| [0028](0028-vista-de-puntos.md) | Vista de puntos por defecto, con la agrupada como opción en «Funciones»: los puntos de toda España en un fichero del formato 8, tocar que acerca o abre sin saltar a la calle, la lista para el teclado, el paso animado a los logos y el vuelo al cambiar de vista |
| [0029](0029-una-ejecucion-al-mes-en-fin-de-semana.md) | Una ejecución de ingesta al mes, el primer sábado, con la del domingo siguiente para lo que quede: las siete zonas y todas las fichas en un día, a una por segundo, sin correr nunca entre semana |
| [0030](0030-baremo-de-exposicion.md) | La ficha enseña las medidas de exposición del ministerio frente a 200 µW/cm² y a la más alta de España y, con un baremo por provincia que calcula el montaje de las capas, frente a las de su municipio o su provincia teniendo en cuenta la distancia |
| [0031](0031-la-mision-de-celda.md) | La misión de Celda: con los datos oficiales, qué antenas de móvil hay en un sitio, de qué compañía son, en qué bandas emiten y qué ha medido el ministerio a su alrededor, y a quién acudir cuando algo va mal; sin simular nada ni reclamar por nadie |
