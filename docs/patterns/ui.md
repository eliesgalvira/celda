# Estilos y librería de componentes

Léelo antes de tocar cualquier cosa que se vea. La decisión de fondo está en la [ADR 0006](../adr/0006-libreria-de-componentes-unico-sitio-con-estilos.md): `packages/ui` es el único sitio con estilos, y la regla de lint `celda/sin-estilos-a-medida` lo comprueba.

## Decisión: Tailwind 4 con `cva`, tokens en variables CSS

Elegimos Tailwind 4 y `class-variance-authority` en lugar de CSS a mano con variables. Motivos:

- Cada variante es una línea de clases que salen de tokens. Añadir una variante es copiar una línea, y un agente lo hace bien a la primera.
- La regla de lint puede distinguir con poco código lo que viene de la librería (una llamada o un componente importado de `@celda/ui`) de lo que no (una cadena escrita en la pantalla).
- `tema.css` quita la paleta de Tailwind (`--color-*: initial`), así que `bg-red-500` ni siquiera genera CSS. Solo existen los colores del tema.

Con CSS y variables haría falta una convención de nombres de clase y una regla más difícil de escribir para saber qué clase es de quién.

## Dónde está cada cosa

- `packages/ui/src/tema.css`: los tokens OKLCH con nombres semánticos (`--superficie`, `--tinta`, `--primario`, `--corregido`, `--mapa-agua`...), el puente `@theme inline` hacia las utilidades de Tailwind y las formas del tema (`hexagono`, `cinta`, `chaflan`).
- `:root` es el tema claro. `[data-tema="oscuro"]` tiene los mismos nombres con otros valores; la v1 no lo activa.
- `packages/ui/src/*.tsx`: los componentes. Cada uno lleva sus variantes con `cva` y refleja la variante en un `data-*`.
- `packages/ui/src/mapa/estilo.ts`: el estilo de MapLibre. No lleva ningún color; `coloresDelTema` lee los `--mapa-*` del documento y los pasa a `rgb()`, porque MapLibre no entiende `oklch()`.

## Añadir algo que se ve

1. Busca el componente en `packages/ui/src`. Si existe y le falta un aspecto, añade una variante.
2. Si hace falta un color que no existe, añade el token en los dos temas de `tema.css`, expónlo en `@theme inline` y úsalo como utilidad (`bg-nombre`).
3. Si el texto va sobre un fondo nuevo, añade el par a `PARES` en `mapa/color.test.ts`: la prueba exige contraste AA en los dos temas.
4. Desde `apps/web`, usa el componente. El único `class` permitido allí es una llamada a algo importado de `@celda/ui`, como `variantesBoton({ variante: "secundario" })`.

## Reglas de la librería

- Objetivos de 44 px como mínimo: la diana (`variantesDiana`) es rectangular y lleva el foco; la forma recortada va dentro. Un `clip-path` en el propio botón se comería el anillo de foco.
- Todo control tiene etiqueta visible. `BotonHexagonal` escribe su `etiqueta` bajo el hexágono y esa etiqueta es su nombre accesible.
- Estados completos: normal, `hover`, `focus-visible` (regla global en `tema.css`), `active`, `disabled` y, en `Boton`, `cargando`, que pone un hexágono sobre la etiqueta invisible para que el ancho no cambie.
- Nada salta al cargar: `DisposicionMapa` reserva desde el principio el sitio de cada pieza, el fondo ya tiene el color del mapa y los avisos se superponen. Cada aviso nuevo se monta con clave, de modo que el navegador lo cuenta como elemento nuevo y no como uno que se mueve.
- Lo que dura poco no se ve: el aviso de espera aparece tras medio segundo (`animate-aparecer`).
- Un fallo se dice con `Aviso tono="fallo"`: qué ha pasado, por qué si se sabe y qué hacer.

## Qué rechaza la regla fuera de `packages/ui`

Atributos `style`; `class`, `className` o `classList` que no salgan de `@celda/ui`; importar hojas de estilo; y colores sueltos en cualquier cadena: hexadecimales, `rgb()`, `hsl()`, `oklch()` y similares, y clases de la paleta de Tailwind (`text-sky-600`, `bg-white`). Las pruebas de la regla están en `tools/oxlint-plugin-celda/reglas/sin-estilos-a-medida.test.ts`.
