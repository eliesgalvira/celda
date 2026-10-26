import * as Schema from "effect/Schema";

import {
  AportacionCompartible,
  type Cambio,
  type CorreccionPropuesta,
  type Corroboracion,
} from "./aportacion.ts";
import { Coordenada, distanciaMetros } from "./area.ts";
import { Compania, NOMBRE_COMPANIA } from "./compania.ts";
import { type CorreccionDeFicha, Ficha } from "./ficha.ts";

/**
 * La moderación de las aportaciones compartidas (ADR 0020): lo que la herramienta de moderación
 * lee del buzón y escribe en él, el contexto con que se decide cada aportación, el veredicto que
 * puede proponer un agente y cómo lo aceptado llega a la ficha. Son esquemas y funciones puras:
 * las usan el buzón en Convex, la herramienta de moderación y la ingesta nocturna.
 */

/** En qué punto de la moderación está una aportación compartida. */
export const EstadoDeModeracion = Schema.Literals(["pendiente", "aceptada", "rechazada"]);
export type EstadoDeModeracion = typeof EstadoDeModeracion.Type;

/** Qué se veta: la identidad de un dispositivo o la huella de una IP. */
export const TipoDeVeto = Schema.Literals(["identidad", "ip"]);
export type TipoDeVeto = typeof TipoDeVeto.Type;

/** Ninguna aportación del buzón tiene ese identificador. */
export class AportacionDesconocida extends Schema.TaggedError<AportacionDesconocida>()(
  "AportacionDesconocida",
  { id: Schema.String },
) {
  override get message() {
    return `El buzón no tiene ninguna aportación ${this.id}.`;
  }
}

/**
 * La aportación ya tiene el otro veredicto. Un veredicto no se cambia: lo aceptado puede haber
 * salido ya en la publicación nocturna, que solo lee lo aceptado.
 */
export class AportacionYaModerada extends Schema.TaggedError<AportacionYaModerada>()(
  "AportacionYaModerada",
  { id: Schema.String, estado: EstadoDeModeracion },
) {
  override get message() {
    return `La aportación ${this.id} ya está ${this.estado}: un veredicto no se cambia.`;
  }
}

/** Lo más largo que puede ser un motivo de la moderación, en caracteres. */
export const LARGO_MAXIMO_MOTIVO = 500;

/**
 * El motivo de un veredicto o de un veto. Siempre hace falta uno, y no vale uno en blanco: es lo
 * que explica después por qué se aceptó, se rechazó o se vetó.
 */
export const Motivo = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(LARGO_MAXIMO_MOTIVO),
    Schema.makeFilter((motivo) => motivo.trim().length > 0 || "hace falta un motivo"),
  ),
);

/** Una aportación compartida tal como la ve la moderación. */
export const AportacionEnCola = Schema.Struct({
  id: Schema.String,
  /** El `_id` de la identidad que la envió: el historial de quien envía sale de aquí. */
  identidad: Schema.String,
  /** La huella de la IP, si aún no han pasado 24 horas. */
  huellaIp: Schema.NullOr(Schema.String),
  recibidaEl: Schema.Finite,
  contenido: AportacionCompartible,
  estado: EstadoDeModeracion,
  moderadaEl: Schema.NullOr(Schema.Finite),
  motivo: Schema.NullOr(Schema.String),
  /** Si la identidad o la huella que la enviaron están vetadas. */
  vetada: Schema.Boolean,
});
export type AportacionEnCola = typeof AportacionEnCola.Type;

/** Una página de la cola: sigue después de `ultima` mientras no sea nula. */
export const PaginaDeCola = Schema.Struct({
  aportaciones: Schema.Array(AportacionEnCola),
  ultima: Schema.NullOr(Schema.Finite),
});
export type PaginaDeCola = typeof PaginaDeCola.Type;

/** Lo más largo que puede ser una página de la cola del buzón. */
export const PAGINA_MAXIMA = 200;

/** Cuántas aportaciones se piden de una vez al buzón con su contexto. */
export const CONTEXTOS_POR_LLAMADA = 20;

/** Cuántas aportaciones de una identidad ha aceptado y rechazado la moderación, y cuántas esperan. */
export const HistorialDeIdentidad = Schema.Struct({
  aceptadas: Schema.Int,
  rechazadas: Schema.Int,
  pendientes: Schema.Int,
});
export type HistorialDeIdentidad = typeof HistorialDeIdentidad.Type;

