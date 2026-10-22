# Celda

Celda enseña, con los datos oficiales, qué antenas de móvil hay en un sitio, de qué compañía son, en qué bandas emiten y qué ha medido el ministerio a su alrededor, y explica a quién acudir cuando algo va mal. Está en celda.elies.site.

El mapa abre con un punto por emplazamiento del registro oficial, y al acercarse salen los logos de sus compañías y la fecha de los datos. La ficha de cada emplazamiento dice en qué bandas emite cada compañía y desde cuándo lo publica el registro. «Si algo va mal», en «Funciones», dice a quién se acude en cada problema, en qué orden y con qué plazos. La ingesta barre el registro de toda España por zonas, y de las provincias que aún no ha barrido el mapa dice que no las tiene. El primer fin de semana de cada mes la ingesta lee las fuentes, las fusiona en emplazamientos y publica la instantánea como capas estáticas por provincia que la web descarga. El glosario está en [CONTEXT.md](CONTEXT.md) y las decisiones en [docs/adr](docs/adr/README.md).

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

El origen local de las capas se arranca aparte, con lo que haya publicado la ingesta nocturna o con una España sintética; ver [docs/patterns/convex.md](docs/patterns/convex.md#publicación). Sin ellos la web enseña el mapa base y dice que no ha podido cargar los emplazamientos.

El entorno trae Node 24, pnpm 10, tippecanoe y pmtiles.

## Estructura

```
apps/web/                 la web, una SPA de Solid 2
apps/nocturna/            la ingesta nocturna fuera de Convex, con su estado en SQLite
apps/moderacion/          la herramienta de moderación del buzón (`pnpm -s moderar`)
convex/                   Convex con Confect: el buzón de las aportaciones compartidas (ADR 0020)
packages/dominio/         tipos y esquemas del dominio y la fusión, sin E/S
packages/ingesta/         extractores de las fuentes, el barrido por zonas y la cola de fichas
packages/publicacion/     publicación de la capa y las fichas en una carpeta o en R2
packages/ui/              componentes y tema: el único sitio con estilos
tools/capas/              límites de barrio y de municipios, España sintética y origen estático local
tools/oxlint-plugin-celda reglas de lint propias
docs/                     arquitectura, ADR y patrones
nix/                      módulos del flake: entorno, paquete y módulo de NixOS de la ingesta
```

## Integración continua

`.github/workflows/celda.yml` comprueba tipos, lint, formato, pruebas y build con este mismo entorno Nix, y construye con Nix el paquete de la ingesta nocturna. Mientras Celda viva dentro de otro repositorio, ese fichero está en la raíz de aquel. Al mover Celda a su propio repositorio, se mueve con ella.

## Datos del mapa

El callejero es de [OpenFreeMap](https://openfreemap.org), con datos de [OpenMapTiles](https://www.openmaptiles.org/) y de los colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright).
