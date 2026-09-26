# Las aportaciones se guardan en el dispositivo con su formato definitivo

Estado: aceptada el 24/09/2026.

La v1 no tiene cuentas. Las medidas propias, los puntos elegidos y las correcciones propuestas se guardan en IndexedDB mediante un servicio Effect, `AlmacenLocal`, y la persona puede borrarlas cuando quiera. Aun así se guardan con el mismo esquema versionado que tendrán en el backend: identificador, fecha de creación, versión del esquema y origen.

Compartirlas más adelante solo añadirá un servicio `Sincronizacion` que suba lo local con un identificador de comando idempotente, como en Moli. El modelo de datos no cambia.

El formato concreto del punto elegido, la primera aportación que se guarda, está en `packages/dominio/src/aportacion.ts` y se explica en [docs/patterns/ubicacion.md](../patterns/ubicacion.md) (26/09/2026).