/**
 * Lo que sabe el buzón de una aportación: ella, el historial de quien la envió sin contarla a ella
 * y las demás correcciones propuestas y corroboraciones sobre el mismo emplazamiento, en
 * cualquier estado. De un emplazamiento que falta, las demás que dicen que falta uno a menos de
 * `DISTANCIA_FALTA_RELACIONADA_M`.
 */
export const ContextoEnElBuzon = Schema.Struct({
  aportacion: AportacionEnCola,
  historial: HistorialDeIdentidad,
  relacionadas: Schema.Array(AportacionEnCola),
});
export type ContextoEnElBuzon = typeof ContextoEnElBuzon.Type;

/**
 * Hasta dónde dos correcciones que dicen que falta un emplazamiento hablan del mismo. Es el doble
 * del umbral de dirección de la fusión (ADR 0012): quien marca un punto a mano en el mapa se
 * desvía más que el registro.
 */
export const DISTANCIA_FALTA_RELACIONADA_M = 60;

/**
 * Dos correcciones de posición del mismo emplazamiento que caen a esta distancia o menos dicen lo
 * mismo, y por debajo de ella una posición propuesta no cambia nada: es el umbral de la fusión
 * (ADR 0012).
 */
export const DISTANCIA_MISMO_SITIO_M = 15;

/** A partir de aquí una posición propuesta queda tan lejos que puede ser otro emplazamiento. */
export const DISTANCIA_DUDOSA_M = 1000;

/** Hasta dónde se buscan emplazamientos publicados alrededor de uno que falta. */
export const RADIO_CERCANOS_M = 300;

/** El punto que propone una aportación, si propone uno: una posición o un sitio que falta. */
export const puntoPropuesto = (contenido: AportacionCompartible): Coordenada | null => {
  switch (contenido.tipo) {
    case "correccion-propuesta":
      return contenido.cambio.tipo === "posicion" || contenido.cambio.tipo === "falta"
        ? contenido.cambio.posicion
        : null;
    case "corroboracion":
      return null;
  }
};

/** Un emplazamiento publicado cerca del punto de una aportación. */
export const EmplazamientoCercano = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  companias: Schema.Array(Compania),
  metros: Schema.Finite,
});
export type EmplazamientoCercano = typeof EmplazamientoCercano.Type;

/**
 * Todo lo que la moderación necesita para decidir una aportación en segundos:
 *
 * - `publicado`: la ficha del emplazamiento tal como está publicada en la versión `version`, con
 *   lo que dice el registro oficial y las correcciones ya aceptadas, o `null` si no está publicado;
 * - `distanciaM`: de la posición publicada al punto que propone la aportación (la posición nueva),
 *   o, si dice que falta un emplazamiento, al publicado más cercano;
 * - `cercanos`: los emplazamientos publicados a menos de `RADIO_CERCANOS_M` del punto de uno que
 *   falta, del más cercano al más lejano;
 * - el historial de quien la envía y las demás aportaciones del mismo emplazamiento, del buzón.
 */
export const AportacionConContexto = Schema.Struct({
  aportacion: AportacionEnCola,
  emplazamiento: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  publicado: Schema.NullOr(Ficha),
  distanciaM: Schema.NullOr(Schema.Finite),
  cercanos: Schema.Array(EmplazamientoCercano),
  historial: HistorialDeIdentidad,
  relacionadas: Schema.Array(AportacionEnCola),
});
export type AportacionConContexto = typeof AportacionConContexto.Type;

/** Lo que propone el veredicto: aceptar, rechazar o que lo mire con calma el usuario. */
export const Veredicto = Schema.Literals(["aceptar", "rechazar", "mirar"]);
export type Veredicto = typeof Veredicto.Type;

/**
 * Un veredicto propuesto con su razonamiento. No cambia nada: aceptar o rechazar lo hace solo la
 * orden explícita, con el motivo que confirma el usuario.
 */
export const VeredictoPropuesto = Schema.Struct({
  id: Schema.String,
  veredicto: Veredicto,
  razones: Schema.Array(Schema.String),
});
export type VeredictoPropuesto = typeof VeredictoPropuesto.Type;

const metros = (valor: number): string => `${Math.round(valor).toLocaleString("es-ES")} m`;

