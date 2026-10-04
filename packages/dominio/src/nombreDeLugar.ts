import * as Schema from "effect/Schema";

import datos from "../datos/nombres-de-lugar.json" with { type: "json" };
import { FuenteDeMunicipios } from "./municipio.ts";

/**
 * El nombre de lugar (ADR 0025): el oficial del IGN y del INE, en una sola forma. Si el oficial es
 * bilingüe («Alacant/Alicante», «Donostia/San Sebastián»), se escribe la forma local en la
 * Comunitat Valenciana (Alacant, València, Elx) y la castellana en el resto de España (San
 * Sebastián, Pamplona, Álava). Los oficiales de una sola forma (Girona, Bizkaia, A Coruña) y los
 * que llevan guion (Vitoria-Gasteiz, Estella-Lizarra) no cambian.
 *
 * Solo cambia lo que se ve: los datos guardan el código INE y el oficial con barra. «En la
 * Comunitat Valenciana» se decide de dos maneras que dan lo mismo:
 *
 * - los nombres de Celda (provincias, municipios y zonas), por el código INE, con la tabla que
 *   escribe `pnpm run nombres` en `tools/capas` (`nombreDeLugarDeProvincia`,
 *   `nombreDeLugarDeMunicipio`);
 * - los rótulos del mapa base y los resultados del buscador, que no traen código, por su posición
 *   dentro del contorno de `comunitatValenciana.ts` (`nombreDelMapaBase`, `nombreDeResultado`).
 */

/** Las provincias de la Comunitat Valenciana: Alacant, Castelló y València. */
export const PROVINCIAS_DE_LA_COMUNITAT_VALENCIANA: ReadonlyArray<string> = ["03", "12", "46"];

/** Si un código INE, de provincia o de municipio, es de la Comunitat Valenciana. */
export const deLaComunitatValenciana = (codigo: string): boolean =>
  PROVINCIAS_DE_LA_COMUNITAT_VALENCIANA.includes(codigo.slice(0, 2));

/**
 * Las dos formas de un nombre bilingüe del INE, «A/B», o de OpenStreetMap, «A / B», sin los
 * espacios de junto a la barra. `undefined` si no lleva una barra entre dos formas: los de una
 * sola forma y los de guion, que son un solo nombre.
 */
export const formasDe = (nombre: string): readonly [string, string] | undefined => {
  const partes = nombre.split("/").map((parte) => parte.trim());
  const [una, otra] = partes;
  return partes.length === 2 && una !== undefined && otra !== undefined && una !== "" && otra !== ""
    ? [una, otra]
    : undefined;
};

/** Un nombre oficial bilingüe con la forma que se ve. */
export const NombreBilingue = Schema.Struct({
  /** Como lo escribe el IGN, con la barra: «Alacant/Alicante». */
  oficial: Schema.String,
  /** Una de sus dos formas: «Alacant». */
  nombre: Schema.String,
});
export type NombreBilingue = typeof NombreBilingue.Type;

/**
 * La tabla de nombres de lugar de las provincias y los municipios con oficial bilingüe, por código
 * INE. La escribe `pnpm run nombres` en `tools/capas` desde los límites del repositorio.
 */
export const TablaDeNombres = Schema.Struct({
  fuente: FuenteDeMunicipios,
  provincias: Schema.Record(Schema.String, NombreBilingue),
  municipios: Schema.Record(Schema.String, NombreBilingue),
});
export type TablaDeNombres = typeof TablaDeNombres.Type;

/** La tabla guardada en el repositorio. Una prueba de `tools/capas` comprueba que está al día. */
export const TABLA_DE_NOMBRES: TablaDeNombres = datos;

const PROVINCIAS: ReadonlyMap<string, NombreBilingue> = new Map(
  Object.entries(TABLA_DE_NOMBRES.provincias),
);
const MUNICIPIOS: ReadonlyMap<string, NombreBilingue> = new Map(
  Object.entries(TABLA_DE_NOMBRES.municipios),
);

/**
 * La forma que se ve de un oficial: la de la tabla si el oficial es el mismo y, si no está, la
 * primera, para no escribir nunca las dos. Sin barra, el mismo.
 */
const enUnaForma = (oficial: string, fila: NombreBilingue | undefined): string => {
  const formas = formasDe(oficial);
  if (formas === undefined) return oficial;
  return fila?.oficial === oficial ? fila.nombre : formas[0];
};

