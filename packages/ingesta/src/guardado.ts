import { Banda, bandasEnOrden, compararTexto } from "@celda/dominio/banda";
import { MedidaDeExposicion, medidasEnOrden } from "@celda/dominio/exposicion";
import { type Fuente, Observacion } from "@celda/dominio/observacion";
import * as Schema from "effect/Schema";

import { type FichaCruda, type FichaLeida, ListadoCrudo, Registro } from "./extractor.ts";
import { conAntes, type HechoNuevo, type ListadoDelHecho } from "./hecho.ts";
import { huella } from "./huella.ts";
import { bandaAlDia, registroAlDia, registroDeCrudo } from "./registro-oficial/normalizar.ts";

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
  /**
   * Lo que escribió el registro oficial en el último listado, sin limpiar (ADR 0027). Falta en las
   * observaciones que ningún listado ha traído desde que se guarda.
   */
  crudo: Schema.optionalKey(ListadoCrudo),
  /**
   * La huella de las tablas de la última ficha leída tal como las escribe el registro
   * (`huellaDeFicha`), para saber si el registro escribe otra cosa. Los bytes están en el archivo
   * de páginas. Falta en las fichas leídas antes de guardarla.
   */
  huellaDeFicha: Schema.optionalKey(Schema.String),
});
export type ObservacionGuardada = typeof ObservacionGuardada.Type;

/** Una baja se da por buena tras estos barridos completos seguidos sin ver la observación. */
export const BARRIDOS_PARA_RETIRAR = 2;

const { crudo: _crudo, ...camposLimpios } = Registro.fields;
const mismoRegistroLimpio = Schema.toEquivalence(Schema.Struct(camposLimpios));
const mismoCrudo = Schema.toEquivalence(ListadoCrudo);
const bandasIguales = Schema.toEquivalence(Schema.Array(Banda));
const medidasIguales = Schema.toEquivalence(Schema.Array(MedidaDeExposicion));

/**
 * Si dos listas de bandas tienen las mismas, repetidas las mismas veces, en cualquier orden. El
 * registro da las filas de una ficha en otro orden de una petición a otra (ADR 0027).
 */
export const mismasBandas = (a: ReadonlyArray<Banda>, b: ReadonlyArray<Banda>): boolean =>
  a.length === b.length && bandasIguales(bandasEnOrden(a), bandasEnOrden(b));

/** Si dos listas de medidas tienen las mismas, repetidas las mismas veces, en cualquier orden. */
export const mismasMedidas = (
  a: ReadonlyArray<MedidaDeExposicion>,
  b: ReadonlyArray<MedidaDeExposicion>,
): boolean => a.length === b.length && medidasIguales(medidasEnOrden(a), medidasEnOrden(b));

/**
 * La huella de las tablas de una ficha tal como las escribe el registro: FNV-1a de su texto, con
 * separadores que no salen en una ficha. Solo sirve para saber si dos lecturas son la misma. Las
 * filas de cada tabla van ordenadas, con las repetidas tantas veces como salgan, porque el
 * registro las da en otro orden de una petición a otra.
 */
export const huellaDeFicha = (cruda: FichaCruda): string =>
  huella(
    [
      cruda.caracteristicas.map((f) => [f.operador, f.referencia, f.bandaMhz].join("\u001f")),
      cruda.niveles.map((f) => [f.distancia, f.acimut, f.valor].join("\u001f")),
    ]
      .map((filas) => filas.toSorted(compararTexto).join("\u001e"))
      .join("\u001d"),
  );

/** Los campos del listado de una observación guardada, con lo que escribió el registro si lo hay. */
export const registroDe = (o: Registro): Registro => {
  const registro: Registro = {
    clave: o.clave,
    compania: o.compania,
    codigo: o.codigo,
    posicion: o.posicion,
    direccion: o.direccion,
    municipio: o.municipio,
    url: o.url,
  };
  return o.crudo === undefined ? registro : { ...registro, crudo: o.crudo };
};

/**
 * Si dos lecturas en crudo son la misma: iguales si las dos están, distintas si solo está una y,
 * si no está ninguna, lo que diga la comparación de lo limpio.
 */