/** Si dos cambios propuestos para el mismo emplazamiento dicen lo mismo. */
export const mismoCambio = (a: Cambio, b: Cambio): boolean => {
  switch (a.tipo) {
    case "posicion":
      return (
        b.tipo === "posicion" && distanciaMetros(a.posicion, b.posicion) <= DISTANCIA_MISMO_SITIO_M
      );
    case "compania":
      return b.tipo === "compania" && a.compania === b.compania && a.esta === b.esta;
    case "ya-no-existe":
      return b.tipo === "ya-no-existe";
    case "falta":
      return (
        b.tipo === "falta" &&
        distanciaMetros(a.posicion, b.posicion) <= DISTANCIA_FALTA_RELACIONADA_M
      );
  }
};

/** Las identidades distintas, sin contar `identidad`, que han enviado algo que cumple `cumple`. */
const otrasIdentidades = (
  relacionadas: ReadonlyArray<AportacionEnCola>,
  identidad: string,
  cumple: (a: AportacionEnCola) => boolean,
): ReadonlySet<string> =>
  new Set(
    relacionadas.filter((a) => a.identidad !== identidad && cumple(a)).map((a) => a.identidad),
  );

const proponeLoMismo = (cambio: Cambio) => (a: AportacionEnCola) =>
  a.contenido.tipo === "correccion-propuesta" &&
  a.estado !== "rechazada" &&
  mismoCambio(cambio, a.contenido.cambio);

/** Lo que dice el registro oficial de una compañía en la ficha publicada. */
const registroTieneCompania = (ficha: Ficha, compania: Compania): boolean =>
  ficha.estaciones.some(
    (e) =>
      e.compania === compania &&
      e.origenes.some((o) => o.fuente === "registro-oficial" && o.afirma === "presente"),
  );

type Decision = { readonly veredicto: Veredicto; readonly razones: ReadonlyArray<string> };

const decidirCorreccion = (
  contexto: AportacionConContexto,
  correccion: CorreccionPropuesta,
): Decision => {
  const { publicado, distanciaM, relacionadas, aportacion } = contexto;
  const { cambio } = correccion;
  const otras = otrasIdentidades(relacionadas, aportacion.identidad, proponeLoMismo(cambio));
  const apoyo =
    otras.size === 0
      ? "Nadie más propone lo mismo."
      : `${otras.size} ${otras.size === 1 ? "identidad más propone" : "identidades más proponen"} lo mismo.`;
  if (cambio.tipo === "falta") {
    const [cercano] = contexto.cercanos;
    if (cercano !== undefined && cercano.metros <= DISTANCIA_MISMO_SITIO_M) {
      return {
        veredicto: "rechazar",
        razones: [`Ya está publicado ${cercano.clave}, a ${metros(cercano.metros)} del punto.`],
      };
    }
    const alrededor =
      cercano === undefined
        ? `No hay ningún emplazamiento publicado a menos de ${metros(RADIO_CERCANOS_M)}.`
        : `El publicado más cercano, ${cercano.clave}, está a ${metros(cercano.metros)}.`;
    return otras.size > 0
      ? { veredicto: "aceptar", razones: [alrededor, apoyo] }
      : {
          veredicto: "mirar",
          razones: [
            alrededor,
            apoyo,
            "Un emplazamiento nuevo de una sola identidad se mira en la foto aérea.",
          ],
        };
  }
  if (publicado === null) {
    return {
      veredicto: "mirar",
      razones: [
        `${correccion.emplazamiento ?? "El emplazamiento"} no está en lo publicado: puede haberse retirado.`,
      ],
    };
  }
  switch (cambio.tipo) {
    case "posicion": {
      if (distanciaM === null) return { veredicto: "mirar", razones: [apoyo] };
      if (distanciaM <= DISTANCIA_MISMO_SITIO_M) {
        return {
          veredicto: "rechazar",
          razones: [
            `La posición propuesta está a ${metros(distanciaM)} de la publicada: dentro del margen de la fusión, no cambia nada.`,
          ],
        };
      }
      if (distanciaM > DISTANCIA_DUDOSA_M) {
        return {
          veredicto: "mirar",
          razones: [
            `La posición propuesta está a ${metros(distanciaM)} de la publicada: puede ser otro emplazamiento.`,
            apoyo,
          ],
        };
      }
      return {
        veredicto: "aceptar",
        razones: [`La posición propuesta está a ${metros(distanciaM)} de la publicada.`, apoyo],
      };
    }
    case "compania": {
      const nombre = NOMBRE_COMPANIA[cambio.compania];
      const tiene = registroTieneCompania(publicado, cambio.compania);
      if (tiene === cambio.esta) {
        return {
          veredicto: "rechazar",
          razones: [
            tiene
              ? `El registro oficial ya tiene a ${nombre} en este emplazamiento.`
              : `El registro oficial ya no tiene a ${nombre} en este emplazamiento.`,
          ],
        };
      }
      return {
        veredicto: "aceptar",
        razones: [
          tiene
            ? `El registro oficial tiene a ${nombre} aquí y la propuesta dice que no está.`
            : `El registro oficial no tiene a ${nombre} aquí y la propuesta dice que está.`,
          apoyo,
        ],
      };
    }
    case "ya-no-existe":
      return otras.size > 0
        ? { veredicto: "aceptar", razones: [apoyo] }
        : {
            veredicto: "mirar",
            razones: [
              apoyo,
              "Dar un emplazamiento por desaparecido con una sola identidad se mira en la foto aérea.",
            ],
          };
  }
};

