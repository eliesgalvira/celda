import * as Schema from "effect/Schema";

import type { Coordenada } from "./area.ts";

/** Rectángulo en grados, en el orden de `bbox`: oeste, sur, este y norte. */
export const Caja = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]);
export type Caja = readonly [oeste: number, sur: number, este: number, norte: number];

/**
 * Cuadro de 1° de la rejilla fija con que se recorre el listado del registro oficial (ADR 0014),
 * escrito como la longitud y la latitud enteras de su esquina suroeste: `2,41` va de 2° a 3° de
 * longitud y de 41° a 42° de latitud.
 */
export const Cuadro = Schema.String.pipe(Schema.check(Schema.isPattern(/^-?\d{1,3},-?\d{1,2}$/u)));
export type Cuadro = typeof Cuadro.Type;

/** El cuadro en que cae un punto. Un punto en el borde oeste o sur es del cuadro. */
export const cuadroDe = ({ longitud, latitud }: Coordenada): Cuadro =>
  `${Math.floor(longitud)},${Math.floor(latitud)}`;

/** La caja de un cuadro. */
export const cajaDeCuadro = (cuadro: Cuadro): Caja => {
  const [oeste = 0, sur = 0] = cuadro.split(",").map(Number);
  return [oeste, sur, oeste + 1, sur + 1];
};

/** Los cuatro cuartos de una caja: suroeste, sureste, noroeste y noreste. */
export const dividir = ([oeste, sur, este, norte]: Caja): ReadonlyArray<Caja> => {
  const [x, y] = [(oeste + este) / 2, (sur + norte) / 2];
  return [
    [oeste, sur, x, y],
    [x, sur, este, y],
    [oeste, y, x, norte],
    [x, y, este, norte],
  ];
};

/** Veces que se ha dividido un cuadro para llegar a una de sus cajas: 0 para el cuadro entero. */
export const divisiones = ([oeste, , este]: Caja): number =>
  Math.round(Math.log2(1 / (este - oeste)));

const dentroDe = ([oeste, sur, este, norte]: Caja, [o, s, e, n]: Caja) =>
  o >= oeste && s >= sur && e <= este && n <= norte && o < e && s < n;

/**
 * Si unas cajas guardadas sirven para recorrer un cuadro: todas caen dentro y entre todas lo
 * cubren. Las cajas salen de dividir el cuadro, así que no se solapan y basta con sumar su área.
 */
export const cubrenElCuadro = (cuadro: Cuadro, cajas: ReadonlyArray<Caja>): boolean => {
  const entera = cajaDeCuadro(cuadro);
  const area = cajas.reduce((suma, [o, s, e, n]) => suma + (e - o) * (n - s), 0);
  return cajas.length > 0 && cajas.every((caja) => dentroDe(entera, caja)) && area === 1;
};

/**
 * Grupo con nombre de cuadros que la ingesta barre en una misma ejecución. Una observación es de
 * la zona de barrido que tiene el cuadro en que cae, y solo se le cuentan ausencias al barrer esa
 * zona.
 */
export interface ZonaDeBarrido {
  /** Cómo se escribe en la configuración: minúsculas, sin tildes y con guiones. */
  readonly nombre: string;
  /** Cómo se lee: las comunidades autónomas que cubre. */
  readonly titulo: string;
  /** Las comunidades autónomas de `titulo`, por su código del INE. */
  readonly comunidades: ReadonlyArray<string>;
  readonly cuadros: ReadonlyArray<Cuadro>;
}

/**
 * Las siete zonas de barrido de España, con los 94 cuadros de 1° en los que el listado propio del
 * registro oficial tiene algún registro (ADR 0019). Salen de su listado de toda España, los 69.612
 * registros barridos el 29/09/2026, que guarda `cuadrosDelRegistro` con los registros de cada
 * cuadro; la pasada por los cuadros de borde, que tocan España y no están aquí, aún no se ha hecho.
 * Cada cuadro va a la comunidad con más registros en él, salvo los que tocan Cataluña, que van
 * todos a Cataluña para barrerla entera en una noche (`zonaDelCuadro`, ADR 0014). Registros por
 * zona: Cataluña 10.305, centro 11.007, Andalucía 11.578, levante 10.947, norte 9.287, Ebro y
 * Duero 10.993, y oeste y Canarias 5.495.
 */