const igualesEnCrudo = <A>(
  a: A | undefined,
  b: A | undefined,
  iguales: (a: A, b: A) => boolean,
  limpiasIguales: boolean,
): boolean =>
  a !== undefined && b !== undefined
    ? iguales(a, b)
    : a === undefined && b === undefined && limpiasIguales;

/** Lo que guarda un hecho del listado de un registro. */
const listadoDelHecho = (registro: Registro): ListadoDelHecho => {
  if (registro.crudo !== undefined) return { crudo: registro.crudo };
  const { crudo: _sinCrudo, ...limpio } = registro;
  return { registro: limpio };
};

/** Lo que cambia en la base al ver un registro en el listado. */
export interface TrasListado {
  /** Lo que hay que guardar, o `undefined` si la guardada ya está así. */
  readonly guardar: ObservacionGuardada | undefined;
  /** Si cuenta como creada, como cambiada o como ninguna de las dos. */
  readonly cuenta: "creada" | "cambiada" | undefined;
  /**
   * Si cambia lo que se enseña de ella. Una retirada que vuelve igual no cambia, aunque cuente
   * como cambiada.
   */
  readonly cambia: boolean;
  /** El hecho del historial, si lo hay (ADR 0027). */
  readonly hecho: HechoNuevo | undefined;
}

/**
 * Lo limpio de una observación guardada con la limpieza de hoy: de lo que escribió el registro,
 * si lo tiene, y si no, de lo que guardó la limpieza de entonces, limpio otra vez.
 */
const limpioDeHoy = (o: Registro) => {
  const deHoy =
    o.crudo === undefined
      ? registroAlDia(o)
      : (() => {
          const leido = registroDeCrudo(o.crudo);
          return leido.tipo === "registro" ? leido.registro : o;
        })();
  const { crudo: _sinCrudo, ...limpio } = registroDe(deHoy);
  return limpio;
};

/**
 * La observación tras verla en el listado de una ejecución con fecha `fecha`. Una nueva queda
 * pendiente de ficha. Se compara lo que escribió el registro (ADR 0027): si es lo mismo, nada ha
 * cambiado, aunque la limpieza de Celda dé otra cosa; entonces solo se guarda lo limpio de hoy, sin
 * cambiar la fecha. Si el registro escribe otra cosa pero lo limpio es igual, se guarda lo nuevo
 * con su hecho y sin cambiar la fecha. Si lo limpio cambia, cambia la fecha y la ficha se vuelve a
 * leer en esta misma ejecución. Lo limpio se compara siempre con la limpieza de hoy, también la
 * primera vez que se guarda lo que escribió el registro: un arreglo de la limpieza no es un
 * cambio. Una retirada que vuelve cuenta como cambiada.
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
      cambia: false,
      hecho: { tipo: "alta", listado: listadoDelHecho(registro) },
    };
  }
  const limpioIgual = mismoRegistroLimpio(limpioDeHoy(previa), limpioDeHoy(registro));
  const crudoIgual = igualesEnCrudo(previa.crudo, registro.crudo, mismoCrudo, limpioIgual);
  const cambia = !crudoIgual && !limpioIgual;
  const vuelve = previa.retiradaEn !== null;
  const hecho: HechoNuevo | undefined =
    crudoIgual && !vuelve
      ? undefined
      : { tipo: vuelve ? "vuelta" : "listado", listado: listadoDelHecho(registro), cambia };
  const guardado = mismoRegistroLimpio(registroLimpio(previa), registroLimpio(registro));
  if (hecho === undefined && guardado && previa.ausencias === 0) {
    return { guardar: undefined, cuenta: undefined, cambia: false, hecho: undefined };
  }
  const guardada: ObservacionGuardada = {
    ...sinCrudo(previa),
    ...registroDe(registro),
    fecha: cambia ? fecha : previa.fecha,
    fichaLeidaEn: cambia ? null : previa.fichaLeidaEn,
    ausencias: 0,
    retiradaEn: null,
  };
  return {
    // Con otro listado la ficha vuelve a estar pendiente, aunque el registro no la tuviera.
    guardar: cambia ? conFicha(guardada) : guardada,
    cuenta: cambia || vuelve ? "cambiada" : undefined,
    cambia,
    hecho,
  };
};

const registroLimpio = (o: Registro) => {
  const { crudo: _sinCrudo, ...limpio } = registroDe(o);
  return limpio;
};

/** La observación sin lo que escribió el registro en el listado, que se sustituye. */
export const sinCrudo = (o: ObservacionGuardada): ObservacionGuardada => {
  const { crudo: _crudo, ...resto } = o;
  return resto;
};

