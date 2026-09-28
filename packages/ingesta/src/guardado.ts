import { Banda } from "@celda/dominio/banda";
import { type Fuente, Observacion } from "@celda/dominio/observacion";
import * as Schema from "effect/Schema";

import { Registro } from "./extractor.ts";

/**
 * Lo último que dice una fuente de una estación base, tal como lo guarda la ingesta entre
 * noches. `fecha` cambia solo cuando cambia lo que dice la fuente, así que una ejecución sin
 * cambios no escribe nada.
 */
export const ObservacionGuardada = Schema.Struct({
  ...Observacion.fields,
  /** Cuándo se leyó la ficha por última vez. Nulo si está pendiente. */
  fichaLeidaEn: Schema.NullOr(Schema.Finite),
  /** Barridos completos seguidos en los que el listado no la trae. */
  ausencias: Schema.Int,
  /** Cuándo se dio por retirada: tras dos barridos completos sin verla. */
  retiradaEn: Schema.NullOr(Schema.Finite),
  /** En las fuentes que listan puntos, el punto de cuyo detalle salió. */
  punto: Schema.optionalKey(Schema.String),
});
export type ObservacionGuardada = typeof ObservacionGuardada.Type;

/** Una baja se da por buena tras estos barridos completos seguidos sin ver la observación. */
export const BARRIDOS_PARA_RETIRAR = 2;

const mismoRegistro = Schema.toEquivalence(Registro);
const mismasBandas = Schema.toEquivalence(Schema.Array(Banda));

/** Los campos del listado de una observación guardada. */
export const registroDe = (o: Registro): Registro => ({
  clave: o.clave,
  compania: o.compania,
  codigo: o.codigo,
  posicion: o.posicion,
  direccion: o.direccion,
  municipio: o.municipio,
  url: o.url,
});

/** Lo que cambia en la base al ver un registro en el listado. */
export interface TrasListado {
  /** Lo que hay que guardar, o `undefined` si la guardada ya está así. */
  readonly guardar: ObservacionGuardada | undefined;
  /** Si cuenta como creada, como cambiada o como ninguna de las dos. */
  readonly cuenta: "creada" | "cambiada" | undefined;
}

/**
 * La observación tras verla en el listado de una ejecución con fecha `fecha`. Una nueva queda
 * pendiente de ficha. Si el listado dice lo mismo que la guardada solo se escribe para poner a
 * cero sus ausencias, sin cambiar su fecha. Si dice otra cosa, cambia la fecha y la ficha se
 * vuelve a leer en esta misma ejecución. Una retirada que vuelve cuenta como cambiada.
 */
export const trasListado = (
  previa: ObservacionGuardada | undefined,
  registro: Registro,
  fuente: Fuente,
  fecha: number,
): TrasListado => {
  if (previa === undefined) {
    return {
      guardar: {
        ...registro,
        fuente,
        afirma: "presente",
        bandas: [],
        fecha,
        fichaLeidaEn: null,
        ausencias: 0,
        retiradaEn: null,
      },
      cuenta: "creada",
    };
  }
  const igual = mismoRegistro(registroDe(previa), registro);
  if (igual && previa.ausencias === 0 && previa.retiradaEn === null) {
    return { guardar: undefined, cuenta: undefined };
  }
  return {
    guardar: {
      ...previa,
      ...registroDe(registro),
      fecha: igual ? previa.fecha : fecha,
      fichaLeidaEn: igual ? previa.fichaLeidaEn : null,
      ausencias: 0,
      retiradaEn: null,
    },
    cuenta: !igual || previa.retiradaEn !== null ? "cambiada" : undefined,
  };
};

/** La observación tras leer su ficha, y si han cambiado sus bandas. */
export interface TrasFicha {
  readonly guardada: ObservacionGuardada;
  readonly cambiada: boolean;
}

/** La observación tras faltar en un barrido, y si con eso queda retirada. */
export interface TrasAusencia {
  readonly guardada: ObservacionGuardada;
  readonly retirada: boolean;
}

/**
 * La observación tras leer su ficha en una ejecución con fecha `fecha`. La fecha de la
 * observación solo cambia si cambian las bandas; la de lectura, siempre.
 */
export const trasFicha = (
  previa: ObservacionGuardada,
  bandas: ReadonlyArray<Banda>,
  fecha: number,
): TrasFicha => {
  const iguales = mismasBandas(previa.bandas, bandas);
  return {
    guardada: { ...previa, bandas, fecha: iguales ? previa.fecha : fecha, fichaLeidaEn: fecha },
    cambiada: !iguales,
  };
};

/**
 * La observación tras un barrido completo que no la ha visto, en una ejecución con fecha
 * `fecha`: cuenta una ausencia más y, a las `BARRIDOS_PARA_RETIRAR`, se retira. Con una sola no,
 * por si la fuente falló.
 */
export const trasAusencia = (previa: ObservacionGuardada, fecha: number): TrasAusencia => {
  const ausencias = previa.ausencias + 1;
  const retirada = ausencias >= BARRIDOS_PARA_RETIRAR;
  return { guardada: { ...previa, ausencias, retiradaEn: retirada ? fecha : null }, retirada };
};

/** Lo que la fusión necesita de una observación guardada. */
export const observacionDe = (o: ObservacionGuardada): Observacion => ({
  fuente: o.fuente,
  clave: o.clave,
  compania: o.compania,
  codigo: o.codigo,
  posicion: o.posicion,
  direccion: o.direccion,
  municipio: o.municipio,
  bandas: o.bandas,
  url: o.url,
  fecha: o.fecha,
  afirma: o.afirma,
});
