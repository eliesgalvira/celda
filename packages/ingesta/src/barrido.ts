import { compararTexto } from "@celda/dominio/banda";
import {
  Caja,
  cajaDeCuadro,
  Cuadro,
  cubrenElCuadro,
  dividir,
  divisiones,
  type ZonaDeBarrido,
  zonaDeBarrido,
  ZONAS_DE_BARRIDO,
} from "@celda/dominio/barrido";
import type { Fuente } from "@celda/dominio/observacion";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Cuentas } from "./ejecucion.ts";
import {
  describirError,
  type ErrorDeExtractor,
  ExtractorPorCajas,
  type Registro,
} from "./extractor.ts";
import { type BaseDeIngesta, type Cierre, leerFichas, type OpcionesProceso } from "./proceso.ts";

/**
 * Veces que se puede dividir un cuadro. Tras 8 divisiones una caja mide 1/256° de lado, unos
 * 330 × 430 m en la Península. Las más densas del muestreo de España salieron en la quinta.
 */
export const DIVISIONES_MAXIMAS = 8;

/** Un cuadro con una caja que sigue llegando al tope tras `DIVISIONES_MAXIMAS` divisiones. */
export class CuadroSinDividir extends Schema.TaggedError<CuadroSinDividir>()("CuadroSinDividir", {
  cuadro: Cuadro,
  caja: Caja,
}) {
  override get message() {
    return `el cuadro ${this.cuadro} tiene una caja (${this.caja.join(", ")}) que llega al tope tras ${DIVISIONES_MAXIMAS} divisiones`;
  }
}

/**
 * Un cuadro que vuelve vacío cuando la base tiene estaciones vigentes en él. Es un fallo de la
 * fuente y no un listado sin estaciones: guardarlo contaría todas como ausentes y dos barridos
 * así las retirarían.
 */
export class CuadroVacio extends Schema.TaggedError<CuadroVacio>()("CuadroVacio", {
  cuadro: Cuadro,
  vigentes: Schema.Int,
}) {
  override get message() {
    return `el listado del cuadro ${this.cuadro} ha vuelto vacío y la base tiene ${this.vigentes} estaciones vigentes en él`;
  }
}

export type FalloDeZona = ErrorDeExtractor | CuadroSinDividir | CuadroVacio;

const describirFallo = (fallo: FalloDeZona): string =>
  fallo._tag === "CuadroSinDividir" || fallo._tag === "CuadroVacio"
    ? `${fallo._tag}: ${fallo.message}`
    : describirError(fallo);

/**
 * Fallos tras los que no tiene sentido pedir nada más a la fuente esta noche: el tope de
 * peticiones, `robots.txt` o una fuente que no responde ni tras los reintentos.
 */
const PARAN_LA_NOCHE: ReadonlySet<FalloDeZona["_tag"]> = new Set([
  "LimiteDePeticiones",
  "ProhibidoPorRobots",
  "FuenteNoDisponible",
]);

/** Lo que da el listado de un cuadro recorrido entero. */
export interface CuadroRecorrido {
  /** Sin repetir y ordenados por clave. */
  readonly registros: ReadonlyArray<Registro>;
  readonly avisos: ReadonlyArray<string>;
  /** Las cajas pedidas que no llegaron al tope, para pedirlas directamente la próxima vez. */
  readonly cajas: ReadonlyArray<Caja>;
  readonly bytes: number;
}

/**
 * Recorre el listado de un cuadro. Empieza por las cajas guardadas del barrido anterior, o por el
 * cuadro entero si no las hay o no lo cubren. Una caja que llega al tope nunca se guarda ni se usa:
 * se divide en cuatro y se piden sus cuartos, hasta `DIVISIONES_MAXIMAS`. Pasado ese límite el
 * cuadro falla, porque le faltarían registros sin que nadie lo supiera.
 */
