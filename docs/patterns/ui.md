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
- `CapaDeMarcadores` lleva `isolate`: el `z-index` de los marcadores no compite con la cabecera ni con los controles.

## Agrupación en hexágonos

- `MarcadorAgrupacion` es el hexágono oscuro con borde primario y el número de emplazamientos que recoge, como en el prototipo v8. Es un botón de 50 × 56 px. Su nombre accesible empieza por el número que se ve («12 emplazamientos, acercar») y al pulsarlo el mapa se acerca a su zona. Va por encima de los logos (`z-10`) y el emplazamiento seleccionado, por encima de todo (`z-20`).
- Los dos marcadores aceptan `movimiento` (`marcadores/Deslizable.tsx`). Con `entra`, el marcador sale de su agrupación anterior o crece en su sitio. Con `sale`, se desliza hacia la agrupación que lo recoge o se apaga en su sitio, y queda `inert` hasta que la pantalla lo quita. El logo usa la utilidad `deslizar` y el hexágono `brotar`, las dos en `tema.css`, con la curva del prototipo.
- El punto de partida de la entrada va en `@starting-style` (la variante `starting:` de Tailwind) con variables CSS por marcador. El navegador lo aplica al insertar el nodo, así que no hace falta esperar un fotograma para lanzar la transición.
- Con la preferencia de reducir movimiento, `motion-reduce:transition-none` quita las transiciones y la web no deja nada saliendo: el cambio es directo.
- Qué se agrupa y hacia dónde va cada marcador lo decide la web (`apps/web/src/capa/agrupacion.ts` y `pintados.ts`), con pruebas de funciones puras. La librería solo dibuja el `movimiento` que recibe.
- Rendimiento medido en Chromium con GPU (Vulkan) y la CPU a ×4, con los 1318 emplazamientos: 55 fps al cruzar un nivel cada medio segundo y 59 con la rueda en una ventana de 390 px; 34 a 40 fps en una de 1400 px. Lo caro es el estilo de los nodos que aparecen al cambiar de nivel, no el JavaScript. Por eso solo se anima lo que se ve y el radio de agrupación es de 60 px: con 48 había un tercio más de nodos y el móvil bajaba a 51 fps.
- `DatosDelMapa` es la marca de agua del mapa: la fecha de la capa, o que se está cargando. Tiene ancho fijo en `rem`; con `ch` Chromium medía otra fuente y cortaba la fecha.

## Barrios y ausencias

- En el nivel 13 (zoom de 13 a 14) los emplazamientos de Barcelona se recogen por barrio (`NIVEL_DE_BARRIOS` en `agrupacion.ts`). Más lejos no caben las 73 etiquetas y las agrupaciones del nivel 12 ya son más grandes que un barrio; más cerca, las del 14 son más pequeñas. Así cada paso al alejar recoge lo del anterior. Los emplazamientos de fuera del municipio siguen en hexágonos.
- Al entrar o salir de ese nivel no hay jerarquía de supercluster: cada elemento va al que se queda con la mayoría de sus emplazamientos. Un barrio sin emplazamientos aparece y se apaga en su sitio.
- `marcadores/MarcadorBarrio.tsx` tiene dos formas. La completa es la del prototipo v8: el nombre en mayúsculas espaciadas con un halo del color del mapa (utilidad `halo`), «N emplazamientos» y la cinta de ausencias. La compacta es un hexágono claro con el número y, si falta alguna compañía, la marca de ausencia. `formasDeBarrios` (`apps/web/src/capa/etiquetas.ts`) las reparte al pararse el mapa: de más a menos emplazamientos, completa si no pisa otra y compacta si no. Nunca esconde un barrio, porque parecería que no tiene emplazamientos. Con los datos de Barcelona, a zoom 13 se pisan algunas compactas en el Eixample; desde 13,5, casi ninguna.
- `medidaDeBarrio` estima lo que ocupa cada forma a partir de las clases del componente. Si cambias el tamaño de letra o el ancho (`w-38`), cambia también la estimación.
- `marcadores/Ausencias.tsx` es la cinta «sin» con el logo de cada compañía ausente. El logo va entero, del mismo dibujo que en los marcadores, y la × va en un círculo oscuro en su esquina inferior derecha, fuera del círculo del logo. En el diseño se descartaron los logos tachados y los translúcidos. Para el lector de pantalla, la cinta dice «sin Vodafone ni Digi» en texto oculto y los logos van con `aria-hidden`.
- Las agrupaciones en hexágono no marcan ausencias; solo los barrios.
- El mapa base no rotula barrios por debajo del zoom 14 (`estilo.ts`): se pisaban con las etiquetas de Celda.
- El crédito de los límites de barrio va con los del mapa base. En el móvil los créditos ocupan dos líneas, así que los controles están a `bottom-[4.5rem]`.

