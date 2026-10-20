import type { ZonaDeBarrido } from "@celda/dominio/barrido";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import type { OpcionesCliente } from "./cliente.ts";
import {
  describirError,
  type ErrorDeExtractor,
  type FichaLeida,
  type Registro,
} from "./extractor.ts";

/**
 * Las fichas del registro oficial en cada ejecución de ingesta (ADR 0014 y 0029): una cada
 * `ritmo`, dentro de una ventana desde que empieza la ejecución, primero las nuevas y las de
 * listado cambiado y luego las demás, de la leída hace más tiempo a la más reciente, en toda
 * España. La cola vive en la base: cada observación guarda cuándo se leyó su ficha y, si falló,
 * cuántas veces y hasta cuándo espera. Una ejecución cortada no pierde nada, y la siguiente sigue
 * por donde iba porque el orden sale siempre igual de la base.
 */

/**
 * Nunca se piden fichas más deprisa que esto: una cada segundo, y siempre de una en una (ADR
 * 0014). Bajó de 3 s a 1 s a petición del usuario el 01/10/2026.
 */
export const RITMO_MINIMO = Duration.seconds(1);

/**
 * El ritmo si la configuración no dice otro: una ficha por segundo, el de producción desde el
 * 07/10/2026. A él caben todas las fichas de España en una ejecución (ADR 0029).
 */
export const RITMO_POR_DEFECTO = Duration.seconds(1);

/**
 * Fichas seguidas con el aviso «Código de emplazamiento no válido» tras las que se dejan las
 * fichas para la ejecución siguiente. Una sola es lo que dice el registro de esa estación base y
 * no cuenta como fallo, pero el 02/10/2026 eran 2 de unas 69.600: veinte seguidas querrían decir
 * que ha cambiado la URL de la ficha o el formato de los códigos, no que todas sean de verdad.
 */
export const SIN_FICHA_SEGUIDAS = 20;

/** Cómo se leen las fichas en una ejecución. */
export interface OpcionesFichas {
  /**
   * Pausa entre el final de una ficha y la petición de la siguiente. Nunca baja de
   * `RITMO_MINIMO`.
   */
  readonly ritmo: Duration.Duration;
  /**
   * Cuánto tiempo se leen fichas, desde que empieza la ejecución. Al cerrarse, las que quedan
   * esperan a la ejecución siguiente.
   */
  readonly ventana: Duration.Duration;
  /** Tope de fichas por ejecución; sin él, se leen hasta cerrar la ventana. */
  readonly maximo: number | undefined;
  /** Fallos seguidos tras los que se dejan las fichas para la ejecución siguiente. */
  readonly fallosSeguidos: number;
}

/**
 * Por defecto (ADR 0029): una por segundo durante 22 horas, unas 72.000 a 1,1 s por ficha. Con
 * la ejecución a las 00:30, la ventana cierra a las 22:30, y lo que queda de día da para publicar,
 * repetir una publicación fallida y copiar la base.
 */
export const OPCIONES_FICHAS: OpcionesFichas = {
  ritmo: RITMO_POR_DEFECTO,
  ventana: Duration.hours(22),
  maximo: undefined,
  fallosSeguidos: 3,
};

/**
 * Las opciones desde variables de entorno:
 *
 * - `CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS`: segundos entre fichas (1, y nunca menos de 1).
 * - `CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS`: minutos de fichas desde que empieza la ejecución
 *   (1320, 22 horas).
 * - `CELDA_INGESTA_MAX_FICHAS`: tope de fichas por ejecución (sin tope; con 0 no se lee ninguna).
 */
export const opcionesFichasDesdeConfig: Config.Config<OpcionesFichas> = Config.all({
  ritmo: Config.Int("CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS").pipe(
    Config.withDefault(Duration.toSeconds(OPCIONES_FICHAS.ritmo)),
  ),
  ventana: Config.Int("CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS").pipe(
    Config.withDefault(Duration.toMinutes(OPCIONES_FICHAS.ventana)),
  ),
  maximo: Config.option(Config.Int("CELDA_INGESTA_MAX_FICHAS")),
}).pipe(
  Config.map((c): OpcionesFichas => ({
    ...OPCIONES_FICHAS,
    ritmo: Duration.max(Duration.seconds(c.ritmo), RITMO_MINIMO),
    ventana: Duration.minutes(Math.max(c.ventana, 0)),
    maximo: Option.getOrUndefined(Option.map(c.maximo, (n) => Math.max(n, 0))),
  })),
);