/** La observación sin la huella de su ficha, que se sustituye. */
const sinHuellaDeFicha = (o: ObservacionGuardada): ObservacionGuardada => {
  const { huellaDeFicha: _huella, ...resto } = o;
  return resto;
};

/** La observación sin la marca de sin ficha en el registro. */
const conFicha = (o: ObservacionGuardada): ObservacionGuardada => {
  const { sinFichaEnRegistro: _sinFicha, ...resto } = o;
  return resto;
};

/** La observación tras leer su ficha, y si han cambiado sus bandas. */
export interface TrasFicha {
  readonly guardada: ObservacionGuardada;
  readonly cambiada: boolean;
  /** El hecho del historial, si lo hay (ADR 0027). */
  readonly hecho: HechoNuevo | undefined;
}

/** La observación cuando el registro dice que no tiene su ficha, con su hecho. */
export interface TrasSinFicha {
  readonly guardada: ObservacionGuardada;
  readonly hecho: HechoNuevo;
}

/** La observación tras faltar en un barrido, y si con eso queda retirada. */
export interface TrasAusencia {
  readonly guardada: ObservacionGuardada;
  readonly retirada: boolean;
  /** El hecho del historial, si queda retirada (ADR 0027). */
  readonly hecho: HechoNuevo | undefined;
}

/**
 * La observación tras leer su ficha en una ejecución con fecha `fecha`. La fecha de la
 * observación solo cambia si cambian las bandas o las medidas de exposición; la de lectura,
 * siempre. Una guardada antes de que Celda leyera las medidas no las tiene: leerlas por primera vez
 * es un cambio que se publica, pero no mueve la fecha, porque el registro ya las publicaba. Una
 * lectura buena quita la marca de sin ficha en el registro, y eso también cuenta como cambio.
 *
 * Como en el listado, se compara lo que escribió el registro (ADR 0027): si escribe lo mismo, la
 * fecha no se mueve aunque la limpieza dé otras bandas, y no hay hecho salvo si vuelve a tener
 * ficha. La primera vez que se guarda la huella de una ficha, sus bandas de antes se comparan con
 * la limpieza de hoy (`bandaAlDia`). La primera ficha de una estación base nueva tampoco mueve la
 * fecha, que es la de su alta. Ni la huella ni las bandas ni las medidas miran el orden de las
 * filas, que el registro cambia de una petición a otra.
 */
