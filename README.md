# Celda

Celda es una web que enseña en un mapa las antenas de telefonía móvil de Barcelona: de qué compañía son y cómo llega su señal. Estará en celda.elies.site.

Hoy muestra el mapa base de Barcelona con el tema Hexágono. El resto llega por partes; el glosario está en [CONTEXT.md](CONTEXT.md) y las decisiones en [docs/adr](docs/adr/README.md).

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

El entorno trae Node 24, pnpm 10, tippecanoe y pmtiles.

## Estructura

```
apps/web/                 la web, una SPA de Solid 2
packages/dominio/         tipos y esquemas del dominio, sin E/S
packages/ui/              componentes y tema: el único sitio con estilos
tools/oxlint-plugin-celda reglas de lint propias
docs/                     arquitectura, ADR y patrones
nix/                      módulos del entorno Nix
```

## Integración continua

`.github/workflows/celda.yml` comprueba tipos, lint, formato, pruebas y build con este mismo entorno Nix. Mientras Celda viva dentro de otro repositorio, ese fichero está en la raíz de aquel. Al mover Celda a su propio repositorio, se mueve con ella.

## Datos del mapa

El callejero es de [OpenFreeMap](https://openfreemap.org), con datos de [OpenMapTiles](https://www.openmaptiles.org/) y de los colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright).