export const recorrerCuadro = Effect.fn("Barrido.recorrerCuadro")(function* (
  cuadro: Cuadro,
  guardadas: ReadonlyArray<Caja>,
) {
  const extractor = yield* ExtractorPorCajas;
  const registros = new Map<string, Registro>();
  const avisos: Array<string> = [];
  const cajas: Array<Caja> = [];
  let bytes = 0;
  const porPedir: Array<Caja> = cubrenElCuadro(cuadro, guardadas)
    ? [...guardadas]
    : [cajaDeCuadro(cuadro)];
  for (let caja = porPedir.shift(); caja !== undefined; caja = porPedir.shift()) {
    const listado = yield* extractor.caja(caja);
    bytes += listado.bytes;
    if (listado.enElTope) {
      if (divisiones(caja) >= DIVISIONES_MAXIMAS) {
        return yield* new CuadroSinDividir({ cuadro, caja });
      }
      porPedir.unshift(...dividir(caja));
      continue;
    }
    cajas.push(caja);
    avisos.push(...listado.avisos);
    for (const registro of listado.registros) {
      if (!registros.has(registro.clave)) registros.set(registro.clave, registro);
    }
  }
  const recorrido: CuadroRecorrido = {
    registros: [...registros.values()].sort((a, b) => compararTexto(a.clave, b.clave)),
    avisos,
    cajas,
    bytes,
  };
  return recorrido;
});

/** Cómo le fue a una zona de barrido en una ejecución. */
export const ZonaEnLaEjecucion = Schema.Struct({
  zona: Schema.String,
  /**
   * `completado` si su barrido se cerró y contó ausencias, `fallido` si no, y `pendiente` si no
   * se llegó a empezar porque la fuente dejó de responder en otra zona.
   */
  estado: Schema.Literals(["completado", "fallido", "pendiente"]),
  /** Cuadros recorridos en esta ejecución; los de antes de un corte no cuentan. */
  cuadros: Schema.Int,
  peticiones: Schema.Int,
  bytes: Schema.Int,
  /** Registros distintos en los cuadros recorridos. */
  registros: Schema.Int,
  observaciones: Cuentas,
  error: Schema.optionalKey(Schema.String),
});
export type ZonaEnLaEjecucion = typeof ZonaEnLaEjecucion.Type;

/** Un barrido de una zona, tal como lo abre la base: nuevo o el que quedó a medias. */
export interface BarridoAbierto {
  readonly barrido: string;
  /** Cuándo empezó: en un barrido retomado, en una ejecución anterior. */
  readonly inicio: number;
  /** Los cuadros de la zona cuando empezó. */
  readonly cuadros: ReadonlyArray<Cuadro>;
  /** Los que ya se recorrieron antes de un corte. */
  readonly hechos: ReadonlySet<Cuadro>;
  /** Las cajas guardadas de cada cuadro. */
  readonly cajas: ReadonlyMap<Cuadro, ReadonlyArray<Caja>>;
}

/** Lo que sabe la base de los barridos de una zona. */
export interface EstadoDeZona {
  /** Cuándo empezó su último barrido completado, o `null` si nunca se ha completado ninguno. */
  readonly completado: number | null;
  /** Si tiene un barrido a medias, cortado antes de acabar. */
  readonly aMedias: boolean;
}

type Base = typeof BaseDeIngesta.Service;

/**
 * Donde guarda su estado el barrido por zonas: lo mismo que `BaseDeIngesta` para las fichas y la
 * fusión, y además los barridos de cada zona, los cuadros hechos de cada uno y las cajas de cada
 * cuadro. La implementa la base SQLite de la ingesta nocturna.
 */
