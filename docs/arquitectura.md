# Celda · propuesta de arquitectura

> Las decisiones aceptadas de esta propuesta están en los ADR de [`adr/`](adr/README.md). Si este documento y un ADR no coinciden, vale el ADR.

Estado: **aceptada en lo general el 24/09/2026**; las exploraciones técnicas pueden cambiar las decisiones 3, 8 y 10. Cuando se acepte, cada decisión marcada con ▸ pasa a un ADR en `docs/adr/`.

Fuentes consultadas: un proyecto previo del autor sobre reactividad y el gist `evaluating-solid-2.md` (UI que nunca miente), Moli, un proyecto previo del autor con Effect v4 y Solid 2, y su rama `migration/solid-2` (Effect v4 y Solid 2 en producción), vivero y bendoom, dos proyectos previos del autor con Bend 2, y la documentación de Convex, Confect y Solid 2 a fecha de hoy. El diseño de referencia es el prototipo v8 (rama `prototype/celda-primer-uso`).

## Restricciones de partida

- Solid 2.0 (`2.0.0-rc.9`, sin versión estable), Effect v4 (`4.0.0-rc.117`) y Convex.
- UI que nunca miente: no se muestra nunca un estado incorrecto. Todo dato lleva su origen y su fecha. Un valor pendiente se trata de una de tres maneras honestas: esperar, mostrar el anterior o predecir de forma explícita.
- Sin CSS a medida: las pantallas se componen con la librería de componentes, y el diseño todavía va a cambiar.
- Primera versión: área de Barcelona, sin cuentas, con las aportaciones guardadas en el dispositivo y límites de uso estrictos.
- Pública y de código abierto más adelante: todo vive en una carpeta propia.
- Debe servir de base para experimentos de simulación, y más adelante también con Bend.

## Vista general

```
                 ┌──────────── ingesta (programada) ────────────┐
Registro oficial │  extractores  →  fusión  →  emplazamientos   │  Convex
Comunidad Celda  │  (con límite)    (dominio)   canónicos       │  (tablas, crons,
OpenCelliD       └──────────────────────┬───────────────────────┘   límites de uso)
                                        │ instantánea versionada
                                        ▼
                         generador de capas estáticas
                  (JSON por columnas: emplazamientos, ADR 0004)
                                        │
                                        ▼ CDN
┌──────────────────────────── navegador ───────────────────────────────┐
│ Solid 2 (SPA)  ── lecturas en vivo (ficha) ──►  Convex               │
│   │  MapLibre (mapa base OpenFreeMap) + capa JSON de emplazamientos    │
│   │  Worker: simulaciones (radiación, SINR, celdas)                  │
│   └  IndexedDB: medidas y puntos del usuario (formato definitivo)    │
└──────────────────────────────────────────────────────────────────────┘
```

Las lecturas masivas del mapa, que son todos los emplazamientos a cualquier zoom, se sirven como ficheros estáticos desde una CDN. Convex sirve lo vivo y detallado: la ficha de un emplazamiento, el estado de la ingesta y, más adelante, las aportaciones compartidas. Así cumplimos los límites estrictos por construcción (la CDN absorbe el volumen), el plan gratuito de Convex aguanta y el mapa carga rápido.

## Decisiones

### ▸ 1. Monorepo pnpm con las herramientas de Moli

```
celda/
  apps/web/            Solid 2 SPA
  convex/              funciones y esquema de Convex (Confect)
  packages/dominio/    esquemas Effect y tipos del dominio, sin E/S
  packages/sim/        núcleos de simulación puros (interfaz Simulación)
  packages/ui/         librería de componentes y tema Hexágono
  packages/ingesta/    extractores y fusión de fuentes
  tools/capas/         generador de capas (JSON; PMTiles si la zona crece)
  docs/                arquitectura.md, adr/, patterns/
  CONTEXT.md           glosario
```