/**
 * Las opciones del cliente de las fichas a partir de las del listado: su pausa es el ritmo, y su
 * tope, las peticiones que caben en la ventana a ese ritmo, así que nunca corta antes que ella.
 */
export const opcionesClienteDeFichas = (
  cliente: OpcionesCliente,
  fichas: OpcionesFichas,
): OpcionesCliente => {
  const pausa = Duration.max(fichas.ritmo, RITMO_MINIMO);
  return {
    ...cliente,
    pausa,
    maxPeticiones: Math.ceil(Duration.toMillis(fichas.ventana) / Duration.toMillis(pausa)),
  };
};

/** Una ficha que toca leer, tal como la guarda la base. */
export interface FichaEnCola {
  readonly registro: Registro;
  /** Orden en que llegó a la base: las nuevas se leen en ese orden. */
  readonly orden: number;
  /** El cuadro en que cae la observación, que da su zona de barrido. */
  readonly cuadro: string;
  /** Cuándo se leyó por última vez, o `null` si es nueva o cambió en el listado. */
  readonly leidaEn: number | null;
  /** Fallos seguidos de esta ficha. */
  readonly fallos: number;
  /** Hasta cuándo espera tras su último fallo, o `null`. */
  readonly esperaHasta: number | null;
}

/** Si una ficha está esperando tras un fallo. */
const esperando = (ficha: FichaEnCola, ahora: number): boolean =>
  ficha.esperaHasta !== null && ficha.esperaHasta > ahora;

/**
 * El orden en que se leen las fichas, el mismo en toda España, sin mirar la zona ni la provincia
 * (ADR 0029). Primero las nuevas y las de listado cambiado, en el orden en que llegaron, y luego
 * las demás, de la leída hace más tiempo a la más reciente. Así, si la ventana no da para todas,
 * lo que queda para la ejecución siguiente es lo que se leyó hace menos. Las que esperan tras un
 * fallo se quedan fuera hasta que pase su espera. Cada ficha sale una vez, aunque la cola la
 * traiga repetida.
 */
export const ordenarFichas = (
  cola: ReadonlyArray<FichaEnCola>,
  ahora: number,
): ReadonlyArray<FichaEnCola> => {
  const vistas = new Set<string>();
  return cola
    .filter((ficha) => !esperando(ficha, ahora))
    .toSorted(
      (a, b) =>
        Number(a.leidaEn !== null) - Number(b.leidaEn !== null) ||
        (a.leidaEn ?? 0) - (b.leidaEn ?? 0) ||
        a.orden - b.orden,
    )
    .filter((ficha) => {
      if (vistas.has(ficha.registro.clave)) return false;
      vistas.add(ficha.registro.clave);
      return true;
    });
};

/** Cuántas fichas quedan por leer en una parte de la cola. */
export interface Pendientes {
  /** Nuevas o con el listado cambiado: nunca se han leído así. */
  readonly nuevas: number;
  /** Leídas antes de esta ronda, o con una versión de la lectura anterior. */
  readonly porReleer: number;
  /** Esperando tras un fallo. */
  readonly enEspera: number;
}

const contar =
  (cuenta: { nuevas: number; porReleer: number; enEspera: number }) =>
  (ficha: FichaEnCola, ahora: number) => {
    if (esperando(ficha, ahora)) cuenta.enEspera++;
    else if (ficha.leidaEn === null) cuenta.nuevas++;
    else cuenta.porReleer++;
  };

/** Cuántas fichas quedan en la cola: sin leer, por releer y esperando tras fallar. */
export const resumirCola = (cola: ReadonlyArray<FichaEnCola>, ahora: number): Pendientes => {
  const cuenta = { nuevas: 0, porReleer: 0, enEspera: 0 };
  for (const ficha of cola) contar(cuenta)(ficha, ahora);
  return cuenta;
};

/**
 * Cuántas fichas le quedan a cada zona de barrido: todas las de las observaciones de sus
 * cuadros. Una zona repetida sale una vez.
 */
export const pendientesPorZona = (
  cola: ReadonlyArray<FichaEnCola>,
  zonas: ReadonlyArray<ZonaDeBarrido>,
  ahora: number,
): ReadonlyMap<string, Pendientes> => {
  const cuentas = new Map<string, { nuevas: number; porReleer: number; enEspera: number }>();
  const deCuadro = new Map<string, { nuevas: number; porReleer: number; enEspera: number }>();
  for (const zona of zonas) {
    if (cuentas.has(zona.nombre)) continue;
    const cuenta = { nuevas: 0, porReleer: 0, enEspera: 0 };
    cuentas.set(zona.nombre, cuenta);
    for (const cuadro of zona.cuadros) {
      if (!deCuadro.has(cuadro)) deCuadro.set(cuadro, cuenta);
    }
  }
  for (const ficha of cola) {
    const cuenta = deCuadro.get(ficha.cuadro);
    if (cuenta !== undefined) contar(cuenta)(ficha, ahora);
  }
  return cuentas;
};