export class BaseDeBarrido extends Context.Service<
  BaseDeBarrido,
  {
    readonly iniciar: Base["iniciar"];
    readonly estadoDeZonas: (fuente: Fuente) => Effect.Effect<ReadonlyMap<string, EstadoDeZona>>;
    /**
     * Abre un barrido de `zona` para la ejecución. Si la zona tiene uno a medias de la misma
     * fuente, lo retoma; si no, empieza uno con fecha `fecha`.
     */
    readonly abrirBarrido: (
      ejecucion: string,
      fuente: Fuente,
      zona: ZonaDeBarrido,
      fecha: number,
    ) => Effect.Effect<BarridoAbierto>;
    /** Observaciones vigentes de la fuente en el cuadro. */
    readonly vigentesEn: (fuente: Fuente, cuadro: Cuadro) => Effect.Effect<number>;
    /**
     * En una transacción: guarda los registros del cuadro (`trasListado`) y los da por vistos,
     * guarda sus cajas y apunta el cuadro como hecho en el barrido.
     */
    readonly aplicarCuadro: (
      barrido: string,
      cuadro: Cuadro,
      fecha: number,
      recorrido: CuadroRecorrido,
    ) => Effect.Effect<{ readonly creados: number; readonly cambiados: number }>;
    /**
     * Cierra un barrido: cuenta una ausencia (`trasAusencia`, con fecha `fecha`) a las
     * observaciones vigentes de sus cuadros que no se han visto desde que empezó.
     */
    readonly cerrarBarrido: (
      barrido: string,
      fecha: number,
      fin: number,
    ) => Effect.Effect<{ readonly retirados: number }>;
    /** Da un barrido por fallido: no cuenta ausencias y la próxima vez empieza otro. */
    readonly fallarBarrido: (barrido: string, fin: number, motivo: string) => Effect.Effect<void>;
    readonly pendientesDeFicha: Base["pendientesDeFicha"];
    readonly aplicarFicha: Base["aplicarFicha"];
    readonly fusionar: Base["fusionar"];
    readonly completar: (
      ejecucion: string,
      cierre: Cierre & {
        readonly registros: number;
        readonly zonas: ReadonlyArray<ZonaEnLaEjecucion>;
      },
    ) => Effect.Effect<void>;
    readonly fallar: (
      ejecucion: string,
      cierre: Cierre & { readonly zonas: ReadonlyArray<ZonaEnLaEjecucion> },
    ) => Effect.Effect<void>;
  }
>()("@celda/ingesta/barrido/BaseDeBarrido") {}

/** Qué zonas de barrido se barren cada noche. */
export interface OpcionesZonas {
  /** Las que se barren todas las noches. */
  readonly cadaNoche: ReadonlyArray<ZonaDeBarrido>;
  /** Las que se turnan: cada noche, `porNoche` de ellas, las que llevan más tiempo sin barrer. */
  readonly enTurno: ReadonlyArray<ZonaDeBarrido>;
  readonly porNoche: number;
}

/** Por defecto, Cataluña entera cada noche (ADR 0014). */
export const OPCIONES_ZONAS: OpcionesZonas = {
  cadaNoche: ZONAS_DE_BARRIDO.filter((zona) => zona.nombre === "cataluna"),
  enTurno: [],
  porNoche: 1,
};

/**
 * Las zonas de una noche: las de cada noche y, de las que se turnan, primero la que quedó a
 * medias, luego las que nunca se han completado y luego las que llevan más tiempo sin
 * completarse, en el orden de la configuración si empatan.
 */
export const zonasDeLaNoche = (
  opciones: OpcionesZonas,
  estado: ReadonlyMap<string, EstadoDeZona>,
): ReadonlyArray<ZonaDeBarrido> => {
  const fijas = new Set(opciones.cadaNoche.map((zona) => zona.nombre));
  const turno = opciones.enTurno
    .filter((zona) => !fijas.has(zona.nombre))
    .map((zona, orden) => ({ zona, orden, estado: estado.get(zona.nombre) }))
    .sort(
      (a, b) =>
        Number(b.estado?.aMedias ?? false) - Number(a.estado?.aMedias ?? false) ||
        (a.estado?.completado ?? -Infinity) - (b.estado?.completado ?? -Infinity) ||
        a.orden - b.orden,
    );
  return [
    ...opciones.cadaNoche,
    ...turno.slice(0, Math.max(opciones.porNoche, 0)).map(({ zona }) => zona),
  ];
};

/** Lo que se escribe para no poner ninguna zona: una variable vacía cuenta como no puesta. */
const NINGUNA = "ninguna";

const nombres = (lista: string): ReadonlyArray<string> =>
  lista
    .split(",")
    .map((nombre) => nombre.trim())
    .filter((nombre) => nombre !== "" && nombre !== NINGUNA);

