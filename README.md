# Celda

Celda es una web que enseña en un mapa las antenas de telefonía móvil de Barcelona: de qué compañía son y cómo llega su señal. Estará en celda.elies.site.

Hoy muestra sobre el mapa de Barcelona los emplazamientos del registro oficial, con los logos de las compañías que emiten en cada uno y la fecha de los datos. El panel de cada emplazamiento dibuja el diagrama de radiación de sus sectores, un modelo calculado en un Web Worker. El backend recoge cada noche el registro oficial y lo fusiona en emplazamientos, y `tools/capas` publica esa instantánea como una capa estática que la web descarga. El resto llega por partes; el glosario está en [CONTEXT.md](CONTEXT.md) y las decisiones en [docs/adr](docs/adr/README.md).

## Arrancar

Hace falta Nix con `flakes`, `nix-command` y `pipe-operators`. Desde esta carpeta:

```sh
nix run
```

Instala las dependencias y abre la web en http://localhost:8840.

Para trabajar con las herramientas a mano:

```sh
nix develop
pnpm install
pnpm run dev        # la web en local
pnpm run typecheck  # tipos y diagnósticos de Effect
pnpm run lint
pnpm run test
pnpm run build
```

El backend de Convex y el origen local de las capas se arrancan aparte; ver [docs/patterns/convex.md](docs/patterns/convex.md). Sin ellos la web enseña el mapa base y dice que no ha podido cargar los emplazamientos.

El entorno trae Node 24, pnpm 10, tippecanoe y pmtiles.

## Estructura

```
apps/web/                 la web, una SPA de Solid 2
convex/                   backend de Convex con Confect: tablas, ingesta y API pública
packages/dominio/         tipos y esquemas del dominio y la fusión, sin E/S
packages/ingesta/         extractores de las fuentes, como servicios Effect
packages/sim/             simulaciones puras con su versión y sus resultados de referencia
packages/ui/              componentes y tema: el único sitio con estilos
tools/capas/              generador de la capa de emplazamientos y origen estático local
tools/oxlint-plugin-celda reglas de lint propias
docs/                     arquitectura, ADR y patrones
nix/                      módulos del entorno Nix
```

## Integración continua

`.github/workflows/celda.yml` comprueba tipos, lint, formato, pruebas y build con este mismo entorno Nix. Mientras Celda viva dentro de otro repositorio, ese fichero está en la raíz de aquel. Al mover Celda a su propio repositorio, se mueve con ella.

## Datos del mapa

El callejero es de [OpenFreeMap](https://openfreemap.org), con datos de [OpenMapTiles](https://www.openmaptiles.org/) y de los colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright).