## Panel del emplazamiento

- `panel/PanelEmplazamiento.tsx` es el contenedor. En escritorio ocupa una columna de 27rem a la izquierda. En el móvil es una hoja inferior con tres alturas (resumen, media y completa) y el padre controla cuál toca con `altura` y `alCambiarAltura`.
- Qué altura sale de un toque, un arrastre o una tecla lo deciden funciones puras en `panel/hoja.ts`, con sus pruebas. El componente solo mide el dedo y llama a esas funciones.
- El tirador es un `<button>` con la etiqueta visible «Ver más» o «Ver menos». Recibe él mismo los eventos de puntero, con `setPointerCapture` y `touch-none`, y el botón de cerrar va debajo de él y no encima. En el prototipo v6 el arrastre no funcionaba porque otra pieza tapaba el tirador. Si lo mueves, comprueba el arrastre en Chromium con eventos táctiles de verdad.
- Un toque sube una altura y desde la completa vuelve al resumen. Las flechas suben y bajan, e Inicio y Fin van a los extremos. Escape cierra el panel. Al abrirse se lleva el foco y al cerrarse lo devuelve al marcador.
- `panel/Ficha.tsx` tiene las piezas de dentro. `CabeceraFicha` y `EsqueletoFicha` comparten contenedor y alto de línea, así que al llegar la ficha no se mueve nada. El esqueleto dice «Cargando la ficha…» a los 0,5 s y, a los 8 s, que tarda más de lo normal (`animate-aparecer-tarde`).
- `MarcaDeAguaFicha` tiene dos tonos. `al-dia` enseña la fecha de la ficha y `posterior` avisa de que la ficha ha cambiado después del mapa.
- Con un panel abierto, `DisposicionMapa` (`panelAbierto`) sube en el móvil los controles y los créditos por encima del resumen, y en escritorio aparta los créditos a la derecha de la columna.
- `MarcadorEmplazamiento` con `seleccionado` lleva un anillo del color primario y `aria-current`. Si al alejar el seleccionado queda dentro de una agrupación, se sigue viendo suelto y la agrupación lo sigue contando.

## Resumen, eje de frecuencias y datos técnicos

- Bajo la cabecera, `ResumenFicha` enseña la frase en lenguaje llano. La escribe `fraseDeResumen` (`apps/web/src/ficha/resumen.ts`), una función pura con pruebas. El registro oficial no publica la tecnología, así que la frase la deduce de la banda y dice «probablemente». Si de alguna compañía faltan las bandas, habla de «las bandas que se conocen» y no afirma lo que falta. La tabla de deducción está en `packages/dominio/src/tecnologia.ts` y sus fuentes, en `docs/investigacion/tecnologia-por-banda.md`.
- `panel/EjeFrecuencias.tsx` es una tabla de verdad: una fila por compañía (`th scope="row"`), una columna por banda y un hexágono relleno (`variantesCasilla`) donde emite, con «Sí» o «No» para lectores de pantalla. Una compañía sin bandas conocidas lleva una nota en lugar de casillas. La barra de abajo va de `--eje-lejos` al primario, con «Llega más lejos» y «Más velocidad» escritos. Las flechas salen de `content` en CSS porque la regla de accesibilidad solo busca texto a dos niveles de profundidad dentro de una celda.
- `Desplegable` es un `<button>` con `aria-expanded` y `aria-controls`. Empieza cerrado salvo con `abierto`, y la variante `recuadro` lo enmarca para usarlo dentro de un diálogo. El contenido está en el DOM con `hidden`, así que las consultas por rol de las pruebas no lo ven hasta abrirlo, pero `getByText` sí.
- `panel/DatosTecnicos.tsx` va dentro del desplegable: por estación base, sus expedientes con el tramo exacto, la banda y la tecnología probable, y la clave de cada observación con su fecha. Termina con una nota que dice qué no publica ninguna fuente.

## Diálogos y el paso de medir