const ListaDeZonas = Schema.String.check(
  Schema.makeFilter((lista: string) => {
    const desconocidas = nombres(lista).filter((nombre) => zonaDeBarrido(nombre) === undefined);
    return (
      desconocidas.length === 0 ||
      `zonas de barrido desconocidas: ${desconocidas.join(", ")}. ` +
        `Las que hay: ${ZONAS_DE_BARRIDO.map((zona) => zona.nombre).join(", ")}`
    );
  }),
);

const zonasDeLista = (variable: string, porDefecto: string) =>
  Config.schema(ListaDeZonas, variable).pipe(
    Config.withDefault(porDefecto),
    Config.map((lista) => nombres(lista).flatMap((nombre) => zonaDeBarrido(nombre) ?? [])),
  );

/**
 * Las zonas desde variables de entorno, por su nombre y separadas por comas, o `ninguna`:
 *
 * - `CELDA_REGISTRO_ZONAS`: las de cada noche (`cataluna`).
 * - `CELDA_REGISTRO_ZONAS_EN_TURNO`: las que se turnan (ninguna).
 * - `CELDA_REGISTRO_ZONAS_POR_NOCHE`: cuántas de las que se turnan se barren cada noche (1).
 *
 * Un nombre que no está en `ZONAS_DE_BARRIDO` es un error de configuración.
 */
export const opcionesZonasDesdeConfig: Config.Config<OpcionesZonas> = Config.all({
  cadaNoche: zonasDeLista("CELDA_REGISTRO_ZONAS", "cataluna"),
  enTurno: zonasDeLista("CELDA_REGISTRO_ZONAS_EN_TURNO", NINGUNA),
  porNoche: Config.Int("CELDA_REGISTRO_ZONAS_POR_NOCHE").pipe(
    Config.withDefault(OPCIONES_ZONAS.porNoche),
  ),
});

/** Lo que hace una ejecución del barrido por zonas, aparte del extractor. */
export interface OpcionesBarrido extends OpcionesProceso {
  readonly zonas: OpcionesZonas;
}

/** Cómo ha acabado una ejecución del barrido por zonas. */
export interface Barrida {
  readonly ejecucion: string;
  readonly estado: "omitida" | "fallida" | "completada";
  readonly zonas: ReadonlyArray<ZonaEnLaEjecucion>;
}

/**
 * Recorre un cuadro y comprueba que no ha vuelto vacío cuando la base tiene estaciones en él.
 */
const recorrerYComprobar = Effect.fn("Barrido.cuadro")(function* (
  fuente: Fuente,
  cuadro: Cuadro,
  guardadas: ReadonlyArray<Caja>,
) {
  const base = yield* BaseDeBarrido;
  const recorrido = yield* recorrerCuadro(cuadro, guardadas);
  if (recorrido.registros.length === 0) {
    const vigentes = yield* base.vigentesEn(fuente, cuadro);
    if (vigentes > 0) {
      return yield* new CuadroVacio({ cuadro, vigentes });
    }
  }
  return recorrido;
});

/** Lo que deja barrer una zona, antes de cerrar su barrido. */
interface ZonaRecorrida {
  readonly hecha: ZonaEnLaEjecucion;
  readonly barrido: string;
  readonly fallo: FalloDeZona | undefined;
  /** Claves de los registros de sus cuadros. */
  readonly vistos: ReadonlyArray<string>;
  readonly avisos: ReadonlyArray<string>;
}

/**
 * Abre el barrido de una zona, o retoma el que quedó a medias, y recorre sus cuadros que faltan.
 * Cada cuadro se guarda en su propia transacción. Para en el primer cuadro que falla.
 */
