# Decisiones de arquitectura

Cada ADR recoge una decisión de `../arquitectura.md`, la propuesta aceptada el 24/09/2026. El número del ADR es el de la decisión en ese documento, para poder seguirla de uno a otro. Las decisiones que no tenían número allí van a partir del 0011.

| ADR | Decisión |
|---|---|
| [0001](0001-monorepo-pnpm-autocontenido.md) | Monorepo pnpm autocontenido con las herramientas de Moli |
| [0002](0002-solid-2-spa-sin-ssr.md) | Solid 2 como SPA, sin SSR |
| [0003](0003-convex-con-confect-v10.md) | Convex como fuente canónica, con funciones Effect mediante Confect v10 |
| [0004](0004-mapa-desde-capas-estaticas.md) | El mapa se lee de capas estáticas versionadas, con marca de agua por vista |
| [0005](0005-simulaciones-puras-interfaz-fija.md) | Simulaciones como funciones puras detrás de una interfaz fija, sin Bend en la v1 |
| [0006](0006-libreria-de-componentes-unico-sitio-con-estilos.md) | La librería de componentes es el único sitio con estilos, y lo impone el lint |
| [0007](0007-aportaciones-locales-formato-definitivo.md) | Las aportaciones se guardan en el dispositivo con su formato definitivo |
| 0008 | Pendiente: límites de uso desde el primer día |
| [0009](0009-ingesta-y-procedencia.md) | Ingesta automática por fuente, con la procedencia de cada dato |
| 0010 | Pendiente: alojamiento en Cloudflare, con origen de reserva ante los bloqueos de LaLiga |
| [0011](0011-castellano-en-interfaz-y-codigo.md) | Castellano en la interfaz y en los nombres del dominio en el código |
| [0012](0012-fusion-a-15-metros.md) | Fusión: observaciones a 15 m o menos, de cualquier compañía (sustituye la regla del 0009) |

## Pendientes

Las decisiones 3, 8 y 10 dependen de exploraciones técnicas de la fase 0, y cada una se escribirá cuando su exploración dé el veredicto:

- 0008 espera a la exploración de límites de uso en consultas anónimas de Convex.
- 0010 espera a la exploración de Cloudflare Pages y R2 con el dominio en Vercel, y del origen de reserva.
