# Convex como fuente canónica, con funciones Effect mediante Confect v10

Estado: aceptada (26/09/2026), tras la exploración técnica 02.

## Contexto

Celda guarda en Convex los emplazamientos canónicos, las observaciones de cada fuente, las
correcciones, las ejecuciones de la ingesta y las versiones de las capas. Queremos Effect 4 en
todas las capas, y Convex ejecuta sus funciones en su propio runtime V8. Confect v10
(10.0.0-next.24) promete escribir esas funciones con Effect. La exploración 02 lo comprobó
contra un backend local real (código en `spikes/confect/`).

## Decisión

- Las funciones de Convex se escriben con Confect v10: una tabla por fichero en `confect/tables/`
  con esquema Effect, y pares `*.spec.ts`/`*.impl.ts` por grupo. Los errores de dominio se
  declaran en la spec (`Schema.TaggedError`) y llegan tipados a cada cliente.
- `convex/` y `confect/_generated/` son código generado (`confect codegen`/`confect dev`) y no se
  editan a mano.
- En el cliente, el `WebSocketClient` de `@confect/js` vive en un `ManagedRuntime`. Cada lectura en
  vivo es su `reactiveQuery` (un `Stream`) convertido con `Stream.toAsyncIterable` y devuelto desde
  `createMemo`. Solid libera la suscripción al cambiar los argumentos o al desmontar. No hay
  adaptador `vivo()` propio.
- Todo cambio de identidad (`idEmplazamiento`) va bajo `<Loading on={id}>`. Un error de dominio en
  una lectura en vivo cae en `<Errored>`.
- Las funciones se prueban por su API pública con `@confect/test` (convex-test en memoria) y
  `@effect/vitest`, sin mocks de módulos. Las pruebas que dependan del runtime real se ejecutan
  contra un backend local sin cuenta.
- Versiones exactas: @confect/* 10.0.0-next.24, effect 4.0.0-rc.117, convex 1.46.0,
  convex-test 0.0.60. Cada subida va en un commit aparte, después de leer el changelog.

## Consecuencias

- Un único lenguaje de esquemas (Effect Schema) de la tabla al componente, con los checks
  aplicados también en el servidor.
- Coste en el cliente: unos 5 kB gzip sobre el Effect que ya lleva la app (76,6 kB gzip en total
  con Solid, Convex y Effect).
- Dependemos de una prerelease que mantiene una sola persona y que cambia a menudo, con 15
  cambios incompatibles en 25 versiones `next`. Si se estanca o se abandona, el plan B es Effect
  en acciones `"use node"` con funciones de Convex sencillas, y las specs se reaprovechan como
  esquemas.
- Hay que ejecutar `confect dev` junto a `convex dev`, y excluir `*.spec.ts` de Vitest.
- La consola del navegador mostrará los errores de dominio como «Server Error». Es ruido conocido.

Veredicto completo y evidencias: rama `spike/celda-confect` y el issue de la exploración 02.
