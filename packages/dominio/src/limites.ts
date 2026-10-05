import * as Schema from "effect/Schema";

import { FuenteDeMunicipios } from "./municipio.ts";

/**
 * Los límites de comunidades autónomas y provincias que pinta el mapa (ADR 0023). Salen de los
 * límites de municipios del IGN del repositorio (ADR 0017) con la orden `limites` de
 * `tools/capas`, en dos ficheros: el general, a 1 km, que la web descarga al arrancar, y el de
 * detalle, a 150 m, que descarga la primera vez que el mapa se acerca.
 *
 * Cada línea es una cadena de arcos del IGN, como `[x0, y0, dx1, dy1, …]`: el primer vértice y la
 * diferencia de cada uno con el anterior, en enteros de `1 / unidadesPorGrado` grados, longitud
 * antes que latitud. Una línea va en `pais` si separa España de otro país por tierra, en
 * `comunidades` si separa dos comunidades autónomas y, si solo separa dos provincias de la misma,
 * en `provincias`. Ninguna va en dos. La costa no va en ninguna.
 */
export const LimitesDeComunidadesYProvincias = Schema.Struct({
  fuente: FuenteDeMunicipios,
  /** Tolerancia de la simplificación, en metros. */
  toleranciaMetros: Schema.Finite,
  /** Cuántas unidades de las líneas hay en un grado. */
  unidadesPorGrado: Schema.Int,
  pais: Schema.Array(Schema.Array(Schema.Int)),
  comunidades: Schema.Array(Schema.Array(Schema.Int)),
  provincias: Schema.Array(Schema.Array(Schema.Int)),
});
export type LimitesDeComunidadesYProvincias = typeof LimitesDeComunidadesYProvincias.Type;