- `Dialogo` es el diálogo modal: un `<dialog>` abierto con `showModal()`, a todo el ancho desde abajo en el móvil y centrado en escritorio (34 rem). Al abrirse lleva el foco al título, el tabulador da la vuelta dentro, Escape, el botón «Cerrar» y un clic en el velo piden cerrarlo, y al cerrarse devuelve el foco a lo que lo abrió. El padre lo monta y lo desmonta; `alCerrar` solo lo pide. Si cambia el título es otra vista: vuelve arriba y el foco pasa al título nuevo.
- `Eleccion.tsx` tiene `Segmentado`, unos botones de radio de verdad con aspecto de botones pegados, y `Selector`, un `<select>` nativo. Los dos llevan la etiqueta visible encima.
- `medir/Medir.tsx` tiene las piezas del paso de medir: `CodigoDelModo` (ocupa lo mismo con código o sin él, así que elegir la marca no mueve nada), `Pasos` y `Paso`, `Puntos`, `Opcion`, `Nota` y `MedidaMostrada`, que enseña una medida con cada valor explicado.
- `medir/CodigoQr.tsx` dibuja el código QR en el navegador con `uqr`, sin pedir nada a ningún servidor. Cada fila es un solo trazo SVG. Usa `--qr-tinta` sobre `--qr-fondo`, que no cambian en el tema oscuro porque las cámaras leen mejor oscuro sobre claro. La figura se nombra por su pie visible.
- La medida de ejemplo tiene su propio color, `--ejemplo`, que no usa ningún dato: `Etiqueta tono="ejemplo"` y el marco de `MedidaMostrada tipo="ejemplo"`. En el dominio es además otro tipo (`MedidaDeEjemplo`), así que no se distingue solo por el color.
- `Etiqueta tono="pronto"` marca algo que se enseña pero aún no funciona, como subir una captura. Va siempre con una frase que dice por qué.
- Qué se enseña en cada dispositivo lo deciden funciones puras de `apps/web/src/medir`: `detectarDispositivo` e `instruccionesPara`, con sus pruebas. Los códigos y sus fuentes están en `packages/dominio/src/modoInformacion.ts` y en [docs/investigacion/modo-de-informacion.md](../investigacion/modo-de-informacion.md).

## Diagrama de radiación

- `panel/DiagramaRadiacion.tsx` es el diagrama polar del prototipo v6: el borde es 0 dB, el centro la atenuación máxima (30 dB), anillos a 0, −10 y −20 dB, marcas cada 30° y N, E, S, O. Siempre lleva `Etiqueta tono="modelo"` con el `id` y la `version` de la simulación, una leyenda por sector y las notas que dicen de dónde salen la forma y la orientación.
- Es un `<svg role="img">` con `<title>` y `<desc>`: quien no lo ve oye qué sectores hay, hacia dónde y que es un modelo. La leyenda de debajo repite los rumbos en texto.
- El marco y los lóbulos van por separado. `DiagramaRadiacion` dibuja los ejes y recibe como hijos `LobulosSector` o, mientras el Worker calcula, `CalculandoDiagrama`, que no ocupa nada y avisa a los 0,5 s. Así el sitio del diagrama está reservado desde el principio.
- `LobulosSector` pinta con trazo discontinuo una orientación supuesta y con trazo continuo una estimada, y con margen dibuja dos radios a ±15° de cada eje. `destacado` rellena un sector con el primario, para el sector que da servicio (ticket 23).
- Los dB de los anillos se escriben en `rumboLibre`, el centro del hueco más ancho entre sectores, para que no pisen el rumbo de ninguno. Los textos llevan un halo del color del panel.
- En el mapa no se dibujan lóbulos: se solapaban entre emplazamientos. El diagrama vive en el panel.

## Punto de referencia

Las piezas están en `ubicacion/`. Cómo encajan con el estado de la ubicación está en [ubicacion.md](ubicacion.md).