/**
 * Lo que se hace al pasar la mitad de la ventana si se ha leído alguna ficha: fusionar y
 * publicar, para que lo leído llegue al mapa aunque la ejecución se corte después o la
 * publicación del final no llegue a R2. Por defecto, nada.
 */
export const PublicacionAMitad = Context.Reference<{ readonly publicar: Effect.Effect<void> }>(
  "@celda/ingesta/fichas/PublicacionAMitad",
  { defaultValue: () => ({ publicar: Effect.void }) },
);

/** Fallos tras los que no se pide ninguna ficha más en esta ejecución, sin insistir. */
const PARAN_LAS_FICHAS: ReadonlySet<ErrorDeExtractor["_tag"]> = new Set([
  "FuenteBloqueada",
  "FuentePideEsperar",
  "LimiteDePeticiones",
  "ProhibidoPorRobots",
]);

/** Lo que se apunta de una ficha que ha fallado. */
export interface FalloDeFicha {
  readonly fallos: number;
  readonly esperaHasta: number;
  readonly motivo: string;
  /**
   * Si el registro dice que no tiene ficha de la estación base («Código de emplazamiento no
   * válido»), la fecha de la comprobación: la de inicio de la ejecución, como el resto de sus
   * datos.
   */
  readonly sinFichaEnRegistro: number | undefined;
}

/** Una ficha que ha fallado en esta ejecución, para el diario y su resumen. */
export interface FichaFallida {
  readonly clave: string;
  readonly url: string;
  readonly motivo: string;
  /** Fallos seguidos de la ficha, contando este. */
  readonly intento: number;
  /** Hasta cuándo espera antes de volver a pedirse, o `undefined` si no espera. */
  readonly esperaHasta: number | undefined;
}

/** Lo que necesita `leerFichasEnLaVentana`. */
export interface LecturaEnLaVentana {
  /** Las fichas en el orden en que se leen (`ordenarFichas`). */
  readonly cola: ReadonlyArray<FichaEnCola>;
  readonly opciones: OpcionesFichas;
  /** Cuándo empezó la ejecución: la ventana cuenta desde ahí. */
  readonly inicio: number;
  /**
   * Lo que espera una ficha ilegible, o que el registro no tiene, antes de volver a pedirse: lo
   * que dura una ronda, para que la ejecución del domingo no la repita y la del mes siguiente sí.
   */
  readonly espera: Duration.Duration;
  readonly ficha: (registro: Registro) => Effect.Effect<FichaLeida, ErrorDeExtractor>;
  /** Guarda lo leído de una ficha y borra sus fallos; `true` si ha cambiado. */
  readonly aplicar: (clave: string, leida: FichaLeida) => Effect.Effect<boolean>;
  /**
   * Apunta el fallo de una ficha y hasta cuándo espera, y si es porque el registro no la tiene,
   * la marca como sin ficha en el registro.
   */
  readonly fallar: (clave: string, fallo: FalloDeFicha) => Effect.Effect<void>;
  /** Se lanza una vez, tras la primera ficha leída pasada la mitad de la ventana. */
  readonly aMitad: Effect.Effect<void>;
}

/** Lo que han dado las fichas de una ejecución. */
export interface FichasDeLaEjecucion {
  readonly leidas: number;
  readonly cambiadas: number;
  /** Las que han fallado, en el orden en que se pidieron. */
  readonly fallidas: ReadonlyArray<FichaFallida>;
  /** Las de la cola que no se han llegado a pedir. */
  readonly pendientes: number;
  readonly errores: ReadonlyArray<string>;
  /** Por qué se dejó de leer antes de acabar la cola, si se dejó. */
  readonly parada: string | undefined;
}

/** Hora de una fecha en UTC, `02:15:00 UTC`. */
const hora = (milisegundos: number): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).slice(11, 19)} UTC`;

/** Una fecha en UTC, al segundo: `2026-10-04 02:15:00 UTC`. */
const fechaUtc = (milisegundos: number): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).slice(0, 19).replace("T", " ")} UTC`;

