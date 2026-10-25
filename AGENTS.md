# Celda

Web pública, en castellano, con las antenas de telefonía móvil de España en un mapa. Monorepo pnpm autocontenido: nada de esta carpeta enlaza fuera de ella.

## Antes de dar una tarea por hecha

Desde esta carpeta, dentro de `nix develop`, tienen que pasar:

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
```

Si tocas algo que se ve, construye con `pnpm run build`, sirve con `pnpm run preview` y míralo a 1400 px y a 390 px de ancho.

## Lenguaje

- El glosario de [CONTEXT.md](CONTEXT.md) manda en la interfaz, el código y los mensajes de commit. Usa sus palabras y evita las que marca como _Evitar_.
- Los nombres del dominio van en castellano y sin tildes (`Emplazamiento`, `EstadoMapa`, ADR 0011). Los nombres que imponen las librerías se quedan como son.
- Antes de decidir algo de arquitectura, lee el ADR que lo cubre en [docs/adr](docs/adr/README.md).

## Estilos

Todo lo que se ve sale de `packages/ui`. Una pantalla compone componentes de `@celda/ui`; si le falta un aspecto, añade una variante o un componente a la librería. Lee [docs/patterns/ui.md](docs/patterns/ui.md) antes de tocar la interfaz. La regla `celda/sin-estilos-a-medida` rechaza fuera de `packages/ui` los `style`, las clases propias, las hojas de estilo y los colores sueltos.

## Solid 2

Solid 2 es una RC con API nueva. Lee `apps/web/node_modules/solid-js/CHEATSHEET.md` antes de escribir componentes, y otra vez en cada subida de versión.

- Pasa valores a los componentes (`<X valor={cuenta()} />`) y léelos como `props.valor`. Las props se leen sin desestructurar.
- Escribe señales en manejadores de eventos, en `onSettled` o en la segunda función de `createEffect`. Los memos, la primera función de `createEffect` y el cuerpo de un componente solo leen.
- Abre con `recurso()` (`@celda/ui/recurso.ts`) y una clave estable todo lo que haya que cerrar: GPS, brújula, escuchadores, temporizadores, fotogramas, peticiones, cálculos del Worker. Por qué y cómo: [docs/patterns/efectos.md](docs/patterns/efectos.md).
- Crea una lectura asíncrona en el componente padre y espérala en el hijo, dentro de `<Loading>`.
- En las pruebas, llama a `flush()` después de cambiar una señal y antes de comprobar.

## Pruebas

Vitest en orden aleatorio, con `@effect/vitest` (`it.effect` para lo que devuelve un `Effect`). Los componentes se prueban con `@solidjs/testing-library` sobre happy-dom. Las dependencias reales se sustituyen por capas o funciones de prueba; la regla `no-module-mocking` rechaza los mocks de módulos. Los dobles imitan la API real: entregan al abrirse lo que el navegador entregaría y contestan en otra tarea.

La ingesta, la publicación y Convex tienen su propia guía: [docs/patterns/convex.md](docs/patterns/convex.md). Explica cómo lanzar la ingesta nocturna (`pnpm run ingesta`), cómo se publica, cómo arrancar Convex en local, cómo se modera el buzón (`pnpm -s moderar`, con `--json` para un agente), cómo se prueba cada cosa y qué no hacer contra las fuentes reales. Proponer un veredicto no cambia nada; aceptar, rechazar o vetar solo con la confirmación del usuario.

La ingesta nocturna se empaqueta con Nix y corre con un módulo de NixOS: [docs/patterns/nixos.md](docs/patterns/nixos.md). Si tocas `nix/` o las dependencias de `apps/nocturna`, pasa también `nix flake check`.

## Rendimiento

Antes de tocar algo que afecte a la carga o a la fluidez del mapa, lee [docs/patterns/rendimiento.md](docs/patterns/rendimiento.md): qué se midió, qué se descartó y cómo repetir la medida con `tools/rendimiento`.

## Herramientas

Qué hace cada herramienta y qué hubo que ajustar para las RC: [docs/patterns/herramientas.md](docs/patterns/herramientas.md). Las versiones se fijan exactas en el catálogo de `pnpm-workspace.yaml` y se suben en commits propios.

## Incidencias y documentos de agentes

Las incidencias están en GitHub Issues de eliesgalvira/celda y se manejan con `gh` ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)). Las etiquetas de triaje son `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` y `wontfix` ([docs/agents/triage-labels.md](docs/agents/triage-labels.md)). El glosario y los ADR están en la raíz ([docs/agents/domain.md](docs/agents/domain.md)).
