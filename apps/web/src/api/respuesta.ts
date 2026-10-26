/**
 * Lo que contesta la API (ADR 0032), como esquemas: la función escribe el
 * cuerpo con ellos y las pruebas lo leen con ellos. `docs/api.md` lo explica campo a campo.
 *
 * Importa el dominio por ruta relativa, como el resto de `src/api` (ver `consulta.ts`).
 */
import * as Schema from "effect/Schema";

import { Coordenada } from "../../../../packages/dominio/src/area.ts";
import { BandasDeCapa } from "../../../../packages/dominio/src/capa.ts";
import { Compania } from "../../../../packages/dominio/src/compania.ts";
import { Estado } from "../../../../packages/dominio/src/emplazamiento.ts";
import { Licencias } from "../../../../packages/dominio/src/licencias.ts";

/** Un código INE con su nombre oficial. */
export const LugarDeLaRespuesta = Schema.Struct({ codigo: Schema.String, nombre: Schema.String });

export const EmplazamientoCercano = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  /** Del punto de la consulta al emplazamiento, en metros enteros. */
  distanciaMetros: Schema.Int,
  estado: Estado,
  companias: Schema.Array(Compania),
  /** Las bandas que el registro ya ha dado de cada compañía; vacía si aún no ha dado ninguna. */
  bandas: Schema.Array(BandasDeCapa),
  /** `null` en un territorio compartido o en el mar. */
  municipio: Schema.NullOr(LugarDeLaRespuesta),
  /** La provincia en cuya capa va. */
  provincia: LugarDeLaRespuesta,
  /** El lote de fichas en el que está su ficha, con sus bandas y sus medidas de exposición. */
  ficha: Schema.String,
  /** La ficha abierta en el mapa de Celda. */
  enlace: Schema.String,
});
export type EmplazamientoCercano = typeof EmplazamientoCercano.Type;

export const RespuestaDeCercanos = Schema.Struct({
  version: Schema.String,
  /** Fecha de la instantánea, en ISO 8601. */
  fecha: Schema.String,
  consulta: Schema.Struct({
    lat: Schema.Finite,
    lon: Schema.Finite,
    /** El radio de la consulta, pasado a metros. */
    radioMetros: Schema.Int,
    companias: Schema.Array(Compania),
    limite: Schema.Int,
  }),
  /** Cuántos hay dentro del radio con el filtro, aunque se devuelvan menos. */
  total: Schema.Int,
  /** Si hay más dentro del radio que los devueltos: se devuelven los más cercanos. */
  hayMas: Schema.Boolean,
  emplazamientos: Schema.Array(EmplazamientoCercano),
  /** Solo si hace falta: por ejemplo, un radio sin unidad que parece de kilómetros y no encuentra nada. */
  aviso: Schema.optionalKey(Schema.String),
  licencias: Licencias,
});
export type RespuestaDeCercanos = typeof RespuestaDeCercanos.Type;

export const RespuestaDeError = Schema.Struct({
  error: Schema.Literals(["consulta-no-valida", "datos-no-disponibles", "no-encontrado"]),
  mensaje: Schema.String,
});
export type RespuestaDeError = typeof RespuestaDeError.Type;

/** Lo que contesta `GET /api`: qué hay y dónde está la documentación. */
export const IndiceDeLaApi = Schema.Struct({
  descripcion: Schema.String,
  documentacion: Schema.String,
  rutas: Schema.Array(
    Schema.Struct({ ruta: Schema.String, descripcion: Schema.String, ejemplo: Schema.String }),
  ),
});
export type IndiceDeLaApi = typeof IndiceDeLaApi.Type;

export const CercanosEnJson = Schema.fromJsonString(RespuestaDeCercanos);
export const IndiceEnJson = Schema.fromJsonString(IndiceDeLaApi);
export const ErrorEnJson = Schema.fromJsonString(RespuestaDeError);