const decidirCorroboracion = (
  contexto: AportacionConContexto,
  corroboracion: Corroboracion,
): Decision => {
  const { publicado, relacionadas, aportacion } = contexto;
  const publicada = publicado?.correcciones?.find((c) => c.clave === corroboracion.correccion);
  if (publicada === undefined) {
    return {
      veredicto: "rechazar",
      razones: [`La ficha publicada no enseña la corrección ${corroboracion.correccion}.`],
    };
  }
  const yaCuenta = relacionadas.some(
    (a) =>
      a.identidad === aportacion.identidad &&
      a.estado === "aceptada" &&
      ((a.contenido.tipo === "corroboracion" &&
        a.contenido.correccion === corroboracion.correccion) ||
        (a.contenido.tipo === "correccion-propuesta" &&
          (a.id === corroboracion.correccion ||
            mismoCambio(publicada.cambio, a.contenido.cambio)))),
  );
  return yaCuenta
    ? {
        veredicto: "rechazar",
        razones: ["Esta identidad ya cuenta entre las personas que sostienen la corrección."],
      }
    : {
        veredicto: "aceptar",
        razones: [
          `Respalda una corrección publicada que sostienen ${publicada.personas} ${publicada.personas === 1 ? "persona" : "personas"}.`,
        ],
      };
};

const decidirMedida = (contexto: AportacionConContexto): Decision => {
  const { publicado, distanciaM } = contexto;
  if (publicado === null) {
    return {
      veredicto: "mirar",
      razones: ["El emplazamiento al que dice estar unida no está en lo publicado."],
    };
  }
  return {
    veredicto: "aceptar",
    razones: [
      "El buzón ya comprobó los rangos de 3GPP y que la posición es verosímil para su sector.",
      ...(distanciaM === null ? [] : [`Está a ${metros(distanciaM)} del emplazamiento publicado.`]),
    ],
  };
};

/**
 * Un veredicto para una aportación con su contexto, con las razones que lo sostienen. Es una
 * heurística para empezar, no la decisión: la decisión es del usuario, que la confirma con la
 * orden de aceptar o rechazar y su motivo. Lo que envía una identidad o una IP vetada se propone
 * rechazar siempre, y quien tiene más rechazadas que aceptadas pasa a mirar.
 */
export const proponerVeredicto = (contexto: AportacionConContexto): VeredictoPropuesto => {
  const { aportacion, historial } = contexto;
  const { id } = aportacion;
  if (aportacion.estado !== "pendiente") {
    return {
      id,
      veredicto: "mirar",
      razones: [`Ya está ${aportacion.estado}: ${aportacion.motivo ?? "sin motivo"}.`],
    };
  }
  if (aportacion.vetada) {
    return {
      id,
      veredicto: "rechazar",
      razones: ["La envió una identidad o una IP vetada."],
    };
  }
  const { contenido } = aportacion;
  const decision =
    contenido.tipo === "correccion-propuesta"
      ? decidirCorreccion(contexto, contenido)
      : contenido.tipo === "corroboracion"
        ? decidirCorroboracion(contexto, contenido)
        : decidirMedida(contexto);
  const dudosa = historial.rechazadas >= 3 && historial.rechazadas > historial.aceptadas;
  const sobreQuien = `Quien la envía tiene ${historial.aceptadas} aceptadas y ${historial.rechazadas} rechazadas.`;
  return {
    id,
    veredicto: dudosa && decision.veredicto === "aceptar" ? "mirar" : decision.veredicto,
    razones: [...decision.razones, sobreQuien],
  };
};

