import * as Schema from "effect/Schema";

import datos from "../datos/cuadros-del-registro.json" with { type: "json" };
import { Cuadro } from "./barrido.ts";

/**
 * Los cuadros de las zonas de barrido y sus registros, sacados del listado propio del registro
 * oficial de toda España y no de otra web (ADR 0019). Los escribe `pnpm run cuadros`, en
 * `apps/nocturna`, a partir de la base de la ingesta nocturna y de la pasada por los cuadros de
 * borde (`celda-nocturna cuadros-de-borde`). `ZONAS_DE_BARRIDO` tiene que llevar estos cuadros en
 * estas zonas, y la España sintética de las pruebas reparte sus registros con estas cifras.
 */

/** Registros por provincia, por código del INE. Los que no caen en ninguna no cuentan aquí. */
const RegistrosPorProvincia = Schema.Record(Schema.String, Schema.Int);

/** Un cuadro con registros: cuántos, de qué provincias, qué provincias toca y su zona. */
export const CuadroDelRegistro = Schema.Struct({
  cuadro: Cuadro,
  /** El nombre de su zona de barrido, con la regla del ADR 0014 (`zonaDelCuadro`). */
  zona: Schema.String,
  registros: Schema.Int,
  porProvincia: RegistrosPorProvincia,
  /** Las provincias cuyos límites toca, por código del INE. */
  toca: Schema.Array(Schema.String),
});
export type CuadroDelRegistro = typeof CuadroDelRegistro.Type;

/** Lo que trajo un cuadro de borde pedido una vez. */
export const CuadroDeBorde = Schema.Struct({
  cuadro: Cuadro,
  registros: Schema.Int,
  porProvincia: RegistrosPorProvincia,
});
export type CuadroDeBorde = typeof CuadroDeBorde.Type;

/**
 * La pasada única por los cuadros de 1° que tocan los límites de alguna provincia y no estaban en
 * las zonas de barrido. El listado de las zonas nunca los pide, así que un registro que caiga en
 * ellos solo se ve así.
 */
export const PasadaDeBorde = Schema.Struct({
  /** Inicio y fin, en milisegundos. */
  inicio: Schema.Finite,
  fin: Schema.Finite,
  /** Peticiones al geoportal, con `robots.txt` y los reintentos. */
  peticiones: Schema.Int,
  bytes: Schema.Int,
  /** Los cuadros pedidos, con lo que trajo cada uno. Los que no se llegaron a pedir no están. */
  cuadros: Schema.Array(CuadroDeBorde),
  /** Los que no se pudieron pedir, y por qué. */
  errores: Schema.Array(Schema.String),
});
export type PasadaDeBorde = typeof PasadaDeBorde.Type;

export const CuadrosDelRegistro = Schema.Struct({
  /** De dónde sale el listado, en palabras. */
  fuente: Schema.String,
  /** El inicio del barrido más antiguo de los que dan el listado, en milisegundos. */
  barrido: Schema.Finite,
  /** Los registros vigentes del listado, con los de los cuadros de borde. */
  registros: Schema.Int,
  /** Por zona en el orden de `ZONAS_DE_BARRIDO` y, dentro, de sur a norte y de oeste a este. */
  cuadros: Schema.Array(CuadroDelRegistro),
  /** La pasada por los cuadros de borde, o `null` si aún no se ha hecho. */
  borde: Schema.NullOr(PasadaDeBorde),
});
export type CuadrosDelRegistro = typeof CuadrosDelRegistro.Type;

/** Los cuadros del registro guardados en git. */
export const cuadrosDelRegistro = Schema.decodeUnknownEffect(CuadrosDelRegistro)(datos);

/**
 * El fichero que se guarda en el repositorio: JSON con un cuadro por línea, para que un cambio se
 * lea bien en un diff.
 */
export const ficheroDeCuadros = (c: CuadrosDelRegistro): string => {
  const lineas = (elementos: ReadonlyArray<unknown>) =>
    elementos.map((elemento) => JSON.stringify(elemento)).join(",\n");
  const borde =
    c.borde === null
      ? "null"
      : `{"inicio":${c.borde.inicio},"fin":${c.borde.fin},"peticiones":${c.borde.peticiones},` +
        `"bytes":${c.borde.bytes},"errores":${JSON.stringify(c.borde.errores)},"cuadros":[\n` +
        `${lineas(c.borde.cuadros)}\n]}`;
  return (
    `{"fuente":${JSON.stringify(c.fuente)},"barrido":${c.barrido},"registros":${c.registros},` +
    `"cuadros":[\n${lineas(c.cuadros)}\n],\n"borde":${borde}}\n`
  );
};
