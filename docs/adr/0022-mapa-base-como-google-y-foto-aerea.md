# Mapa base al estilo de Google Maps, y la foto aérea como función aparte

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 02 y el 03/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign`, que no se fusiona; su veredicto está en `PROTOTIPO.md` (e0b75de) y cada punto de abajo cita el commit que lo probó. Sustituye la paleta de piedra cálida del mapa base, que venía del tema (los `--mapa-*` de `tema.css`). Lo llevan a cabo el #61 (la paleta, los rótulos y los nombres de calle) y el #64 (la foto aérea).

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
- **Botón «Edificio» en el panel del emplazamiento** (1da9d6d, con este nombre en 2f5bb80). Vuela a z18,5 sobre el emplazamiento, enciende la foto y resalta el edificio que lo contiene con su número de portal. El contorno es el del edificio de OpenStreetMap en las teselas de OpenFreeMap: el que contiene el emplazamiento o, si no hay, el más cercano a menos de 25 m. Si no hay ninguno, lo dice.
- **Crédito:** «PNOA · CC BY 4.0 scne.es», con enlace a `pnoa.ign.es`, a pie de mapa mientras la foto está encendida. Es la fórmula de la etiqueta `AccessConstraints` del servicio (ADR 0021).

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
- **La foto sigue con Cloudflare bloqueado**, porque va por CloudFront, pero sin las vías ni los rótulos de OpenFreeMap encima. La reserva del IGN (#60) cubre el callejero.
- **Con la foto encendida una sesión pesa un 50 % más**, unos 2,3 MB. Por eso va apagada al abrir. A pie de calle pesa menos que el callejero: 266 KB frente a 1,55 MB.
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
- **El mapa base vectorial del IGN como principal** (1da9d6d). Fuera de España, desde z13, la tierra se pinta como mar; las calles salen en castellano y sin tildes («Calle Arago»); no hay calles urbanas por debajo de z13, y las teselas pesan un 33 % más y tardan el doble. Se queda como reserva (#60).