const barrerZona = Effect.fn("Barrido.zona")(function* (
  ejecucion: string,
  zona: ZonaDeBarrido,
  fecha: number,
) {
  const extractor = yield* ExtractorPorCajas;
  const base = yield* BaseDeBarrido;
  const abierto = yield* base.abrirBarrido(ejecucion, extractor.fuente, zona, fecha);
  const peticionesAntes = yield* extractor.peticiones;
  const vistos = new Set<string>();
  const avisos: Array<string> = [];
  const cuenta = { cuadros: 0, bytes: 0, creados: 0, cambiados: 0 };
  let fallo: FalloDeZona | undefined;
  for (const cuadro of abierto.cuadros.filter((c) => !abierto.hechos.has(c))) {
    const recorrido = yield* Effect.result(
      recorrerYComprobar(extractor.fuente, cuadro, abierto.cajas.get(cuadro) ?? []),
    );
    if (Result.isFailure(recorrido)) {
      fallo = recorrido.failure;
      break;
    }
    const escritos = yield* base.aplicarCuadro(abierto.barrido, cuadro, fecha, recorrido.success);
    cuenta.cuadros++;
    cuenta.bytes += recorrido.success.bytes;
    cuenta.creados += escritos.creados;
    cuenta.cambiados += escritos.cambiados;
    avisos.push(...recorrido.success.avisos);
    for (const registro of recorrido.success.registros) vistos.add(registro.clave);
  }
  const hecha: ZonaEnLaEjecucion = {
    zona: zona.nombre,
    estado: fallo === undefined ? "completado" : "fallido",
    cuadros: cuenta.cuadros,
    peticiones: (yield* extractor.peticiones) - peticionesAntes,
    bytes: cuenta.bytes,
    registros: vistos.size,
    observaciones: { creados: cuenta.creados, cambiados: cuenta.cambiados, retirados: 0 },
  };
  const recorrida: ZonaRecorrida = {
    hecha: fallo === undefined ? hecha : { ...hecha, error: describirFallo(fallo) },
    barrido: abierto.barrido,
    fallo,
    vistos: [...vistos],
    avisos,
  };
  return recorrida;
});

/** Una zona que no se llega a empezar porque la fuente ha dejado de responder en otra. */
const pendiente = (zona: ZonaDeBarrido, motivo: string): ZonaEnLaEjecucion => ({
  zona: zona.nombre,
  estado: "pendiente",
  cuadros: 0,
  peticiones: 0,
  bytes: 0,
  registros: 0,
  observaciones: { creados: 0, cambiados: 0, retirados: 0 },
  error: motivo,
});

/**
 * Barre las zonas en orden. Los barridos que acaban bien se cierran al final, cuando ya se han
 * visto todas las zonas: una estación que se ha movido a un cuadro de otra zona barrida esa
 * noche ya está vista allí. Devuelve lo que ha hecho cada zona, las claves vistas, los errores y
 * el motivo por el que la fuente dejó de responder, si lo hizo.
 */
const barrerZonas = Effect.fn("Barrido.zonas")(function* (
  ejecucion: string,
  zonas: ReadonlyArray<ZonaDeBarrido>,
  fecha: number,
) {
  const base = yield* BaseDeBarrido;
  const hechas: Array<ZonaEnLaEjecucion> = [];
  const porCerrar: Array<{ readonly indice: number; readonly barrido: string }> = [];
  const vistos = new Set<string>();
  const errores: Array<string> = [];
  let parada: string | undefined;
  for (const zona of zonas) {
    if (parada !== undefined) {
      hechas.push(pendiente(zona, parada));
      continue;
    }
    const recorrida = yield* barrerZona(ejecucion, zona, fecha);
    hechas.push(recorrida.hecha);
    errores.push(...recorrida.avisos);
    for (const clave of recorrida.vistos) vistos.add(clave);
    if (recorrida.fallo === undefined) {
      porCerrar.push({ indice: hechas.length - 1, barrido: recorrida.barrido });
      continue;
    }
    const motivo = describirFallo(recorrida.fallo);
    errores.push(`Zona ${zona.nombre}: ${motivo}`);
    yield* base.fallarBarrido(recorrida.barrido, yield* Clock.currentTimeMillis, motivo);
    if (PARAN_LA_NOCHE.has(recorrida.fallo._tag)) parada = motivo;
  }
  for (const { indice, barrido } of porCerrar) {
    const { retirados } = yield* base.cerrarBarrido(barrido, fecha, yield* Clock.currentTimeMillis);
    const hecha = hechas[indice];
    if (hecha !== undefined) {
      hechas[indice] = { ...hecha, observaciones: { ...hecha.observaciones, retirados } };
    }
  }
  return { hechas, vistos: vistos.size, errores, parada };
});

