# Convex como fuente canónica, con funciones Effect mediante Confect v10

Estado: aceptada (26/09/2026), tras la exploración técnica 02. Revisada el 28/09/2026 con el ADR 0008: Convex deja de estar expuesto al público y la web ya no tiene cliente de Convex. Revisada el 02/10/2026 con el ADR 0020: cuando la ingesta salga de Convex (#51), Convex solo es el buzón de las aportaciones compartidas, con funciones públicas para enviarlas. Revisada el 03/10/2026 con el #51: la ingesta y la publicación corren en la ingesta nocturna (ADR 0015), y Convex se queda sin tablas, sin funciones y sin crons hasta el buzón (#56).

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
- Dónde corre cada cosa desde el #51 (03/10/2026): la ingesta, la fusión y la publicación, en la
  ingesta nocturna de `apps/nocturna`, con su estado en SQLite (ADR 0015); Convex no tiene tablas,
  ni funciones, ni crons. Sus primeras funciones serán las públicas del buzón, para enviar
  aportaciones y pedir una identidad (ADR 0020). El público lee la capa y las fichas publicadas
  (ADR 0004, 0008 y 0018).
- Hasta el #51, todas las funciones eran internas. Las llamaban los crons de la ingesta, la
  publicación (una acción de Node al final de cada ingesta) y quien administraba el despliegue con
  la clave de administración.
- La web no tiene cliente de Convex. Hasta el 28/09/2026 leía la ficha con el `WebSocketClient` de
  `@confect/js`; lo que queda de aquel diseño es el puente entre Effect y Solid: una lectura es un
  `Stream` convertido con `Stream.toAsyncIterable` (`leerEnSolid`) y devuelto desde `createMemo`.
  Solid la cancela al cambiar los argumentos o al desmontar.
- Todo cambio de identidad (la clave del emplazamiento) va bajo `<Loading on={clave}>`. Un error en
  una lectura cae en `<Errored>`.
- Las funciones se prueban por su API pública con `@confect/test` (convex-test en memoria) y
  `@effect/vitest`, sin mocks de módulos. Las pruebas que dependan del runtime real se ejecutan
  contra un backend local sin cuenta.
- Versiones exactas: @confect/core, cli, server y test 10.0.0-next.24, effect 4.0.0-rc.117, convex 1.46.0,
  convex-test 0.0.60. Cada subida va en un commit aparte, después de leer el changelog.

## Consecuencias

- Un único lenguaje de esquemas (Effect Schema) de la tabla al componente, con los checks
  aplicados también en el servidor.
- Coste en el cliente: ninguno desde el ADR 0008. El paquete de la web ya no lleva ni Convex ni
  Confect.
- Dependemos de una prerelease que mantiene una sola persona y que cambia a menudo, con 15
  cambios incompatibles en 25 versiones `next`. Si se estanca o se abandona, el plan B es Effect
  en acciones `"use node"` con funciones de Convex sencillas, y las specs se reaprovechan como
  esquemas.
- Hay que ejecutar `confect dev` junto a `convex dev`, y excluir `*.spec.ts` de Vitest.
- Los errores de dominio llegan tipados a quien llama por la API interna; al público no le llega
  ninguno, porque no llama a Convex.

Veredicto completo y evidencias: rama `spike/celda-confect` y el issue de la exploración 02.