export const trasFicha = (
  previa: ObservacionGuardada,
  leida: FichaLeida,
  fecha: number,
): TrasFicha => {
  const { cruda, pagina } = leida;
  // Se guardan en su orden, como las da `fichaDeCruda`, también si vienen de otra fuente.
  const bandas = bandasEnOrden(leida.bandas);
  const medidasDeExposicion = medidasEnOrden(leida.medidasDeExposicion);
  const nueva = cruda === undefined ? undefined : huellaDeFicha(cruda);
  const medidasDeAntes = previa.medidasDeExposicion;
  const primerasMedidas = medidasDeAntes === undefined;
  const bandasDeAntes =
    previa.huellaDeFicha === undefined ? previa.bandas.map(bandaAlDia) : previa.bandas;
  const limpiasIguales =
    mismasBandas(bandasDeAntes, bandas) &&
    (medidasDeAntes === undefined || mismasMedidas(medidasDeAntes, medidasDeExposicion));
  const crudaIgual = igualesEnCrudo(previa.huellaDeFicha, nueva, (a, b) => a === b, limpiasIguales);
  // La primera ficha de una estación base nueva no cambia nada: es lo que ya decía el registro
  // cuando apareció en el listado, aunque se lea unas noches después.
  const conocida =
    previa.huellaDeFicha !== undefined ||
    previa.medidasDeExposicion !== undefined ||
    previa.fichaLeidaEn !== null ||
    previa.bandas.length > 0;
  const cambia = conocida && !crudaIgual && !limpiasIguales;
  const vuelve = previa.sinFichaEnRegistro !== undefined;
  const hecho: HechoNuevo | undefined =
    crudaIgual && !vuelve
      ? undefined
      : conAntes(
          {
            tipo: "ficha",
            ficha: pagina === undefined ? { leida: { bandas, medidasDeExposicion } } : { pagina },
            cambia,
          },
          previa.fichaLeidaEn,
        );
  const conLaFicha: ObservacionGuardada = {
    ...sinHuellaDeFicha(previa),
    bandas,
    medidasDeExposicion,
    fecha: cambia ? fecha : previa.fecha,
    fichaLeidaEn: fecha,
  };
  return {
    guardada: conFicha(nueva === undefined ? conLaFicha : { ...conLaFicha, huellaDeFicha: nueva }),
    cambiada: !mismasBandas(previa.bandas, bandas) || !limpiasIguales || primerasMedidas || vuelve,
    hecho,
  };
};

/**
 * La observación cuando el registro dice que no tiene su ficha («Código de emplazamiento no
 * válido»), comprobado en una ejecución con fecha `fecha`. Sus bandas y su fecha no cambian, y la
 * ficha sigue en la cola: se vuelve a pedir con la espera de cualquier fallo (`ESPERA_TRAS_FALLO`).
 * Cada comprobación es un hecho.
 */
export const trasSinFicha = (previa: ObservacionGuardada, fecha: number): TrasSinFicha => ({
  guardada: { ...previa, sinFichaEnRegistro: fecha },
  hecho: { tipo: "sin-ficha" },
});

/**
 * La observación tras un barrido completo que no la ha visto, en una ejecución con fecha
 * `fecha`: cuenta una ausencia más y, a las `BARRIDOS_PARA_RETIRAR`, se retira. Con una sola no,
 * por si la fuente falló.
 */
export const trasAusencia = (previa: ObservacionGuardada, fecha: number): TrasAusencia => {
  const ausencias = previa.ausencias + 1;
  const retirada = ausencias >= BARRIDOS_PARA_RETIRAR;
  return {
    guardada: { ...previa, ausencias, retiradaEn: retirada ? fecha : null },
    retirada,
    hecho: retirada ? { tipo: "retirada" } : undefined,
  };
};

/**
 * La observación con la limpieza de hoy (ADR 0027): la compañía, el código, la dirección, el
 * municipio y el enlace salen de lo que escribió el registro en el listado, si se tiene, y si no,
 * de lo que guardó la limpieza de entonces, limpio otra vez (`registroAlDia`). Así un
 * arreglo de la limpieza llega a todas en la siguiente fusión, sin cambiar sus fechas. Las bandas
 * no: la ficha guarda solo la huella de sus tablas, y un arreglo de su lectura llega al releerla,
 * del registro o del archivo de páginas (`releer-archivo --aplicar`).
 */
export const alDia = (o: ObservacionGuardada): ObservacionGuardada => {
  const leido = o.crudo === undefined ? undefined : registroDeCrudo(o.crudo);
  const deHoy = leido?.tipo === "registro" ? leido.registro : registroAlDia(o);
  const { compania, codigo, direccion, municipio, url } = deHoy;
  return { ...o, compania, codigo, direccion, municipio, url };
};

/** Lo que la fusión necesita de una observación guardada, con la limpieza de hoy. */
export const observacionDe = (guardada: ObservacionGuardada): Observacion => {
  const o = alDia(guardada);
  const observacion: Observacion = {
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
  };
  const { sinFichaEnRegistro, medidasDeExposicion } = o;
  const conMarca =
    sinFichaEnRegistro === undefined ? observacion : { ...observacion, sinFichaEnRegistro };
  return medidasDeExposicion === undefined ? conMarca : { ...conMarca, medidasDeExposicion };
};