/**
 * Una ejecución de la fuente del `ExtractorPorCajas` que barre por zonas (ADR 0014), sobre la
 * `BaseDeBarrido`:
 *
 * 1. Abre la ejecución. Si el interruptor está apagado queda omitida y no pide nada.
 * 2. Elige las zonas de la noche (`zonasDeLaNoche`).
 * 3. En cada zona abre su barrido, o retoma el que quedó a medias, y recorre sus cuadros uno a
 *    uno (`recorrerCuadro`). Cada cuadro se guarda en su propia transacción con sus registros,
 *    sus cajas y la marca de hecho, así que un corte no repite los cuadros ya guardados. Si un
 *    cuadro falla, o vuelve vacío cuando tenía estaciones, el barrido de la zona falla y no
 *    cuenta ausencias; las demás zonas siguen. El tope de peticiones, `robots.txt` o una fuente
 *    caída paran todas las zonas que quedan y las fichas.
 * 4. Cierra los barridos que han acabado bien (`barrerZonas`).
 * 5. Lee las fichas pendientes, fusiona y apunta los cambios, los errores y lo que ha hecho cada
 *    zona: peticiones, bytes, registros y cambios.
 *
 * Queda completada si alguna zona se ha barrido, y fallida si ninguna.
 */
export const ejecutarBarrido = Effect.fn("Ingesta.barrido")(function* (opciones: OpcionesBarrido) {
  const extractor = yield* ExtractorPorCajas;
  const base = yield* BaseDeBarrido;
  const { fuente } = extractor;
  const inicio = yield* Clock.currentTimeMillis;

  const arranque = yield* base.iniciar(fuente, inicio);
  const { ejecucion } = arranque;
  if (arranque.tipo === "omitida") {
    const omitida: Barrida = { ejecucion, estado: "omitida", zonas: [] };
    return omitida;
  }

  const zonas = zonasDeLaNoche(opciones.zonas, yield* base.estadoDeZonas(fuente));
  const { hechas, vistos, errores, parada } = yield* barrerZonas(ejecucion, zonas, inicio);

  const fichas = { leidas: 0, cambiadas: 0 };
  if (parada === undefined) {
    const leidas = yield* leerFichas({
      pendientes: yield* base.pendientesDeFicha(
        fuente,
        inicio - Duration.toMillis(opciones.rotacion),
        opciones.maxFichas,
      ),
      ficha: extractor.ficha,
      aplicar: (clave, bandas) => base.aplicarFicha(fuente, clave, inicio, bandas),
      fallosSeguidos: opciones.fallosSeguidos,
    });
    fichas.leidas = leidas.leidas;
    fichas.cambiadas = leidas.cambiadas;
    errores.push(...leidas.errores);
  } else {
    errores.push("Fichas pendientes para la próxima ejecución");
  }

  const emplazamientos = yield* base.fusionar(inicio);
  const sumar = (campo: keyof Cuentas) =>
    hechas.reduce((suma, zona) => suma + zona.observaciones[campo], 0);
  const cierre = {
    fin: yield* Clock.currentTimeMillis,
    cambios: {
      observaciones: {
        creados: sumar("creados"),
        cambiados: sumar("cambiados"),
        retirados: sumar("retirados"),
      },
      fichas,
      emplazamientos,
    },
    errores,
    zonas: hechas,
  };
  const barrida = zonas.length === 0 || hechas.some((zona) => zona.estado === "completado");
  if (barrida) {
    yield* base.completar(ejecucion, { ...cierre, registros: vistos });
  } else {
    yield* base.fallar(ejecucion, cierre);
  }
  const hecha: Barrida = { ejecucion, estado: barrida ? "completada" : "fallida", zonas: hechas };
  return hecha;
});