Copiamos de Moli el catálogo pnpm con versiones exactas, vite-plus (`vp`: build, lint con oxlint, formato y tests con vitest), `tsgo` con el parche de Effect, las opciones estrictas de `tsconfig`, `@effect/language-service` con los avisos como errores, y las reglas de `oxlint-plugin-moli` y `anti-slop` que no son específicas de Moli. `typecheck` y `lint` deben pasar antes de dar una tarea por terminada.

### ▸ 2. Solid 2 como SPA, sin SSR en la v1

- Se renderiza en el cliente con `@solidjs/vite-plugin` en modo SPA, como `apps/web-solid` de Moli. SolidStart ya no existe: lo sustituye el «start mode» del plugin, que dejamos para cuando haga falta SSR.
- Rutas: el router mínimo de Moli (señal de ubicación y constructores `ruta.*`). `@solidjs/router@2` sigue en `next`.
- Pendiente para más adelante: páginas compartibles por emplazamiento con imagen de vista previa para X. Pueden resolverse con una función en el borde que genere solo las etiquetas meta, sin SSR completo.
- Riesgo asumido: Solid 2 es una RC. Fijamos versiones exactas, actualizamos con commits deliberados y leemos el `CHEATSHEET.md` del paquete en cada subida. Las convenciones de `docs/agents/solid-2-port.md` de Moli se copian tal cual: no desestructurar props, no escribir señales en memos ni en el cuerpo de los componentes, y no crear una lectura y esperarla en el mismo cuerpo.

### ▸ 3. Convex como fuente canónica, con Effect dentro mediante Confect v10

- En Moli, el ADR 0001 descartó Convex porque «Effect no puede entrar en su runtime V8». Confect v10 (`10.0.0-next.24`, Effect 4) permite ahora escribir las funciones de Convex con Effect: esquemas, errores tipados y servicios. **Hay que verificarlo en la exploración técnica 1 antes de aceptar esta decisión.** Si falla, el plan B es el patrón de `contabilidad-alfamolins`: Effect dentro de acciones `"use node"` y funciones de Convex sencillas.
- Convex guarda:
  - los emplazamientos canónicos con sus estaciones, sectores y bandas;
  - las observaciones de cada fuente, con fecha;
  - las correcciones;
  - las ejecuciones de la ingesta;
  - las versiones de las capas publicadas.
- Convex no guarda el mapa base, las capas precalculadas, las agrupaciones de todos los emplazamientos ni las instantáneas en crudo. Eso va a la CDN o a R2, y Convex solo guarda su versión y su URL.
- En el cliente, un `ConvexClient` vive dentro de una `Layer` de Effect. Las lecturas en vivo usan un adaptador `vivo()` de unas 40 líneas que convierte `onUpdate` en un iterable asíncrono y lo pasa a `createMemo`. Cuando Confect v10 sea estable se sustituye por su `reactiveQuery` como `Stream`.
- Las escrituras, que en la v1 serán casi solo de la ingesta y más adelante también de los usuarios, pasan por `action` de Solid. El optimismo se hace con **un solo** mecanismo, el de Solid. Una mutación de Convex solo se resuelve cuando la suscripción ya incluye el cambio, así que `yield mutation(...)` sirve como confirmación.

### ▸ 4. El mapa se lee de capas estáticas versionadas

- Una instantánea de los emplazamientos se convierte en una capa estática y se publica en la CDN con una versión, por ejemplo `sitios@2026-09-24T03:00Z`. Tras la exploración 03 la capa de Barcelona es un fichero JSON por columnas y no PMTiles (ADR 0004).
- Para la **UI que nunca miente**, la capa y la ficha pueden tener versiones distintas. Si el registro en vivo de Convex es más reciente que la capa, la ficha lo dice («actualizado después del mapa») y el marcador no se «corrige» a medias. Es la marca de agua por vista que recomienda Moli.
- El mapa base es OpenFreeMap con el estilo propio del tema. Al principio se usan sus servidores y más adelante se puede alojar en local.

### ▸ 5. Las simulaciones son funciones puras detrás de una interfaz fija

