# Monorepo pnpm autocontenido con las herramientas de Moli

Estado: aceptada el 24/09/2026. El 20/10/2026 sale `packages/sim`, con la retirada de las simulaciones del [ADR 0005](0005-simulaciones-puras-interfaz-fija.md).

Celda nace dentro de un archivo privado y se irá a su propio repositorio de código abierto. Por eso su código, su documentación y sus herramientas viven dentro de una sola carpeta, y nada de ella enlaza fuera. Mudarse será copiar la carpeta.

Es un monorepo pnpm con estos paquetes:

```
apps/web/            SPA de Solid 2
convex/              funciones y esquema del backend
packages/dominio/    esquemas y tipos del dominio y fusión de observaciones, sin E/S
packages/ui/         librería de componentes y tema, el único sitio con estilos
packages/ingesta/    extractores por fuente
tools/capas/         generador de capas
docs/                arquitectura.md, adr/
CONTEXT.md           glosario
```

Las herramientas y reglas se copian de Moli, un proyecto previo del autor con Effect v4 y Solid 2 en producción, porque ya funcionan con estas mismas versiones RC:

- catálogo pnpm con versiones exactas;
- vite-plus (`vp`) para build, lint con oxlint, formato y pruebas con vitest;
- `tsgo` con el parche de Effect y las opciones estrictas de `tsconfig`;
- `@effect/language-service` con los avisos tratados como errores;
- las reglas de `oxlint-plugin-moli` y `anti-slop` que no son específicas de Moli.

Una tarea no está terminada hasta que pasan `typecheck` y `lint`.
