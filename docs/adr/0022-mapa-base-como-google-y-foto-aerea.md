# Mapa base al estilo de Google Maps, y la foto aérea como función aparte

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 02 y el 03/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign`, que no se fusiona; su veredicto está en `PROTOTIPO.md` (e0b75de) y cada punto de abajo cita el commit que lo probó. Sustituye la paleta de piedra cálida del mapa base, que venía del tema (los `--mapa-*` de `tema.css`). Lo llevan a cabo el #61 (la paleta, los rótulos y los nombres de calle) y el #64 (la foto aérea). Revisada el 05/10/2026 tras un estudio de 1.500 emplazamientos: «Ver el edificio» resalta un solo edificio, el que contiene el emplazamiento (sección «Qué edificio resalta el botón»).

## Contexto

El mapa base es OpenFreeMap con el estilo del tema (ADR 0004): tierra y vías en tonos de piedra cálida, casi sin contraste entre una autopista y una calle, y los rótulos de lugar con poca jerarquía. Quien abre Celda quiere ir a su pueblo o a un edificio, y lo hace acercando el mapa. Con la piedra cálida, a z7 o z9 cuesta encontrar una ciudad o seguir una carretera hasta ella.

El usuario pidió dos cosas: que la foto aérea esté presente y que encontrar un sitio sea tan rápido como en Google Maps. El prototipo probó primero la foto como fondo y después el mapa vectorial con otra paleta.

## Decisión

### Mapa base por defecto: paleta A «Google literal» (2f5bb80)

- **Colores.** Tierra gris claro, vías blancas, autopistas amarillas con borde ámbar y autovías en un amarillo más claro, agua azul y parques verdes. Son los tokens `--mapa-*` del tema con otros valores; `estilo.ts` sigue sin colores propios (`docs/patterns/ui.md`).
- **Rótulos de lugar por importancia y zoom.** Madrid y las capitales de comunidad en negrita desde z4; las capitales de provincia y las ciudades grandes desde z4,5; las demás ciudades desde z7; los pueblos grandes (`town`) desde z8; los pueblos (`village`) desde z10, y las aldeas desde z12. A más importancia, letra más grande y halo más ancho, y la capa más importante se coloca antes, así que una capital gana a un pueblo.
- **Vías por clase**, cada una con su color y su grosor: autopista, autovía, principal, secundaria, calle, camino y tren.
- **Pocos puntos de interés**: transporte, salud y parques, con su color. El mapa no compite con los logos de Celda.
- **La identidad de Celda va en la interfaz**, no en el mapa base: la cabecera, los hexágonos, el panel y los botones conservan el tema de siempre.
- **Los nombres de calle salen también por encima de z17** (1da9d6d). No salían en ninguna variante ni en producción. MapLibre 6 deja de partir las teselas vectoriales en `maxZoom − zoomLevelsToOverscale`; con el máximo de Celda, 18,5, y el valor por defecto, 4, el corte es 14,5. Como no es entero, los rótulos de línea de z15 se estiraban y dejaban de colocarse. El arreglo es una línea en `apps/web/src/mapa/mapaBase.ts`: `zoomLevelsToOverscale: zoomMaximo - Math.ceil(zoomMaximo - 4)`, que con 18,5 da 3,5 y pone el corte en 15. En el Eixample a z18 se pasa de 0 nombres de calle a 7 en el móvil y a 15 en el escritorio.

### «Foto aérea», una función que se enciende (2f5bb80)

- **Un control «Foto aérea»** encima de «Ubicación», apagado al abrir. La persona lo enciende y lo apaga; la web no lo enciende sola al acercar.
- **Encendida, pone la ortofoto PNOA del IGN** en color natural a cualquier zoom, del TMS `tms-pnoa-ma.idee.es`, que sirve Amazon CloudFront. Encima van las vías finas y los rótulos en blanco con halo oscuro: un mapa híbrido. El cambio toca propiedades del estilo, sin `setStyle`, así que las capas de Celda y la ficha abierta no se pierden.
- **Un error de una tesela de foto no da el mapa por perdido** (1da9d6d). Hoy `mapaBase.ts` da el mapa por fallido si llega un error antes de la primera tesela del mapa base.
- **Pista «Ver foto».** Con un emplazamiento seleccionado a z16 o más y la foto apagada, una pista pregunta cuál es el edificio y ofrece encenderla.
- **Botón «Edificio» en el panel del emplazamiento** (1da9d6d, con este nombre en 2f5bb80; hoy «Ver el edificio»). Vuela a z18,5 sobre el emplazamiento, enciende la foto y resalta el edificio que lo contiene con su número de portal. El contorno es el del edificio de OpenStreetMap en las teselas de OpenFreeMap. Hasta el 05/10/2026, si ninguno lo contenía, resaltaba el más cercano a menos de 25 m; ya no (sección siguiente). Si no hay ninguno, lo dice.
- **Crédito:** «PNOA · CC BY 4.0 scne.es», con enlace a `pnoa.ign.es`, a pie de mapa mientras la foto está encendida. Es la fórmula de la etiqueta `AccessConstraints` del servicio (ADR 0021).

### Qué edificio resalta el botón (05/10/2026)

Un estudio del 05/10/2026 midió la función publicada sobre 1.500 emplazamientos al azar, 375 por estrato de habitantes del municipio (menos de 2.000, de 2.000 a 20.000, de 20.000 a 100.000 y más de 100.000), con las cifras de España ponderadas por estrato. Usó las teselas z14 de OpenFreeMap `planet/20260927_080001_pt` y el `elegirEdificio` de entonces, y revisó a ojo sobre el PNOA 40 emplazamientos al azar y 10 urbanos más. Encontró dos fallos, y que el respaldo de 25 m se equivocaba más de lo que acertaba. El usuario aprobó estos cambios el mismo día.

- **Un solo polígono.** OpenFreeMap junta en un `MultiPolygon` todos los edificios de una tesela con los mismos atributos (`render_height`, `render_min_height`, `colour`): en la tesela del centro de Madrid, un rasgo lleva 4.193 polígonos. `queryRenderedFeatures` da el rasgo entero, y la web pintaba todos sus trozos: una mediana de 48, 207, 495 y 676 polígonos por estrato, de 1,0 a 28,1 ha. Solo 11 de 795 resaltados eran un único polígono. Ahora `edificiosDeRasgo` separa los polígonos y `elegirEdificio` se queda con uno, con una mediana de 864 m² (267, 523, 990 y 943 m² por estrato).
- **Solo el que contiene el emplazamiento, de 30 m² o más, sin el respaldo de 25 m.** En la revisión a ojo, cuando un edificio de OpenStreetMap contenía el emplazamiento era la azotea correcta en 12 de 13 casos, y el que fallaba era una caseta de 16 m². Los 8 casos en que solo había uno a menos de 25 m eran torres: 3 veces se resaltaba la caseta del propio emplazamiento y 5 un edificio vecino. De otros 10 así en municipios de más de 20.000 habitantes, 2 parecían la azotea correcta, 3 un edificio junto a un mástil y 5 no se podían decidir. Las casetas de equipos medían de 8 a 21 m² y las azoteas, al menos 50. Con la regla nueva, ninguna de las 25 torres de la revisión recibe un edificio; antes lo recibían 9.
- **Si lo contienen varios polígonos**, como en 59 de los 504 emplazamientos con edificio (partes de un edificio, o edificios dibujados unos sobre otros), gana el más alto y, a igual altura, el más grande. El emplazamiento suele estar en el tejado más alto, y entre polígonos de la misma altura el más grande es el edificio entero.
- **El número de portal sale también de los `MultiPoint`.** OpenFreeMap junta del mismo modo los portales con el mismo número: de los 708.743 portales de las teselas del estudio, 645.840 (el 91 %) llegaban en un `MultiPoint`, y `portalDeRasgo` los descartaba. Ahora vale el portal que cae dentro del polígono elegido, o a menos de 1 m de su contorno (una entrada en la fachada), y de ellos el más cercano al emplazamiento. Si no hay ninguno, va sin número. Ya no se toma el más cercano de fuera, que suele ser el de un vecino.
- **Los números se leen de las teselas y no de lo pintado** (`querySourceFeatures`). MapLibre no pinta el número que queda bajo un marcador, y en Madrid el 34 está a 4 m del emplazamiento. Además, la capa de portales se escondía con `visibility` mientras la cámara volaba (#67), y entonces MapLibre la dejaba fuera de las teselas que parte por encima del zoom 15 y guardaba lo partido: tras «Ver el edificio» no había ningún número ni en el mapa ni para buscar. Ahora se quita con un filtro (`soloConFoto`) y la capa llega siempre.
- **Los trozos de un edificio partido entre teselas no se cosen.** Planetiler corta cada polígono a 4 píxeles del borde de su tesela z14, y MapLibre parte esas teselas en cuatro a z15 con un margen igual: unos 29 m en España. Un edificio que pasa de ese margen llega en un trozo por tesela, cortado en línea recta. Pasa en 22 de los 504 edificios resaltados (4 %), casi todos naves o bloques de más de 2.500 m², con una mediana de unos 11.000 m². Lo resaltado contiene el emplazamiento y casi siempre cubre lo que se ve del edificio a su alrededor: el corte cae a unos 29 m más allá del borde de una tesela. Coserlos pediría una unión de polígonos y saber qué trozos son del mismo edificio, y no hay con qué: el `id` de un rasgo es el de todo su `MultiPolygon` y cambia de una tesela a otra, y MapLibre no dice de qué tesela sale cada rasgo. Cuando el emplazamiento cae en el margen de dos teselas, lo contienen varios trozos y se elige el más grande, que es el edificio entero si cabe en una tesela. En Passeig de Gràcia, 68, cuatro teselas dan cuatro trozos y el de 2.294 m² es el edificio entero.
- **Si no hay edificio, la pista dice «El mapa no tiene ningún edificio dibujado en el emplazamiento.»** durante 4 s. No dice por qué, porque no se sabe. Lo más probable es una torre o un mástil, pero en la revisión 3 de las 15 azoteas no estaban dibujadas en OpenStreetMap.

| Emplazamientos, por habitantes del municipio | < 2.000 | 2.000–20.000 | 20.000–100.000 | > 100.000 | España |
|---|---|---|---|---|---|
| Con edificio resaltado, antes (con el respaldo de 25 m) | 24,3 % | 37,6 % | 65,3 % | 84,8 % | 56,3 % |
| Con edificio resaltado, ahora | 5,6 % | 19,7 % | 43,2 % | 65,9 % | 36,9 % |
| Con número de portal, antes | 2,9 % | 7,5 % | 14,1 % | 20,5 % | 12,2 % |
| Con número de portal, ahora | 1,3 % | 4,0 % | 13,1 % | 39,2 % | 16,8 % |
| Con número, de los que tienen edificio, ahora | 24 % | 20 % | 30 % | 60 % | |

Lo de «ahora» sale de la tesela z14 en que cae cada emplazamiento, con la regla de la web. Las pruebas de `apps/web/src/foto/edificio.test.ts` usan rasgos de esas teselas partidos a z15 como MapLibre (`referencia/`): una manzana de Madrid en un `MultiPolygon` de 1.005 polígonos con el 34 en un `MultiPoint`, Passeig de Gràcia, 68 entre cuatro teselas, la caseta de 16 m² de una torre en Martorell, una torre en el campo junto a un edificio en Ayllón, una azotea en Majadahonda con los portales en la acera y un bloque alto sobre una nave partida en Sabadell.

El paso siguiente es el #71: calcular el contorno al publicar, a partir del Catastro. En la revisión, el Catastro tenía las 5 azoteas que faltaban en OpenStreetMap entre los 39 emplazamientos sin edificio. Da el edificio por parcela, y el contorno iría en la ficha, sin consultar las teselas.

## Números

Del prototipo, en Chromium con un contexto nuevo en cada medida, desde España.

| Medida | Resultado |
|---|---|
| Una tesela de foto PNOA | 11,5 KiB de media |
| Eixample a z18 en el móvil, con la foto | 15 teselas de foto, 266 KB, frente a 1,55 MB de las 4 teselas vectoriales de OpenFreeMap de la misma vista |
| Barcelona a z12 en el móvil, con la foto | 15 teselas de foto, 206 KB |
| Con la foto apagada | 0 teselas de foto |
| Teselas de OpenFreeMap por vista | de 2 a 12, las mismas con cualquier paleta |
| Sesión de móvil de España al tejado de un emplazamiento del Eixample y vuelta, DPR 3, sin foto | 5,2 MB de mapa base (4,4 MB de teselas y 0,75 MB de glifos, sprites y TileJSON) |
| La misma sesión con la foto encendida todo el rato | 7,8 MB, de ellos 2,3 MB de foto en 232 peticiones |
| Mapa quieto 20 s, con la foto apagada, encendida y tras «Edificio» | 0 peticiones, 0 `render` de MapLibre y 0 llamadas a fetch, XHR, `requestAnimationFrame`, `setTimeout`, `setInterval` y `postMessage` |

La sesión sin foto se midió con la paleta de piedra; las teselas son las mismas con la paleta A. Las fuentes de imagen se midieron con 40 teselas al azar de España: el PNOA tarda 148 ms de mediana en frío y 91 ms en caliente.

## Consecuencias

- **El contorno y el número del edificio salen de OpenStreetMap, no del registro oficial, y pueden no coincidir.** En un edificio de esquina, el registro da «PS GRACIA, 68» y el edificio resaltado lleva «Nº 251-259». El botón resalta un edificio; la dirección del emplazamiento sigue siendo la del registro, y la ficha no las mezcla.
- **Una azotea que OpenStreetMap no tiene dibujada se queda sin edificio**, igual que una torre. Antes el respaldo de 25 m resaltaba a veces el edificio de al lado, y en la revisión fallaba más de lo que acertaba. El #71 lo resuelve con el Catastro.
- **La foto sigue con Cloudflare bloqueado**, porque va por CloudFront, pero sin las vías ni los rótulos de OpenFreeMap encima. La reserva del IGN (#60) cubre el callejero.
- **Con la foto encendida una sesión pesa un 50 % más**, unos 2,3 MB. Por eso va apagada al abrir. A pie de calle pesa menos que el callejero: 266 KB frente a 1,55 MB.
- **Sin foto mientras la cámara vuela** (#67, decidido por el usuario el 04/10/2026). Un vuelo de España a la calle pedía la foto de cada zoom del camino, que solo se ve de paso. Ahora, con la foto encendida, el mapa va sin ella mientras la web anima la cámara y la foto de la vista final sale al pararse; los gestos de la persona no la quitan. En la sesión con vuelos de `pnpm run medir`, la foto pasa de 1,42 MB a 0,95 MB y de 111 teselas pedidas en el aire a ninguna, y los vuelos a la ciudad van más fluidos (del Eixample z17, de 40 a 49 fps con la CPU a ×4). Ver [ui.md](../patterns/ui.md#foto-aérea) y [rendimiento.md](../patterns/rendimiento.md#foto-aérea-fuera-de-los-vuelos-67).
- El PNOA no manda `Cache-Control`, solo `ETag` y `Last-Modified`, así que el navegador decide cuánto guardar cada tesela.
- Fuera de España el PNOA pone imagen de baja resolución, que a z14 ya se ve en bloques, y desde z14 en Marruecos o Francia devuelve teselas transparentes. El mar abierto es casi negro, así que el agua del mapa base va encima.
- La reserva del IGN (#60) sigue la paleta A y las reglas de rótulos de este ADR y de los ADR 0024 y 0025.

## Alternativas descartadas

- **La paleta de piedra cálida** que venía del tema. Hace que el mapa se parezca a Celda, pero no deja encontrar rápido una ciudad ni una carretera, que es lo primero que hace quien abre el mapa.
- **Paleta B «Google sobrio»** (2f5bb80): la de A apagada, al estilo Positron. Las autopistas pierden el amarillo, que es lo que más ayuda a orientarse de lejos.
- **Paleta C «Google con piedra»** (2f5bb80): vuelve a la tierra hueso, con las vías apagadas y el agua verdosa, y con ella vuelve el problema de la piedra cálida.
- **La foto como fondo por defecto** (1da9d6d), en todas sus formas: cruda, templada hacia la piedra, bajo un velo, entrando por opacidad de z13 a z15 (G) o más presente desde z11. El velo apaga justo lo que hace falta a pie de calle, y el usuario decidió que el mapa por defecto se parezca a Google y que la foto sea una función aparte.
- **La foto solo dentro de la celda seleccionada** (H, 1da9d6d). Sirve para ver la celda, no para encontrar el edificio antes de seleccionar, y a z18 la celda llena la pantalla.
- **Esri World Imagery.** En Barcelona, Medinaceli e Irun es satélite de invierno de 0,5 m, con sombras de media calle y fachadas inclinadas; el PNOA es ortofoto verdadera de verano de 25 cm en los cascos urbanos. Sus condiciones piden una cuenta de ArcGIS y Esri puede cortar el acceso por `Referer` o por volumen.
- **Sentinel-2 de EOX.** 10 m por píxel: a z15 no se distingue una manzana. Un solo servidor, sin CDN.
- **Google Map Tiles.** Pide una clave con facturación activa y un token de sesión, y Celda tiene que costar 0 € (ADR 0018).
- **El edificio más cercano a menos de 25 m cuando ninguno contiene el emplazamiento** (05/10/2026). En la revisión a ojo resaltaba la caseta de la torre o un edificio vecino más a menudo que la azotea correcta.
- **El portal más cercano a menos de 30 m cuando el edificio no tiene ninguno** (05/10/2026). Suele ser el de un vecino o el de la acera de enfrente.
- **Coser los trozos de un edificio partido entre teselas** (05/10/2026). Ver «Qué edificio resalta el botón»: pasa en un 4 % de los edificios resaltados, casi todos grandes, y no hay con qué saber qué trozos son del mismo edificio.
- **El mapa base vectorial del IGN como principal** (1da9d6d). Fuera de España, desde z13, la tierra se pinta como mar; las calles salen en castellano y sin tildes («Calle Arago»); no hay calles urbanas por debajo de z13, y las teselas pesan un 33 % más y tardan el doble. Se queda como reserva (#60).
