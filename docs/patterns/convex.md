# Convex e ingesta

Cómo está montado el backend, cómo se arranca en local y cómo se prueba. Las decisiones están en los ADR 0003 (Confect), 0009 (ingesta) y 0012 (fusión).

## Dónde está cada cosa

```
convex/confect/tables/     una tabla por fichero, con esquema Effect
convex/confect/*.spec.ts   la API de cada grupo (ingesta, datos)
convex/confect/*.impl.ts   su implementación
convex/confect/crons.ts    el cron nocturno de la ingesta
convex/src/proceso.ts      el proceso de una ejecución, fuera de Convex
convex/convex/             generado por Confect y Convex; no se edita
packages/ingesta/          extractores, sin nada de Convex
packages/dominio/          esquemas y la fusión, sin E/S
```

`convex/convex/` y `convex/confect/_generated/` se guardan en git: las pruebas en memoria los necesitan. `pnpm run typecheck` ejecuta `confect codegen` antes de `tsc`, así que un cambio en una spec sin regenerar sale en los tipos.

La acción `ingesta:registroOficial` es fina: lee la configuración, monta el extractor real sobre `FetchHttpClient` y llama a `ejecutarIngesta`. Todo lo que hace el proceso pasa por funciones internas de Convex (`MutationRunner` y `QueryRunner` de Confect), y así se prueba igual en memoria que en el backend real.

## Backend local

Sin cuenta, con el modo anónimo de Convex, en los puertos 3240 (API) y 3241 (acciones HTTP). Desde `convex/`, dentro de `nix develop`:

```sh
pnpm run backend        # confect codegen + convex dev; déjalo en otra terminal
```

Guarda el estado en `.convex/` y la URL en `.env.local`, los dos fuera de git. Para empezar de cero, para el backend y borra `.convex/local` y `.env.local`.

Nada más desplegar, el cron queda programado para las 2:15 UTC. Si no quieres que el backend local descargue de verdad esa noche, apaga el interruptor:

```sh
pnpm exec convex run ingesta:cambiarInterruptor '{"fuente":"registro-oficial","activo":false,"motivo":"backend local"}'
```

Otras órdenes útiles:

```sh
pnpm exec convex env set CELDA_INGESTA_MAX_FICHAS 5   # pocas fichas en una prueba real
pnpm exec convex run ingesta:registroOficial          # una ejecución ahora, con descarga real
pnpm exec convex run ingesta:estado                   # interruptores y últimas ejecuciones
pnpm exec convex run datos:version                    # versión de los datos y «consultado el»
pnpm exec convex run datos:ficha '{"clave":"movistar-0802532"}'
pnpm exec convex run ingesta:recalcularFusion         # vuelve a fusionar sin descargar nada
pnpm exec convex export --path /tmp/celda.zip         # todas las tablas en JSONL
```

`unzip` rechaza el zip de `convex export` como posible bomba; se abre con `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE unzip`.

Una descarga real del registro oficial hace unas 11 peticiones con 5 fichas: `robots.txt`, 5 de listado y las fichas, con 3 s entre cada una. Hazla solo cuando haga falta y con el interruptor apagado después.

### Lo que hay que saber

- `convex dev` no siempre vuelve a desplegar cuando cambian `src/` o los paquetes del monorepo. Si el log no dice «Convex functions ready» con la hora nueva, toca un fichero de `convex/convex/` o reinicia el backend.
- Convex corta una función que lee más de 4096 documentos. Por eso la fusión lee las observaciones y las claves por páginas de 1000 y escribe los emplazamientos en lotes de 100. `cerrarBarrido` lee de una vez las observaciones de una fuente (unas 2400 en la caja de Barcelona); para una zona más grande habría que repartirlo.
- La primera descarga real, sin el parámetro `zoom` y con las coordenadas tal cual, recibió `{}`. Con `zoom=4` y seis decimales, como el visor y los scripts de la investigación, llegaron los 2380 registros. Por eso una zona entera vacía cuenta como fallo de la fuente y no como «no hay estaciones».
- `TextDecoder` en el runtime de Convex solo garantiza UTF-8; el Latin-1 del geoportal se decodifica a mano (`packages/ingesta/src/texto.ts`).

## Pruebas

Tres niveles, todos con `@effect/vitest` y sin mocks de módulos.

**Dominio.** La fusión se compara con ficheros de referencia en `packages/dominio/src/referencia/` y `packages/ingesta/src/registro-oficial/referencia/` (`toMatchFileSnapshot`). Si cambias la regla a propósito, regenera con `pnpm exec vp test run -u` en el paquete y revisa el diff de los JSON en el commit.

**Extractor.** `packages/ingesta/src/registro-oficial/extractor.test.ts` monta el extractor real sobre un `HttpClient` de prueba (una `Layer`) que apunta cada petición con la hora del `TestClock`. Así se comprueban el `User-Agent`, `robots.txt`, la pausa entre peticiones, los reintentos con espera exponencial y el tope de peticiones. Las esperas se encadenan tras respuestas asíncronas, y un solo `TestClock.adjust` no las ve todas; `esperarConReloj` (`packages/ingesta/src/pruebas/reloj.ts`) adelanta el reloj de segundo en segundo hasta que la fibra termina.

**API de Convex.** `convex/test/` usa `@confect/test` (convex-test en memoria). `ejecutar(extractor)` en `convex/test/ayudas.ts` lanza `ejecutarIngesta` con `MutationRunner` y `QueryRunner` sacados del `TestConfect`, y el extractor que se le pase. El de prueba es `capaGrabada` con `muestraCampusNord`, el registro grabado en la investigación. Para comprobar que una ejecución no escribe nada, adelanta el reloj un día y compara `instantanea` antes y después: cualquier escritura por cambio habría movido una fecha.

El glob de la documentación de Confect no encuentra `convex/_generated` con Vite 8. `convex/test/TestConfect.ts` usa `import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"])`.

La prueba de carga `convex/scripts/prueba-de-carga.sh` mete 2400 observaciones falsas en el backend local y fusiona dos veces. Deja basura: úsala en un backend que vayas a borrar.
