import type { AllPaintProperties } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

type Propiedad = keyof AllPaintProperties;
type Valor = AllPaintProperties[Propiedad];

/** Lo que hace falta del mapa de MapLibre para cambiarle los colores. */
export interface MapaConTema {
  getLayer(capa: string): object | undefined;
  setPaintProperty<P extends Propiedad>(
    capa: string,
    propiedad: P,
    valor: AllPaintProperties[P],
  ): void;
}

/** Las propiedades de pintura de una capa con su valor. */
const pinturaDe = (capa: LayerSpecification): ReadonlyMap<Propiedad, Valor> =>
  // SAFETY: la pintura de una capa del estilo solo lleva propiedades de pintura de MapLibre.
  new Map(Object.entries(capa.paint ?? {}) as Array<[Propiedad, Valor]>);

/**
 * Pasa el mapa de los colores de un tema a los de otro sin `setStyle`. `anterior` y `siguiente`
 * son el mismo estilo hecho con los colores de cada tema, así que solo difieren en las
 * propiedades de pintura que salen de un token, y solo esas se cambian. Lo demás se queda como
 * está: las fuentes con lo que la web les ha puesto, el estado (la foto aérea, los municipios que
 * * son zona), los filtros, la visibilidad y las opacidades que la web cambia mientras se usa (la
 * silueta fundida). Una capa que el mapa no tiene se salta.
 */
export const pasarDeTema = (
  mapa: MapaConTema,
  anterior: StyleSpecification,
  siguiente: StyleSpecification,
): void => {
  const antes = new Map(anterior.layers.map((capa) => [capa.id, pinturaDe(capa)]));
  for (const capa of siguiente.layers) {
    const pinturaAnterior = antes.get(capa.id);
    if (pinturaAnterior === undefined || mapa.getLayer(capa.id) === undefined) continue;
    for (const [propiedad, valor] of pinturaDe(capa)) {
      if (JSON.stringify(valor) === JSON.stringify(pinturaAnterior.get(propiedad))) continue;
      mapa.setPaintProperty(capa.id, propiedad, valor);
    }
  }
};
