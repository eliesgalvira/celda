/** El valor por defecto de `zoomLevelsToOverscale` en MapLibre 6. */
export const ZOOMS_SIN_PARTIR_DE_MAPLIBRE = 4;

/**
 * Los zooms más altos en que MapLibre estira las teselas vectoriales en lugar de partirlas, la
 * opción `zoomLevelsToOverscale` del mapa.
 *
 * MapLibre 6 parte las teselas de un nivel en las del siguiente hasta `maxZoom −
 * zoomLevelsToOverscale`, y por encima las estira. Con el valor por defecto, 4, y el zoom máximo
 * de Celda, 18,5, el corte cae en 14,5. Un corte que no es entero deja de partir las teselas del 15
 * sin volver a maquetar sus rótulos, y los que van a lo largo de una calle, estirados, dejan de
 * caber: por encima del zoom 17 no salía ningún nombre de calle. Con el corte en el entero de
 * encima del de por defecto, cada zoom maqueta los suyos: con 18,5 da 3,5 y el corte, en el 15.
 * En el Eixample a zoom 18 se pasa de 0 nombres de calle a 7 en el móvil (prototipo del 02/10/2026).
 *
 * Las teselas que se piden son las mismas: OpenFreeMap no tiene más allá del zoom 14, y las del 15
 * salen de partir las del 14 que ya han llegado.
 */
export const zoomsSinPartir = (zoomMaximo: number): number =>
  zoomMaximo - Math.ceil(zoomMaximo - ZOOMS_SIN_PARTIR_DE_MAPLIBRE);
