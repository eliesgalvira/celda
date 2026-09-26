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

## Marcadores y logos

- `marcadores/LogoCompanias.tsx` dibuja el logo de un emplazamiento: el de su compañía o, si es compartido, un círculo en porciones con el de cada una, como la función `logo()` de los prototipos. Los colores son tokens `--compania-*`.
- Los logos son aproximaciones dibujadas a mano, no los oficiales. Falta revisar qué permite cada marca (Movistar, Vodafone, Orange, Digi, Yoigo) y cambiarlos por los oficiales donde se pueda.
- `MarcadorEmplazamiento` es un botón de 44 px con el logo a 34 px. No lleva el dibujo dentro: usa con `<use>` un símbolo que `CapaDeMarcadores` dibuja una vez por combinación de compañías. Con 700 marcadores a la vista son unos 3.000 nodos en lugar de unos 15.000.
- `CapaDeMarcadores` monta la lámina dentro del contenedor del mapa con un `Portal`. Fuera de él, la rueda y los arrastres que empiezan sobre un marcador no llegan al mapa.
- Una clase de posición que choca con la diana (`absolute` frente a `relative`) se une con `cn`, no con el `class` de `cva`: sin `tailwind-merge` gana la que llegue antes en el CSS, y los marcadores quedaban en fila.
- Por debajo de `ZOOM_LOGOS` (14, en `mapa/estilo.ts`) no hay marcadores DOM: el estilo del mapa pinta cada emplazamiento como un punto (`--mapa-emplazamiento`) y una `Pista` pide acercarse. Con los 1318 emplazamientos como botones, el zoom iba a 17 fps con la CPU a ×4. Cuando llegue la agrupación en hexágonos (ticket 13) los puntos se sustituyen por ella.
- `DatosDelMapa` es la marca de agua del mapa: la fecha de la capa, o que se está cargando. Tiene ancho fijo en `rem`; con `ch` Chromium medía otra fuente y cortaba la fecha.

## Panel del emplazamiento

- `panel/PanelEmplazamiento.tsx` es el contenedor. En escritorio ocupa una columna de 27rem a la izquierda. En el móvil es una hoja inferior con tres alturas (resumen, media y completa) y el padre controla cuál toca con `altura` y `alCambiarAltura`.
- Qué altura sale de un toque, un arrastre o una tecla lo deciden funciones puras en `panel/hoja.ts`, con sus pruebas. El componente solo mide el dedo y llama a esas funciones.
- El tirador es un `<button>` con la etiqueta visible «Ver más» o «Ver menos». Recibe él mismo los eventos de puntero, con `setPointerCapture` y `touch-none`, y el botón de cerrar va debajo de él y no encima. En el prototipo v6 el arrastre no funcionaba porque otra pieza tapaba el tirador. Si lo mueves, comprueba el arrastre en Chromium con eventos táctiles de verdad.
- Un toque sube una altura y desde la completa vuelve al resumen. Las flechas suben y bajan, e Inicio y Fin van a los extremos. Escape cierra el panel. Al abrirse se lleva el foco y al cerrarse lo devuelve al marcador.
- `panel/Ficha.tsx` tiene las piezas de dentro. `CabeceraFicha` y `EsqueletoFicha` comparten contenedor y alto de línea, así que al llegar la ficha no se mueve nada. El esqueleto dice «Cargando la ficha…» a los 0,5 s y, a los 8 s, que tarda más de lo normal (`animate-aparecer-tarde`).
- `MarcaDeAguaFicha` tiene dos tonos. `al-dia` enseña la fecha de la ficha y `posterior` avisa de que la ficha ha cambiado después del mapa.
- Con un panel abierto, `DisposicionMapa` (`panelAbierto`) sube en el móvil los controles y los créditos por encima del resumen, y en escritorio aparta los créditos a la derecha de la columna.
- `MarcadorEmplazamiento` con `seleccionado` lleva un anillo del color primario y `aria-current`.

## Qué rechaza la regla fuera de `packages/ui`

Atributos `style`; `class`, `className` o `classList` que no salgan de `@celda/ui`; importar hojas de estilo; y colores sueltos en cualquier cadena: hexadecimales, `rgb()`, `hsl()`, `oklch()` y similares, y clases de la paleta de Tailwind (`text-sky-600`, `bg-white`). Las pruebas de la regla están en `tools/oxlint-plugin-celda/reglas/sin-estilos-a-medida.test.ts`.
