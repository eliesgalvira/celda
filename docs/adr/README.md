# Decisiones de arquitectura

Cada ADR recoge una decisión de `../arquitectura.md`, la propuesta aceptada el 24/09/2026. El número del ADR es el de la decisión en ese documento, para poder seguirla de uno a otro. Las decisiones que no tenían número allí van a partir del 0011.

| ADR | Decisión |
|---|---|
| [0001](0001-monorepo-pnpm-autocontenido.md) | Monorepo pnpm autocontenido con las herramientas de Moli |
| [0002](0002-solid-2-spa-sin-ssr.md) | Solid 2 como SPA, sin SSR |
| [0003](0003-convex-con-confect-v10.md) | Convex como fuente canónica, con funciones Effect mediante Confect v10 |
| [0004](0004-mapa-desde-capas-estaticas.md) | El mapa y las fichas se leen de ficheros estáticos versionados (JSON para Barcelona, fichas en lotes de 128), con marca de agua por vista |
| [0005](0005-simulaciones-puras-interfaz-fija.md) | Simulaciones como funciones puras detrás de una interfaz fija, sin Bend en la v1 |
| [0006](0006-libreria-de-componentes-unico-sitio-con-estilos.md) | La librería de componentes es el único sitio con estilos, y lo impone el lint |
| [0007](0007-aportaciones-locales-formato-definitivo.md) | Las aportaciones se guardan en el dispositivo con su formato definitivo |
| [0008](0008-limites-de-uso.md) | Límites de uso: el público solo lee ficheros estáticos y Convex no tiene funciones públicas |
| [0009](0009-ingesta-y-procedencia.md) | Ingesta automática por fuente, con la procedencia de cada dato |
| [0010](0010-alojamiento.md) | La web en Vercel, las capas y las fichas en R2 (servidas por un Worker o una Pages Function), con copia en Vercel y aviso ante bloqueos |
| [0011](0011-castellano-en-interfaz-y-codigo.md) | Castellano en la interfaz y en los nombres del dominio en el código |
| [0012](0012-fusion-a-15-metros.md) | Fusión: observaciones a 15 m o menos, de cualquier compañía (sustituye la regla del 0009) |
| [0013](0013-busqueda-de-direcciones-con-nominatim.md) | Búsqueda de direcciones con el Nominatim público, solo al pedirla y con su límite de una petición por segundo |
| [0014](0014-barrido-por-zonas-y-ritmo-en-espana.md) | Propuesta: barrido del registro oficial por zonas, en siete noches, y fichas a una cada 5 s |
| [0015](0015-ingesta-y-publicacion-fuera-de-convex.md) | Propuesta: la ingesta y la publicación, como trabajo programado fuera de Convex, con su estado en R2 |
| [0016](0016-capa-por-provincias-con-resumen-nacional.md) | Propuesta: capa por provincias con resumen nacional, indexada en un Worker |
| [0017](0017-provincias-y-municipios-con-el-padron-del-ine.md) | Propuesta: provincias y municipios del IGN como zonas, con el padrón del INE |
