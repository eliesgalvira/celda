# Solid 2 como SPA, sin SSR

Estado: aceptada el 24/09/2026.

La web se renderiza en el cliente con `@solidjs/vite-plugin` en modo SPA, como la web de Moli. SolidStart ya no existe y lo sustituye el «start mode» del mismo plugin, que queda para cuando haga falta SSR. Hoy la única necesidad de SSR sería una página por emplazamiento con vista previa para compartir en X, y eso se puede resolver con una función en el borde que genere solo las etiquetas meta.

Las rutas usan el router mínimo de Moli, una señal de ubicación con constructores `ruta.*`, porque `@solidjs/router@2` sigue en `next`.

## Consecuencias

Solid 2 es una RC (`2.0.0-rc.9` al decidirlo; la versión de ahora va en el catálogo de `pnpm-workspace.yaml`). Se asume el riesgo en una web pública nueva con versiones exactas, actualizaciones en commits deliberados y lectura del `CHEATSHEET.md` del paquete en cada subida. Se siguen las convenciones de Moli para Solid 2:

- no desestructurar props;
- no escribir señales dentro de memos ni en el cuerpo de un componente;
- no crear una lectura y esperarla en el mismo cuerpo.