/**
 * Una aportación aceptada tal como sale del buzón hacia la publicación nocturna (ADR 0020, #57): lo
 * mínimo para llevarla a la ficha. Solo las correcciones propuestas y las corroboraciones (las
 * medidas solo se publicarán como agregados), sin la nota, sin la huella de la IP y sin la
 * identidad: en su lugar, `persona`, un seudónimo que es el mismo para todo lo que envía una
 * identidad y del que no se puede volver a ella.
 */
export const AceptadaParaPublicar = Schema.Struct({
  id: Schema.String,
  /** HMAC de la identidad con la clave del buzón: cuenta a cada persona una vez. */
  persona: Schema.String,
  aceptadaEl: Schema.Finite,
  contenido: AportacionCompartible,
});
export type AceptadaParaPublicar = typeof AceptadaParaPublicar.Type;

/** Una página de lo aceptado para publicar: sigue después de `ultima` mientras no sea nula. */
export const PaginaParaPublicar = Schema.Struct({
  aportaciones: Schema.Array(AceptadaParaPublicar),
  ultima: Schema.NullOr(Schema.Finite),
});
export type PaginaParaPublicar = typeof PaginaParaPublicar.Type;

interface Grupo {
  readonly clave: string;
  readonly cambio: Cambio;
  readonly aceptadaEl: number;
  readonly personas: Set<string>;
}

/**
 * Las correcciones de cada emplazamiento tal como llegan a su ficha (`Ficha.correcciones`), a
 * partir de lo aceptado. Es una función pura, y el resultado no depende del orden de entrada:
 *
 * - Las correcciones propuestas del mismo emplazamiento que dicen lo mismo (`mismoCambio`) son una
 *   sola corrección. Su clave y su cambio son los de la primera que se aceptó.
 * - Una corroboración suma a la corrección cuya clave cita, si es del mismo emplazamiento. Si no
 *   hay ninguna con esa clave, no cuenta.
 * - `personas` cuenta cada `persona` una vez por corrección (ADR 0020).
 * - Un emplazamiento que falta no sale aquí: no tiene ficha a la que ir.
 *
 * Cada lista va por fecha de aceptación y luego por clave.
 */
export const correccionesDeFicha = (
  aceptadas: ReadonlyArray<AceptadaParaPublicar>,
): ReadonlyMap<string, ReadonlyArray<CorreccionDeFicha>> => {
  const ordenadas = aceptadas.toSorted(
    (a, b) => a.aceptadaEl - b.aceptadaEl || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const porEmplazamiento = new Map<string, Array<Grupo>>();
  for (const { id, persona, aceptadaEl, contenido } of ordenadas) {
    if (contenido.tipo !== "correccion-propuesta" || contenido.emplazamiento === null) continue;
    const grupos = porEmplazamiento.get(contenido.emplazamiento) ?? [];
    const grupo = grupos.find((g) => mismoCambio(g.cambio, contenido.cambio));
    if (grupo === undefined) {
      grupos.push({
        clave: id,
        cambio: contenido.cambio,
        aceptadaEl,
        personas: new Set([persona]),
      });
    } else {
      grupo.personas.add(persona);
    }
    porEmplazamiento.set(contenido.emplazamiento, grupos);
  }
  for (const { persona, contenido } of ordenadas) {
    if (contenido.tipo !== "corroboracion") continue;
    const grupo = porEmplazamiento
      .get(contenido.emplazamiento)
      ?.find((g) => g.clave === contenido.correccion);
    grupo?.personas.add(persona);
  }
  return new Map(
    [...porEmplazamiento].map(([emplazamiento, grupos]) => [
      emplazamiento,
      grupos.map((g): CorreccionDeFicha => ({
        clave: g.clave,
        cambio: g.cambio,
        personas: g.personas.size,
        aceptadaEl: g.aceptadaEl,
        licencia: "CC0-1.0",
      })),
    ]),
  );
};