/** El motivo de un fallo sin la URL, que ya va aparte. */
const motivoDe = (fallo: ErrorDeExtractor): string =>
  "motivo" in fallo ? `${fallo._tag}: ${fallo.motivo}` : describirError(fallo);

/**
 * La línea del diario de una ficha que ha fallado: su clave, su URL, el motivo, el intento y
 * cuándo se vuelve a pedir.
 */
const describirFichaFallida = (f: FichaFallida): string =>
  `Ficha fallida, intento ${f.intento}: ${f.clave} (${f.url}): ${f.motivo}; ` +
  (f.esperaHasta === undefined
    ? "no espera: vuelve a la cola en la ejecución siguiente"
    : `se vuelve a pedir desde ${fechaUtc(f.esperaHasta)}`);

/**
 * Hasta cuándo espera una ficha tras un fallo acabado en `fin`. Una ilegible, o una que el registro
 * no tiene, espera `espera`, porque pedirla otra vez el domingo daría lo mismo; un fallo pasajero
 * no espera, y la ejecución del domingo la vuelve a pedir.
 */
const esperaHastaTras = (
  fallo: ErrorDeExtractor,
  fin: number,
  espera: Duration.Duration,
): number | undefined =>
  fallo._tag === "RespuestaInesperada" || fallo._tag === "SinFichaEnElRegistro"
    ? fin + Duration.toMillis(espera)
    : undefined;

/**
 * Lee las fichas de la cola en orden, una cada `ritmo`, hasta que se acaba la cola o se cierra la
 * ventana: una ficha que ya no empezaría antes del cierre se deja para la ejecución siguiente. La
 * pausa la hace el cliente de la fuente; aquí solo se mira si la siguiente cabe.
 *
 * - Una ficha leída se guarda en el momento, así que un corte no pierde las anteriores.
 * - Una ficha que no se puede leer (`RespuestaInesperada`) apunta su fallo y espera a la ronda
 *   siguiente (`espera`). Una que el registro no tiene (`SinFichaEnElRegistro`) espera igual, y
 *   además queda marcada como sin ficha en el registro. Una fuente que no responde ni tras los
 *   reintentos del cliente cuenta como fallo, pero no hace esperar a la ficha.
 * - Cada ficha que falla deja en el diario una línea de aviso con su clave, su URL, el motivo, el
 *   intento y cuándo se vuelve a pedir, y el resumen del final las nombra con su motivo.
 * - Una que el registro no tiene no cuenta para los fallos seguidos ni los corta: es lo que dice
 *   el registro, no un fallo de la fuente. Tras `SIN_FICHA_SEGUIDAS` así seguidas, se paran las
 *   fichas, porque lo probable es que haya cambiado la URL de la ficha, y ninguna de la racha
 *   queda sin ficha en el registro: esperan como cualquier fallo. Por eso la marca de una racha
 *   se apunta cuando acaba.
 * - Tras `fallosSeguidos` fallos seguidos, o si la fuente bloquea a Celda (un 401 o un 403, una
 *   página que no es una ficha), pide esperar (un 429, o un 503 con `Retry-After` que pide más de
 *   lo que el cliente aguanta), el tope de peticiones o `robots.txt`, se deja de pedir en esta
 *   ejecución sin insistir, y queda en los errores.
 * - Al pasar la mitad de la ventana con alguna ficha leída, lanza `aMitad` una vez.
 */