- `MarcadorReferencia.tsx`: `UbicacionGps` es un SVG con el hexágono «TÚ» y el círculo de precisión, con el radio en píxeles que calcula la web. `PuntoElegido` es un botón de 44 px con el hexágono naranja (`--referencia`) y la cinta «PUNTO». Con `arrastrable` se arrastra con el ratón (captura el puntero y para el `mousedown` para que el mapa no se mueva a la vez); con el dedo no hace nada y el gesto mueve el mapa. Las flechas lo mueven 10 px, 50 con Mayúsculas. `CapaDeReferencia` lo monta dentro del mapa, como `CapaDeMarcadores`. `PinCentral` es el pin fijo del móvil: su punta está en el centro del mapa.
- `MenuUbicacion.tsx`: el botón hexagonal con la mirilla y su menú, un `fieldset` con `OpcionUbicacion`. Cada opción lleva la etiqueta como nombre accesible y su explicación en `aria-describedby`; una desactivada sigue a la vista con el motivo. Escape o un clic fuera lo cierran.
- El paso previo es un `Dialogo` con dos piezas de `PasoPrevio.tsx`: `ListaPasoPrevio` y `AccionesPasoPrevio`, la fila de botones del final.
- `EleccionDePunto.tsx`: en escritorio, una barra bajo la cabecera; en el móvil, una hoja abajo con «Cancelar» y «Usar este punto». `BuscadorDeDirecciones` es un `<search>` con un formulario: busca al enviar, enseña el estado bajo el campo y cita el servicio.
- `Referencia.tsx`: el bloque de la ficha. `SinReferencia`, `EsperandoReferencia` y `ConReferencia` van dentro de `SeccionReferencia`, que reserva 7,5rem de alto.
- `DisposicionMapa` recibe `ubicacion` (bajo la fecha de los datos), `eligiendo`, `pinCentral` y `dialogo`. Con `eligiendo`, en el móvil se aparta la hoja de la ficha y los controles, y los créditos quedan por encima de la hoja de elegir. En escritorio el cursor del mapa es una cruz. Las reglas del móvil que suben piezas por encima del resumen usan `data-hoja` (panel abierto y no eligiendo); las de escritorio, `data-panel`.
- `Boton` tiene la variante `ancho="completo"` para el botón principal de una fila, como «Usar este punto».

## Términos subrayados

- Las explicaciones salen de un solo sitio, `packages/dominio/src/glosario.ts` (`GLOSARIO`): por término, su nombre, de una a tres frases llanas, el término técnico y los relacionados. Siguen al `CONTEXT.md`, que manda, pero están escritas para quien no sabe nada de redes. `glosario.test.ts` comprueba la longitud y que los relacionados existan.
- Los textos con términos son `TextoMarcado`, una lista de trozos, y se escriben con la plantilla `marcado` y `termino`: ``marcado`Por sus ${termino("banda", "bandas")}, da 5G.` ``. `textoPlano` los devuelve como texto, para nombres accesibles y pruebas.
- Se subraya la primera aparición de cada término en cada bloque (la cabecera, la frase, la marca de agua, cada sección, el punto de referencia, los datos técnicos), no todas. `TextoConTerminos` lo hace dentro de un texto; para varios textos del mismo bloque, como las observaciones de «De dónde salen los datos», se pasan todos por un mismo `bloque()`.
- `termino/Termino.tsx` es un `<button>` en línea con subrayado de puntos del color primario, que crece 4 px por fuera con `::after` para el dedo (no más, o taparía el término de la línea de al lado). Lleva `pointer-events-auto`, porque la marca de agua del mapa está en una pieza que deja pasar los gestos.
- La explicación es un `<dialog open>` no modal, montado con `Portal` en `<body>` para que el panel no la recorte. Si el término está en un diálogo modal, se monta en ese diálogo: fuera de él todo queda inerte. Lleva el foco a su título. La cierran Escape (escuchado en captura, para que no cierre también el panel), «Cerrar», tocar fuera y Tab al salir por un extremo, y el foco vuelve al término salvo al tocar fuera. Los relacionados se abren en la misma caja.
- Dónde se coloca lo decide `colocarExplicacion` (`termino/posicion.ts`), con pruebas: debajo del término si cabe, encima si no, y si no cabe en ninguno, en el lado con más sitio y con desplazamiento por dentro, sin taparlo. En escritorio mide 22rem y en el móvil todo el ancho menos 8 px por lado. Se recoloca al desplazar y al cambiar el tamaño.
- En pruebas de la web, `textoEntero` (`apps/web/src/lib/pruebas.ts`) busca un texto aunque un término lo parta en varios nodos. La explicación está fuera del contenedor de `render`: se busca con `screen`.

## Qué rechaza la regla fuera de `packages/ui`

Atributos `style`; `class`, `className` o `classList` que no salgan de `@celda/ui`; importar hojas de estilo; y colores sueltos en cualquier cadena: hexadecimales, `rgb()`, `hsl()`, `oklch()` y similares, y clases de la paleta de Tailwind (`text-sky-600`, `bg-white`). Las pruebas de la regla están en `tools/oxlint-plugin-celda/reglas/sin-estilos-a-medida.test.ts`.