```ts
interface Simulacion<Params, Resultado> {
  id: string; version: string;
  params: Schema.Schema<Params>;          // también es el formato de intercambio
  ejecutar(p: Params, malla: Malla): Resultado;  // pura; salida en arrays tipados
}
```

- Estas son las simulaciones del prototipo, en `packages/sim`:
  - diagrama de sector 3GPP;
  - pérdidas urbanas;
  - celdas de Voronoi y reparto por sectores;
  - SINR sobre una malla hexagonal;
  - estimación de usuarios por estación base.
- En el navegador se ejecutan en un Web Worker, orquestado con Effect.
- La versión en TypeScript es la **referencia**. Cada `version` tiene ficheros de resultados de referencia y cualquier otra implementación debe coincidir con ellos dentro de una tolerancia declarada.
- **Bend queda fuera de la v1.** Su salida a JavaScript usa un solo núcleo y es unas 20 veces más lenta que la nativa, no tiene salida oficial a WASM y solo trabaja con F32. Más adelante tiene dos papeles detrás de la misma interfaz:
  - un laboratorio de leyes con `LAWS.bend`/`PROOF.bend`, como el estudio previo en vivero: cada punto tiene un único servidor, las celdas forman una partición, y el traspaso no oscila;
  - lotes pesados fuera de línea que generan capas precalculadas, de las que Convex solo guarda la URL.

### ▸ 6. La librería de componentes es el único sitio con estilos