export const leerFichasEnLaVentana = Effect.fn("Ingesta.fichasEnLaVentana")(function* (
  lectura: LecturaEnLaVentana,
) {
  const { opciones } = lectura;
  const ritmo = Duration.toMillis(Duration.max(opciones.ritmo, RITMO_MINIMO));
  const cierre = lectura.inicio + Duration.toMillis(opciones.ventana);
  let mitad = lectura.inicio + Duration.toMillis(opciones.ventana) / 2;
  const errores: Array<string> = [];
  let pedidas = 0;
  let leidas = 0;
  let cambiadas = 0;
  const fallidas: Array<FichaFallida> = [];
  let seguidos = 0;
  /**
   * Las fichas sin ficha en el registro seguidas, aún sin apuntar: la marca solo se guarda cuando
   * la racha acaba antes de `SIN_FICHA_SEGUIDAS`. Si llega, la racha entera es sospechosa.
   */
  let racha: Array<{ readonly clave: string; readonly fallo: FalloDeFicha }> = [];
  const apuntarRacha = (conMarca: boolean) =>
    Effect.suspend(() => {
      const apuntar = racha;
      racha = [];
      return Effect.forEach(
        apuntar,
        ({ clave, fallo }) =>
          lectura.fallar(clave, conMarca ? fallo : { ...fallo, sinFichaEnRegistro: undefined }),
        { discard: true },
      );
    });
  let finAnterior: number | undefined;
  let parada: string | undefined;
  const parar = (motivo: string) => {
    parada = motivo;
    errores.push(`Fichas paradas: ${motivo}`);
  };

  for (const enCola of lectura.cola) {
    if (opciones.maximo !== undefined && pedidas >= opciones.maximo) {
      parada = `tope de ${opciones.maximo} fichas`;
      break;
    }
    const ahora = yield* Clock.currentTimeMillis;
    const empezaria = finAnterior === undefined ? ahora : Math.max(ahora, finAnterior + ritmo);
    if (empezaria >= cierre) {
      parada = `ventana cerrada a las ${hora(cierre)}`;
      break;
    }
    pedidas++;
    const leida = yield* Effect.result(lectura.ficha(enCola.registro));
    finAnterior = yield* Clock.currentTimeMillis;
    if (Result.isFailure(leida)) {
      const fallo = leida.failure;
      const motivo = describirError(fallo);
      if (PARAN_LAS_FICHAS.has(fallo._tag)) {
        parar(motivo);
        break;
      }
      const sinFicha = fallo._tag === "SinFichaEnElRegistro";
      // Una ficha que el registro no tiene no es un fallo de la fuente: ni suma ni corta los
      // fallos seguidos. Las demás acaban la racha de las que no tiene.
      if (!sinFicha) {
        seguidos++;
        yield* apuntarRacha(true);
      }
      const { clave, url } = enCola.registro;
      errores.push(`Ficha ${clave}: ${motivo}`);
      const intento = enCola.fallos + 1;
      const esperaHasta = esperaHastaTras(fallo, finAnterior, lectura.espera);
      if (esperaHasta !== undefined) {
        const apuntado: FalloDeFicha = {
          fallos: intento,
          esperaHasta,
          motivo,
          sinFichaEnRegistro: sinFicha ? lectura.inicio : undefined,
        };
        if (sinFicha) racha.push({ clave, fallo: apuntado });
        else yield* lectura.fallar(clave, apuntado);
      }
      const fallida: FichaFallida = { clave, url, motivo: motivoDe(fallo), intento, esperaHasta };
      fallidas.push(fallida);
      yield* Effect.logWarning(describirFichaFallida(fallida));
      if (racha.length >= SIN_FICHA_SEGUIDAS) {
        const motivoDeParar =
          `${racha.length} fichas seguidas dicen «Código de emplazamiento no válido»: ` +
          "puede que haya cambiado la URL de la ficha del registro o el formato de sus códigos";
        // Ninguna de la racha se da por sin ficha: esperan y se reintentan como cualquier fallo.
        yield* apuntarRacha(false);
        yield* Effect.logError(`Fichas paradas: ${motivoDeParar}`);
        parar(motivoDeParar);
        break;
      }
      if (seguidos >= opciones.fallosSeguidos) {
        parar(`${seguidos} fallos seguidos`);
        break;
      }
      continue;
    }
    seguidos = 0;
    yield* apuntarRacha(true);
    const cambiada = yield* lectura.aplicar(enCola.registro.clave, leida.success);
    leidas++;
    cambiadas += cambiada ? 1 : 0;
    if (leidas % 500 === 0) {
      yield* Effect.logInfo(`Fichas: ${leidas} leídas, ${lectura.cola.length - pedidas} en cola`);
    }
    if (finAnterior >= mitad) {
      mitad = Infinity;
      yield* Effect.logInfo(`Mitad de la ventana de fichas con ${leidas} leídas: se publica`);
      yield* lectura.aMitad;
    }
  }

  // Una racha corta que acaba con la cola, la ventana o una parada es lo que dice el registro.
  yield* apuntarRacha(true);
  const hechas: FichasDeLaEjecucion = {
    leidas,
    cambiadas,
    fallidas,
    pendientes: lectura.cola.length - pedidas,
    errores,
    parada,
  };
  yield* Effect.logInfo(
    `Fichas: ${leidas} leídas (${cambiadas} cambiadas), ${fallidas.length} fallidas, ` +
      `${hechas.pendientes} pendientes` +
      (parada === undefined ? "" : `; paradas: ${parada}`) +
      (fallidas.length === 0
        ? ""
        : `. Fallidas: ${fallidas.map((f) => `${f.clave}: ${f.motivo}`).join("; ")}`),
  );
  return hechas;
});