/** El nombre de lugar de una provincia, por su código INE de dos cifras y su nombre oficial. */
export const nombreDeLugarDeProvincia = (codigo: string, oficial: string): string =>
  enUnaForma(oficial, PROVINCIAS.get(codigo));

/** El nombre de lugar de un municipio, por su código INE de cinco cifras y su nombre oficial. */
export const nombreDeLugarDeMunicipio = (codigo: string, oficial: string): string =>
  enUnaForma(oficial, MUNICIPIOS.get(codigo));

/**
 * Los lugares que OpenStreetMap escribe con barra y el IGN de otra forma, con el nombre que se ve.
 * La regla de la barra no los arregla: «Peñacerrada / Urizaharra» daría Peñacerrada, y el oficial
 * es Peñacerrada-Urizaharra. El estilo del mapa base los busca por su `name` tal cual.
 */
export const EXCEPCIONES_DE_OPENSTREETMAP: ReadonlyMap<string, string> = new Map([
  ["Peñacerrada / Urizaharra", "Peñacerrada-Urizaharra"],
]);

/** La clave de un nombre bilingüe, sin mayúsculas ni orden: «alacant/alicante». */
const claveDe = (formas: readonly [string, string]): string =>
  formas
    .map((forma) => forma.toLocaleLowerCase("es"))
    .toSorted()
    .join("/");

/**
 * Los nombres bilingües conocidos, por su clave: los oficiales de la tabla y las excepciones de
 * OpenStreetMap. Así «Donostia / San Sebastián» de OpenStreetMap da lo mismo que
 * «Donostia/San Sebastián» del IGN.
 */
const BILINGUES_CONOCIDOS: ReadonlyMap<string, string> = new Map(
  [
    ...PROVINCIAS.values(),
    ...MUNICIPIOS.values(),
    ...[...EXCEPCIONES_DE_OPENSTREETMAP].map(([oficial, nombre]) => ({ oficial, nombre })),
  ].flatMap(({ oficial, nombre }) => {
    const formas = formasDe(oficial);
    return formas === undefined ? [] : [[claveDe(formas), nombre] as const];
  }),
);

/**
 * Las dos partes de un `name` con barra tal como las corta el estilo del mapa base, que no sabe
 * quitar espacios: la primera acaba en « /» o, si no lo hay, en «/»; la segunda empieza tras «/ »
 * o, si no lo hay, tras «/». `undefined` sin barra.
 */
export const partesDeLaBarra = (nombre: string): readonly [string, string] | undefined => {
  if (!nombre.includes("/")) return undefined;
  const fin = nombre.includes(" /") ? nombre.indexOf(" /") : nombre.indexOf("/");
  const inicio = nombre.includes("/ ") ? nombre.indexOf("/ ") + 2 : nombre.indexOf("/") + 1;
  return [nombre.slice(0, fin), nombre.slice(inicio)];
};

/**
 * Una de las dos partes de un nombre con barra, con su `name:es` de OpenStreetMap: en la
 * Comunitat Valenciana, la que no es `name:es`; fuera, `name:es` si es una de las dos y, si no, la
 * primera.
 */
const parteQueSeVe = (
  [primera, segunda]: readonly [string, string],
  es: string | undefined,
  enLaComunitat: boolean,
): string => {
  if (enLaComunitat) return es === primera ? segunda : primera;
  return es === segunda ? segunda : primera;
};

/** Lo que el mapa base sabe de un lugar de OpenStreetMap para nombrarlo. */
export interface LugarDeOpenStreetMap {
  /** `name`: el nombre local, a veces con barra («Donostia / San Sebastián»). */
  readonly name: string;
  /** `name:es`, si lo tiene. */
  readonly es?: string | undefined;
  /** `name:latin`: el `name` en letra latina, si lo tiene. */
  readonly latin?: string | undefined;
}

/**
 * El rótulo del mapa base de un lugar de OpenStreetMap: lo mismo que la expresión del estilo
 * (`@celda/ui/mapa/nombres.ts`), en TypeScript, para lo que Celda copia o compara de él.
 *
 * 1. Las excepciones, por su `name` tal cual.
 * 2. Con barra, una de las dos partes según `enLaComunitat` (`parteQueSeVe`).
 * 3. En letra no latina (Marruecos, Argelia: «Tanger ⵟⴰⵏⵊⴰ طنجة»), `name:es` o, sin él,
 *    `name:latin`. OpenMapTiles da `name:latin` igual a `name` cuando ya es latina.
 * 4. Si no, `name`.
 */