- `packages/ui`: componentes al estilo shadcn con `cva`, como en Moli, más los tokens del tema Hexágono en variables CSS OKLCH y el estilo del mapa, también como tokens.
- **Se aplica con lint, no por convención** (en Moli era solo convención). Una regla de oxlint prohíbe `class`/`style` a medida y los colores sueltos fuera de `packages/ui`. Si una pantalla necesita algo nuevo, se añade una variante o un componente.
- Los componentes hexagonales del prototipo (botón, etiqueta de estado, fichas, hoja inferior) pasan a ser componentes. Como el diseño va a cambiar, cambiarán en un solo sitio.
- Los tokens tienen nombres semánticos y un tema oscuro, que la web usa cuando el sistema está en oscuro (#75, `docs/patterns/ui.md`).

### ▸ 7. Aportaciones en el dispositivo con el formato definitivo

- Las medidas, los puntos elegidos y las correcciones propuestas se guardan en IndexedDB mediante un servicio Effect (`AlmacenLocal`). Llevan el mismo esquema versionado que tendrán en Convex: identificador, `createdAt`, versión del esquema y origen.
- Compartirlas más adelante supone añadir `Sincronizacion`, que sube lo local con un `commandId` idempotente como en Moli. El modelo no cambia.

### ▸ 8. Límites de uso desde el primer día

| Qué | Cómo |
|---|---|
| Lectura masiva del mapa | Ficheros estáticos en la CDN, con caché y límites de la CDN. |
| Consultas públicas de Convex (ficha, búsqueda) | `@convex-dev/rate-limiter` por identificador anónimo de sesión, más un límite global por consulta. **Problema a resolver en la exploración técnica 3:** las consultas por WebSocket no exponen la IP. |
| Acciones HTTP (futuras escrituras y exportaciones) | Límite por IP en la acción HTTP, más el límite por sesión. |
| Extractores hacia terceros | Límite propio (por ejemplo, 1 petición por segundo y lotes nocturnos), `User-Agent` identificable, caché con ETag, respeto de `robots.txt` y un interruptor para apagarlos. |

### ▸ 9. Ingesta y procedencia

- Cada fuente tiene su extractor en `packages/ingesta`, un servicio Effect con reintentos y un `Schedule`, que produce **observaciones** con fuente, fecha y URL. La fusión es una función pura del dominio: une las observaciones que están a menos de 60 m y son del mismo operador, calcula la confianza y detecta conflictos. Ya estaba descrita en `celda-ux.html`.
- Las correcciones salen de la comunidad de Celda, aceptadas en la moderación, y la ficha enseña cada una con su procedencia al lado del registro (ADR 0019 y 0020). Esta propuesta extraía otra web de antenas; el ADR 0019 la retiró. Cada extractor queda aislado para poder apagarlo sin tocar nada más.
- Los datos de OpenCelliD tienen licencia CC BY-SA 4.0. Si se redistribuyen en las capas públicas, esas capas heredan la licencia. Queda anotado para el ADR de licencias.

### ▸ 10. Alojamiento en Cloudflare, con plan de contingencia para los bloqueos de LaLiga

- La web (estática) va a Cloudflare Pages y los PMTiles a R2, que no cobra por la salida de datos. El dominio `elies.site` sigue gestionado en Vercel: `celda.elies.site` apunta a Cloudflare con un CNAME. **Hay que verificar** que Pages y R2 funcionan con un subdominio cuya zona no está en Cloudflare. R2 con dominio propio normalmente exige la zona en Cloudflare; la alternativa es servir los PMTiles a través de la propia web de Pages.
- **Bloqueos de LaLiga.** En España, los operadores bloquean rangos de IP de Cloudflare durante los partidos por orden judicial. Para no mentir ni romperse:
  - la web y las capas tienen un **origen de reserva** fuera de Cloudflare (por ejemplo Vercel, donde ya está el dominio), y el cliente lo usa si el principal no responde;
  - si no responde ninguno, la interfaz lo dice claramente, con la causa probable, y no muestra un mapa vacío como si no hubiera antenas;
  - Convex no está detrás de Cloudflare, así que la ficha en vivo sigue funcionando.

## UI que nunca miente, aplicada a Celda

| Riesgo de estado falso | Respuesta |
|---|---|
| Cambiar de emplazamiento y ver la ficha del anterior con el nombre nuevo | `<Loading on={idEmplazamiento}>`: el cambio de identidad es un límite duro. |
| Capa del mapa y ficha con versiones distintas | Marca de agua por vista: se ve la versión de cada una y cuál es más reciente. |
| Simulación presentada como dato | Toda simulación lleva «modelo» y su `version`, y el azimut estimado lleva ±15°. |
| Ubicación desconocida tratada como conocida | Estados explícitos: ninguna, denegada, GPS con precisión, punto elegido. |
| Medida de ejemplo confundida con una propia | Tipo distinto en el dominio, no solo un color. |
| Corrección de la comunidad presentada como dato oficial | Cada dato lleva su fuente, y los conflictos se muestran, no se esconden. |

## Plan por fases

0. **Exploraciones técnicas (desechables, con su veredicto en un issue):**
   1. Confect v10 con Effect 4 dentro de Convex, y el adaptador `vivo()` con Solid 2 rc.9.
   2. PMTiles de unos 2.000 emplazamientos en MapLibre con el tema Hexágono y marcadores de logos.
   3. Límites de uso en consultas anónimas de Convex.
   4. Cloudflare Pages y R2 con el dominio en Vercel, y el origen de reserva ante los bloqueos.
1. **Primer recorrido completo con datos reales:** registro oficial de Barcelona → Convex → PMTiles → mapa con logos y agrupación → ficha en vivo.
2. Correcciones de la comunidad y procedencia en la ficha.
3. `packages/sim`: radiación, degradado del sector y SINR en un Worker.
4. Ubicación y medidas en el dispositivo.
5. Guía de primer uso y ejercicios de clase («modo estudiante»).

## Preguntas

Resueltas el 24/09/2026:
1. **Alojamiento:** Cloudflare, con el dominio en Vercel y un plan contra los bloqueos de LaLiga (decisión 10).
2. **Idioma:** castellano, tanto en la interfaz como en los nombres del dominio en el código. La traducción a otros idiomas (con General Translation) se estudia más adelante, en un issue aparte.
3. **Plan de Convex:** gratuito. La ingesta es incremental (solo escribe lo que cambia) y el mapa se sirve desde la CDN, así que el límite de 1 GB/mes de E/S no se acerca.
4. **Registro oficial:** qué campos publica y cómo se descarga es la primera tarea de la fase 1.