export const ZONAS_DE_BARRIDO: ReadonlyArray<ZonaDeBarrido> = [
  {
    nombre: "cataluna",
    titulo: "Cataluña",
    comunidades: ["09"],
    cuadros: ["0,40", "0,41", "1,41", "2,41", "3,41", "0,42", "1,42", "2,42", "3,42"],
  },
  {
    nombre: "centro",
    titulo: "Madrid y Castilla-La Mancha",
    comunidades: ["13", "08"],
    cuadros: ["-4,38", "-3,38", "-5,39", "-4,39", "-3,39", "-2,39", "-4,40", "-3,40"],
  },
  {
    nombre: "andalucia",
    titulo: "Andalucía, Ceuta y Melilla",
    comunidades: ["01", "18", "19"],
    cuadros: [
      "-6,35",
      "-3,35",
      "-7,36",
      "-6,36",
      "-5,36",
      "-4,36",
      "-3,36",
      "-2,36",
      "-8,37",
      "-7,37",
      "-6,37",
      "-5,37",
      "-4,37",
      "-3,37",
      "-5,38",
    ],
  },
  {
    nombre: "levante",
    titulo: "Comunitat Valenciana, Región de Murcia e Illes Balears",
    comunidades: ["10", "14", "04"],
    cuadros: [
      "-2,37",
      "-1,37",
      "-2,38",
      "-1,38",
      "0,38",
      "1,38",
      "-1,39",
      "0,39",
      "1,39",
      "2,39",
      "3,39",
      "4,39",
      "3,40",
      "4,40",
    ],
  },
  {
    nombre: "norte",
    titulo: "Galicia, Asturias, Cantabria y País Vasco",
    comunidades: ["12", "03", "06", "16"],
    cuadros: [
      "-9,41",
      "-8,41",
      "-10,42",
      "-9,42",
      "-8,42",
      "-10,43",
      "-9,43",
      "-8,43",
      "-7,43",
      "-6,43",
      "-5,43",
      "-4,43",
      "-3,43",
      "-2,43",
    ],
  },
  {
    nombre: "ebro-y-duero",
    titulo: "Castilla y León, Aragón, Navarra y La Rioja",
    comunidades: ["07", "02", "15", "17"],
    cuadros: [
      "-6,40",
      "-5,40",
      "-2,40",
      "-1,40",
      "-7,41",
      "-6,41",
      "-5,41",
      "-4,41",
      "-3,41",
      "-2,41",
      "-1,41",
      "-7,42",
      "-6,42",
      "-5,42",
      "-4,42",
      "-3,42",
      "-2,42",
      "-1,42",
    ],
  },
  {
    nombre: "oeste-y-canarias",
    titulo: "Extremadura y Canarias",
    comunidades: ["11", "05"],
    cuadros: [
      "-19,27",
      "-18,27",
      "-16,27",
      "-18,28",
      "-17,28",
      "-16,28",
      "-15,28",
      "-14,28",
      "-14,29",
      "-8,38",
      "-7,38",
      "-6,38",
      "-8,39",
      "-7,39",
      "-6,39",
      "-7,40",
    ],
  },
];

/** La zona de barrido con ese nombre, si la hay. */
export const zonaDeBarrido = (nombre: string): ZonaDeBarrido | undefined =>
  ZONAS_DE_BARRIDO.find((zona) => zona.nombre === nombre);

/** La comunidad autónoma de cada provincia, por los códigos del INE de las dos. */
export const COMUNIDAD_DE_PROVINCIA: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "01": ["04", "11", "14", "18", "21", "23", "29", "41"],
    "02": ["22", "44", "50"],
    "03": ["33"],
    "04": ["07"],
    "05": ["35", "38"],
    "06": ["39"],
    "07": ["05", "09", "24", "34", "37", "40", "42", "47", "49"],
    "08": ["02", "13", "16", "19", "45"],
    "09": ["08", "17", "25", "43"],
    "10": ["03", "12", "46"],
    "11": ["06", "10"],
    "12": ["15", "27", "32", "36"],
    "13": ["28"],
    "14": ["30"],
    "15": ["31"],
    "16": ["01", "20", "48"],
    "17": ["26"],
    "18": ["51"],
    "19": ["52"],
  }).flatMap(([comunidad, provincias]) => provincias.map((p) => [p, comunidad] as const)),
);

/** Cataluña, por su código del INE: un cuadro que la toca va a su zona. */
const CATALUNA = "09";

/** Lo que el listado del registro oficial dice de un cuadro, para elegir su zona de barrido. */
export interface RegistrosDelCuadro {
  /** Sus registros por provincia, por código del INE. */
  readonly porProvincia: Readonly<Record<string, number>>;
  /** Las provincias cuyos límites toca, por código del INE. */
  readonly toca: ReadonlyArray<string>;
}

/**
 * La zona de barrido de un cuadro con la regla del ADR 0014: la de la comunidad con más registros
 * en él, salvo si toca Cataluña, que va a Cataluña para barrerla entera en una noche. A igualdad
 * de registros gana la comunidad de código menor. Un cuadro sin registros con provincia va con la
 * primera provincia que toca, y uno que no toca ninguna no es de ninguna zona.
 */
export const zonaDelCuadro = (cuadro: RegistrosDelCuadro): ZonaDeBarrido | undefined => {
  const comunidadDe = (provincia: string) => COMUNIDAD_DE_PROVINCIA.get(provincia);
  if (cuadro.toca.some((provincia) => comunidadDe(provincia) === CATALUNA)) {
    return zonaDeBarrido("cataluna");
  }
  const porComunidad = new Map<string, number>();
  for (const [provincia, registros] of Object.entries(cuadro.porProvincia)) {
    const comunidad = comunidadDe(provincia);
    if (comunidad === undefined) continue;
    porComunidad.set(comunidad, (porComunidad.get(comunidad) ?? 0) + registros);
  }
  const [mayor] = [...porComunidad]
    .filter(([, registros]) => registros > 0)
    .sort(([a, ra], [b, rb]) => rb - ra || (a < b ? -1 : 1));
  const comunidad = mayor?.[0] ?? cuadro.toca.map(comunidadDe).find((c) => c !== undefined);
  return ZONAS_DE_BARRIDO.find(
    (zona) => comunidad !== undefined && zona.comunidades.includes(comunidad),
  );
};