export const nombreDelMapaBase = (lugar: LugarDeOpenStreetMap, enLaComunitat: boolean): string => {
  const excepcion = EXCEPCIONES_DE_OPENSTREETMAP.get(lugar.name);
  if (excepcion !== undefined) return excepcion;
  const partes = partesDeLaBarra(lugar.name);
  if (partes !== undefined) return parteQueSeVe(partes, lugar.es, enLaComunitat);
  if (lugar.latin !== undefined && lugar.latin !== lugar.name) return lugar.es ?? lugar.latin;
  return lugar.name;
};

/**
 * El nombre de un resultado del buscador o de una parte de su dirección, que Nominatim da con el
 * `name` de OpenStreetMap (ADR 0013): sin barra, el mismo; con barra, primero el de los bilingües
 * conocidos y, si el par no está, una de sus partes con `es`, su `name:es`, según `enLaComunitat`.
 */
export const nombreDeResultado = (
  nombre: string,
  es: string | undefined,
  enLaComunitat: boolean,
): string => {
  const formas = formasDe(nombre);
  if (formas === undefined) return nombre;
  const conocido = BILINGUES_CONOCIDOS.get(claveDe(formas));
  if (conocido !== undefined) return conocido;
  return parteQueSeVe(formas, es, enLaComunitat);
};

/**
 * Las formas de los oficiales bilingües que no se ven: la castellana en la Comunitat Valenciana
 * (Alicante, Elche, Castellón de la Plana) y la otra en el resto (Donostia, Iruña, Araba). El mapa
 * base de reserva del IGN rotula cada municipio bilingüe dos veces en el mismo punto, una con cada
 * forma, y no trae `name:es`: el rótulo de estas formas se quita y queda el del nombre de lugar.
 * Ninguna es el oficial de otro municipio (`nombresReales.test.ts` de `tools/capas`).
 */
export const FORMAS_QUE_NO_SE_VEN: ReadonlyArray<string> = [
  ...new Set(
    [...PROVINCIAS.values(), ...MUNICIPIOS.values()].flatMap(({ oficial, nombre }) =>
      (formasDe(oficial) ?? []).filter((forma) => forma !== nombre),
    ),
  ),
];

const NO_SE_VEN: ReadonlySet<string> = new Set(FORMAS_QUE_NO_SE_VEN);

/**
 * Los oficiales bilingües escritos con la barra, como los trae el IGN de lejos
 * («Donostia/San Sebastián») o con espacios («Donostia / San Sebastián»), con su nombre de lugar.
 */
export const BILINGUES_DEL_IGN: ReadonlyMap<string, string> = new Map(
  [...PROVINCIAS.values(), ...MUNICIPIOS.values()].flatMap(({ oficial, nombre }) => {
    const formas = formasDe(oficial);
    return formas === undefined
      ? []
      : [
          [`${formas[0]}/${formas[1]}`, nombre] as const,
          [`${formas[0]} / ${formas[1]}`, nombre] as const,
        ];
  }),
);

/**
 * El rótulo de un lugar en el mapa base de reserva del IGN (ADR 0025), que escribe los
 * oficiales del IGN y no trae `name:es`. `undefined` si no se rotula: es la forma que no se ve de un
 * bilingüe, que el IGN rotula también con la otra.
 *
 * 1. Las formas que no se ven, fuera (`FORMAS_QUE_NO_SE_VEN`).
 * 2. Un oficial con barra, el nombre de lugar de la tabla (`BILINGUES_DEL_IGN`) o, si no está, su
 *    primera forma.
 * 3. Con otro nombre entre paréntesis, el de antes: el IGN añade así el exónimo de lo de fuera
 *    («Porto (Oporto)») y el país de lo de España en la capa de contexto («Ceuta (ESP)»).
 * 4. Si no, el mismo.
 *
 * El estilo de reserva lo escribe como expresión (`@celda/ui/mapa/reserva/nombres.ts`), y una prueba
 * comprueba que dan lo mismo.
 */
export const nombreDelIgn = (nombre: string): string | undefined => {
  if (NO_SE_VEN.has(nombre)) return undefined;
  const formas = formasDe(nombre);
  if (formas !== undefined) return BILINGUES_DEL_IGN.get(`${formas[0]}/${formas[1]}`) ?? formas[0];
  const parentesis = nombre.indexOf(" (");
  return parentesis === -1 ? nombre : nombre.slice(0, parentesis);
};
