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
  readonly cuadros: ReadonlyArray<Cuadro>;
}

/**
 * Las siete zonas de barrido de España, con los 94 cuadros de 1° en los que antenasmoviles.es
 * tenía algún marcador el 28/09/2026. Cada cuadro va a la comunidad con más registros previstos
 * en él, salvo los que tocan Cataluña, que van todos a Cataluña para barrerla entera en una
 * noche. Registros previstos con la densidad de antenasmoviles.es (investigación 08):
 * Cataluña 9.859, centro 12.230, Andalucía 11.351, levante 10.709, norte 9.488, Ebro y Duero
 * 10.045, y oeste y Canarias 5.229.
 */
export const ZONAS_DE_BARRIDO: ReadonlyArray<ZonaDeBarrido> = [
  {
    nombre: "cataluna",
    titulo: "Cataluña",
    cuadros: ["0,40", "0,41", "1,41", "2,41", "3,41", "0,42", "1,42", "2,42", "3,42"],
  },
  {
    nombre: "centro",
    titulo: "Madrid y Castilla-La Mancha",
    cuadros: [
      "-5,38",
      "-4,38",
      "-3,38",
      "-5,39",
      "-4,39",
      "-3,39",
      "-2,39",
      "-5,40",
      "-4,40",
      "-3,40",
    ],
  },
  {
    nombre: "andalucia",
    titulo: "Andalucía, Ceuta y Melilla",
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
    ],
  },
  {
    nombre: "levante",
    titulo: "Comunitat Valenciana, Región de Murcia e Illes Balears",
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
    cuadros: [
      "-6,40",
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
