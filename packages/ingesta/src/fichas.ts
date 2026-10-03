import type { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import type { ZonaDeBarrido } from "@celda/dominio/barrido";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { OpcionesCliente } from "./cliente.ts";
import { describirError, type ErrorDeExtractor, type Registro } from "./extractor.ts";

/**
 * Las fichas del registro oficial en la ingesta nocturna (ADR 0014): una cada `ritmo`, dentro de
 * una ventana desde que empieza la noche, primero las de las provincias con prioridad y luego las
 * de cada zona de barrido. La cola vive en la base: cada observación guarda cuándo se leyó su
 * ficha y, si falló, cuántas veces y hasta cuándo espera. Una noche cortada no pierde nada, y la
 * siguiente sigue por donde iba porque el orden sale siempre igual de la base.
 */

/**
 * Nunca se piden fichas más deprisa que esto: una cada segundo, y siempre de una en una (ADR
 * 0014). Bajó de 3 s a 1 s a petición del usuario el 01/10/2026.
 */
export const RITMO_MINIMO = Duration.seconds(1);

/** El ritmo si la configuración no dice otro: una ficha cada 3 s (ADR 0014). */
export const RITMO_POR_DEFECTO = Duration.seconds(3);

/**
 * Tras un fallo de una ficha concreta, como el aviso de código no válido, espera esto antes de
 * volver a pedirla, y el doble con cada fallo seguido, hasta la relectura.
 */
export const ESPERA_TRAS_FALLO = Duration.days(1);

/**
 * Fichas seguidas con el aviso «Código de emplazamiento no válido» tras las que se dejan las
 * fichas para la noche siguiente. Una sola es lo que dice el registro de esa estación base y no
 * cuenta como fallo, pero el 02/10/2026 eran 2 de unas 69.600: veinte seguidas querrían decir que
 * ha cambiado la URL de la ficha o el formato de los códigos, no que todas sean de verdad.
 */
export const SIN_FICHA_SEGUIDAS = 20;

/** Cómo se leen las fichas en una noche. */
export interface OpcionesFichas {
  /**
   * Pausa entre el final de una ficha y la petición de la siguiente. Nunca baja de
   * `RITMO_MINIMO`.
   */
  readonly ritmo: Duration.Duration;
  /**
   * Cuánto tiempo se leen fichas, desde que empieza la noche. Al cerrarse, las que quedan
   * esperan a la noche siguiente.
   */
  readonly ventana: Duration.Duration;
  /** Una ficha leída hace más que esto se vuelve a leer. */
  readonly relectura: Duration.Duration;
  /**
   * Provincias, por su código INE de dos cifras, cuyas fichas van antes que las de ninguna zona
   * de barrido, en este orden.
   */
  readonly prioridad: ReadonlyArray<string>;
  /** Tope de fichas por noche; sin él, se leen hasta cerrar la ventana. */
  readonly maximo: number | undefined;
  /** Fallos seguidos tras los que se dejan las fichas para la noche siguiente. */
  readonly fallosSeguidos: number;
}

/**
 * Por defecto (ADR 0014): una cada 3 s durante 6 horas, unas 5.500 por noche, y relectura a los
 * 30 días. Primero la provincia de Barcelona, luego el resto de Cataluña (Girona, Lleida y
 * Tarragona) y después el resto de España, por zonas de barrido.
 */
export const OPCIONES_FICHAS: OpcionesFichas = {
  ritmo: RITMO_POR_DEFECTO,
  ventana: Duration.hours(6),
  relectura: Duration.days(30),
  prioridad: ["08", "17", "25", "43"],
  maximo: undefined,
  fallosSeguidos: 3,
};

/** Lo que se escribe para no dar prioridad a ninguna provincia. */
const NINGUNA = "ninguna";

const codigos = (lista: string): ReadonlyArray<string> =>
  lista
    .split(",")
    .map((codigo) => codigo.trim())
    .filter((codigo) => codigo !== "" && codigo !== NINGUNA);

const ListaDeProvincias = Schema.String.check(
  Schema.makeFilter((lista: string) => {
    const malos = codigos(lista).filter((codigo) => !/^\d{2}$/u.test(codigo));
    return (
      malos.length === 0 ||
      `códigos de provincia que no son dos cifras del INE: ${malos.join(", ")}. ` +
        "Barcelona es 08, Girona 17, Lleida 25 y Tarragona 43"
    );
  }),
);

/**
 * Las opciones desde variables de entorno:
 *
 * - `CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS`: segundos entre fichas (3, y nunca menos de 1).
 * - `CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS`: minutos de fichas desde que empieza la noche (360).
 * - `CELDA_REGISTRO_FICHAS_RELECTURA_DIAS`: días tras los que se vuelve a leer una ficha (30).
 * - `CELDA_REGISTRO_FICHAS_PRIORIDAD`: provincias que van primero, por su código INE y
 *   separadas por comas, o `ninguna` (`08,17,25,43`: Barcelona y el resto de Cataluña).
 * - `CELDA_INGESTA_MAX_FICHAS`: tope de fichas por noche (sin tope; con 0 no se lee ninguna).
 */
export const opcionesFichasDesdeConfig: Config.Config<OpcionesFichas> = Config.all({
  ritmo: Config.Int("CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS").pipe(
    Config.withDefault(Duration.toSeconds(OPCIONES_FICHAS.ritmo)),
  ),
  ventana: Config.Int("CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS").pipe(
    Config.withDefault(Duration.toMinutes(OPCIONES_FICHAS.ventana)),
  ),
  relectura: Config.Int("CELDA_REGISTRO_FICHAS_RELECTURA_DIAS").pipe(
    Config.withDefault(Duration.toDays(OPCIONES_FICHAS.relectura)),
  ),
  prioridad: Config.schema(ListaDeProvincias, "CELDA_REGISTRO_FICHAS_PRIORIDAD").pipe(
    Config.withDefault(OPCIONES_FICHAS.prioridad.join(",")),
  ),
  maximo: Config.option(Config.Int("CELDA_INGESTA_MAX_FICHAS")),
}).pipe(
  Config.map((c): OpcionesFichas => ({
    ...OPCIONES_FICHAS,
    ritmo: Duration.max(Duration.seconds(c.ritmo), RITMO_MINIMO),
    ventana: Duration.minutes(Math.max(c.ventana, 0)),
    relectura: Duration.days(Math.max(c.relectura, 1)),
    prioridad: codigos(c.prioridad),
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

/** El orden de la cola: provincias con prioridad, zonas de barrido y el resto. */
export interface Prioridad {
  /** Códigos INE de provincia, en su orden. */
  readonly provincias: ReadonlyArray<string>;
  /** Las zonas de barrido, en su orden. Una repetida cuenta donde sale primero. */
  readonly zonas: ReadonlyArray<ZonaDeBarrido>;
  /** El código INE de la provincia en que cae un punto, si cae en alguna. */
  readonly provinciaDe: (posicion: Coordenada) => string | undefined;
}

/** A qué parte de la cola va una ficha. */
export type GrupoDeCola =
  | { readonly tipo: "provincia"; readonly provincia: string }
  | { readonly tipo: "zona"; readonly zona: string }
  | { readonly tipo: "fuera" };

/** Los grupos de la cola en orden, y el índice del grupo de cada ficha. */
const agrupador = (prioridad: Prioridad) => {
  const zonas = new Map<string, number>();
  const nombres: Array<string> = [];
  for (const zona of prioridad.zonas) {
    if (nombres.includes(zona.nombre)) continue;
    for (const cuadro of zona.cuadros) {
      if (!zonas.has(cuadro)) zonas.set(cuadro, nombres.length);
    }
    nombres.push(zona.nombre);
  }
  const provincias = prioridad.provincias.filter((p, i) => prioridad.provincias.indexOf(p) === i);
  const grupos: ReadonlyArray<GrupoDeCola> = [
    ...provincias.map((provincia): GrupoDeCola => ({ tipo: "provincia", provincia })),
    ...nombres.map((zona): GrupoDeCola => ({ tipo: "zona", zona })),
    { tipo: "fuera" },
  ];
  const grupoDe = (ficha: FichaEnCola): number => {
    if (provincias.length > 0) {
      const provincia = prioridad.provinciaDe(ficha.registro.posicion);
      const indice = provincia === undefined ? -1 : provincias.indexOf(provincia);
      if (indice >= 0) return indice;
    }
    return provincias.length + (zonas.get(ficha.cuadro) ?? nombres.length);
  };
  return { grupos, grupoDe };
};

/** Si una ficha está esperando tras un fallo. */
const esperando = (ficha: FichaEnCola, ahora: number): boolean =>
  ficha.esperaHasta !== null && ficha.esperaHasta > ahora;

/**
 * El orden en que se leen las fichas. Primero las de las provincias con prioridad, en su orden;
 * luego las de cada zona de barrido, en su orden, y al final las que no caen en ninguna. Dentro
 * de cada grupo van primero las nuevas y las de listado cambiado, en el orden en que llegaron, y
 * luego las de relectura, de la leída hace más tiempo a la más reciente. Las que esperan tras un
 * fallo se quedan fuera hasta que pase su espera.
 */
export const ordenarFichas = (
  cola: ReadonlyArray<FichaEnCola>,
  prioridad: Prioridad,
  ahora: number,
): ReadonlyArray<FichaEnCola> => {
  const { grupoDe } = agrupador(prioridad);
  return cola
    .filter((ficha) => !esperando(ficha, ahora))
    .map((ficha) => ({ ficha, grupo: grupoDe(ficha) }))
    .sort(
      (a, b) =>
        a.grupo - b.grupo ||
        Number(a.ficha.leidaEn !== null) - Number(b.ficha.leidaEn !== null) ||
        (a.ficha.leidaEn ?? 0) - (b.ficha.leidaEn ?? 0) ||
        a.ficha.orden - b.ficha.orden,
    )
    .map(({ ficha }) => ficha);
};

/** Cuántas fichas quedan por leer en una parte de la cola. */
export interface Pendientes {
  /** Nuevas o con el listado cambiado: nunca se han leído así. */
  readonly nuevas: number;
  /** Leídas hace más que la relectura. */
  readonly porReleer: number;
  /** Esperando tras un fallo. */
  readonly enEspera: number;
}

/** Lo que queda por leer en un grupo de la cola. */
export interface GrupoPendiente extends Pendientes {
  readonly grupo: GrupoDeCola;
}

const contar =
  (cuenta: { nuevas: number; porReleer: number; enEspera: number }) =>
  (ficha: FichaEnCola, ahora: number) => {
    if (esperando(ficha, ahora)) cuenta.enEspera++;
    else if (ficha.leidaEn === null) cuenta.nuevas++;
    else cuenta.porReleer++;
  };

/** Cuántas fichas quedan en cada grupo de la cola, en el orden en que se leen. */
export const resumirCola = (
  cola: ReadonlyArray<FichaEnCola>,
  prioridad: Prioridad,
  ahora: number,
): ReadonlyArray<GrupoPendiente> => {
  const { grupos, grupoDe } = agrupador(prioridad);
  const cuentas = grupos.map((grupo) => ({ grupo, nuevas: 0, porReleer: 0, enEspera: 0 }));
  for (const ficha of cola) {
    const cuenta = cuentas[grupoDe(ficha)];
    if (cuenta !== undefined) contar(cuenta)(ficha, ahora);
  }
  return cuentas.filter((c) => c.nuevas + c.porReleer + c.enEspera > 0);
};

/**
 * Cuántas fichas le quedan a cada zona de barrido, contando también las de sus provincias con
 * prioridad: todas las de las observaciones de sus cuadros. Una zona repetida sale una vez.
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
 * Las provincias de los puntos, para ordenar la cola. Por defecto no sabe ninguna, y entonces
 * la cola va solo por zonas de barrido; la ingesta nocturna la saca de los límites del IGN.
 */
export const Provincias = Context.Reference<{
  readonly provinciaDe: (posicion: Coordenada) => string | undefined;
  readonly nombreDe: (codigo: string) => string | undefined;
}>("@celda/ingesta/fichas/Provincias", {
  defaultValue: () => ({ provinciaDe: () => undefined, nombreDe: () => undefined }),
});

/**
 * Lo que se hace al pasar la mitad de la ventana si se ha leído alguna ficha: fusionar y
 * publicar, para que una noche cortada después no pierda lo leído. Por defecto, nada.
 */
export const PublicacionAMitad = Context.Reference<{ readonly publicar: Effect.Effect<void> }>(
  "@celda/ingesta/fichas/PublicacionAMitad",
  { defaultValue: () => ({ publicar: Effect.void }) },
);

/** Fallos tras los que no se pide ninguna ficha más esta noche, sin insistir. */
const PARAN_LAS_FICHAS: ReadonlySet<ErrorDeExtractor["_tag"]> = new Set([
  "FuenteBloqueada",
  "FuentePideEsperar",
  "LimiteDePeticiones",
  "ProhibidoPorRobots",
]);

/** Cuánto espera una ficha tras su fallo número `fallos`, sin pasar de la relectura. */
export const esperaTrasFallos = (fallos: number, relectura: Duration.Duration): Duration.Duration =>
  Duration.min(Duration.times(ESPERA_TRAS_FALLO, 2 ** Math.max(fallos - 1, 0)), relectura);

/** Lo que se apunta de una ficha que ha fallado. */
export interface FalloDeFicha {
  readonly fallos: number;
  readonly esperaHasta: number;
  readonly motivo: string;
  /**
   * Si el registro dice que no tiene ficha de la estación base («Código de emplazamiento no
   * válido»), la fecha de la comprobación: la de inicio de la noche, como el resto de sus datos.
   */
  readonly sinFichaEnRegistro: number | undefined;
}

/** Una ficha que ha fallado esta noche, para el diario y el resumen de la ejecución. */
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
  /** Cuándo empezó la noche: la ventana cuenta desde ahí. */
  readonly inicio: number;
  readonly ficha: (registro: Registro) => Effect.Effect<ReadonlyArray<Banda>, ErrorDeExtractor>;
  /** Guarda las bandas de una ficha y borra sus fallos; `true` si han cambiado. */
  readonly aplicar: (clave: string, bandas: ReadonlyArray<Banda>) => Effect.Effect<boolean>;
  /**
   * Apunta el fallo de una ficha y hasta cuándo espera, y si es porque el registro no la tiene,
   * la marca como sin ficha en el registro.
   */
  readonly fallar: (clave: string, fallo: FalloDeFicha) => Effect.Effect<void>;
  /** Se lanza una vez, tras la primera ficha leída pasada la mitad de la ventana. */
  readonly aMitad: Effect.Effect<void>;
}

/** Lo que han dado las fichas de una noche. */
export interface FichasDeLaNoche {
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
    ? "no espera: vuelve a la cola la noche siguiente"
    : `se vuelve a pedir desde ${fechaUtc(f.esperaHasta)}`);

/**
 * Lee las fichas de la cola en orden, una cada `ritmo`, hasta que se acaba la cola o se cierra la
 * ventana: una ficha que ya no empezaría antes del cierre se deja para la noche siguiente. La
 * pausa la hace el cliente de la fuente; aquí solo se mira si la siguiente cabe.
 *
 * - Una ficha leída se guarda en el momento, así que un corte no pierde las anteriores.
 * - Una ficha que no se puede leer (`RespuestaInesperada`) apunta su fallo y espera un día, el
 *   doble con cada fallo seguido. Una que el registro no tiene (`SinFichaEnElRegistro`) espera
 *   igual, y además queda marcada como sin ficha en el registro. Una fuente que no responde ni
 *   tras los reintentos del cliente cuenta como fallo, pero no hace esperar a la ficha.
 * - Cada ficha que falla deja en el diario una línea de aviso con su clave, su URL, el motivo, el
 *   intento y cuándo se vuelve a pedir, y el resumen del final las nombra con su motivo.
 * - Una que el registro no tiene no cuenta para los fallos seguidos ni los corta: es lo que dice
 *   el registro, no un fallo de la fuente. Tras `SIN_FICHA_SEGUIDAS` así seguidas, se paran las
 *   fichas, porque lo probable es que haya cambiado la URL de la ficha.
 * - Tras `fallosSeguidos` fallos seguidos, o si la fuente bloquea a Celda (un 401 o un 403, una
 *   página que no es una ficha), pide esperar (un 429, o un 503 con `Retry-After` que pide más de
 *   lo que el cliente aguanta), el tope de peticiones o `robots.txt`, se deja de pedir esta noche
 *   sin insistir, y queda en los errores.
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
  let sinFichaSeguidas = 0;
  let finAnterior: number | undefined;
  let parada: string | undefined;
  const parar = (motivo: string) => {
    parada = motivo;
    errores.push(`Fichas paradas hasta la próxima noche: ${motivo}`);
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
    const bandas = yield* Effect.result(lectura.ficha(enCola.registro));
    finAnterior = yield* Clock.currentTimeMillis;
    if (Result.isFailure(bandas)) {
      const fallo = bandas.failure;
      const motivo = describirError(fallo);
      if (PARAN_LAS_FICHAS.has(fallo._tag)) {
        parar(motivo);
        break;
      }
      const sinFicha = fallo._tag === "SinFichaEnElRegistro";
      // Una ficha que el registro no tiene no es un fallo de la fuente: ni suma ni corta los
      // fallos seguidos. Las demás cortan las que no tiene seguidas.
      if (sinFicha) sinFichaSeguidas++;
      else {
        seguidos++;
        sinFichaSeguidas = 0;
      }
      const { clave, url } = enCola.registro;
      errores.push(`Ficha ${clave}: ${motivo}`);
      const intento = enCola.fallos + 1;
      // Una ficha ilegible, o una que el registro no tiene, espera; un fallo pasajero, no.
      const espera = sinFicha || fallo._tag === "RespuestaInesperada";
      const esperaHasta = espera
        ? finAnterior + Duration.toMillis(esperaTrasFallos(intento, opciones.relectura))
        : undefined;
      if (esperaHasta !== undefined) {
        yield* lectura.fallar(clave, {
          fallos: intento,
          esperaHasta,
          motivo,
          sinFichaEnRegistro: sinFicha ? lectura.inicio : undefined,
        });
      }
      const fallida: FichaFallida = { clave, url, motivo: motivoDe(fallo), intento, esperaHasta };
      fallidas.push(fallida);
      yield* Effect.logWarning(describirFichaFallida(fallida));
      if (sinFichaSeguidas >= SIN_FICHA_SEGUIDAS) {
        const motivoDeParar =
          `${sinFichaSeguidas} fichas seguidas dicen «Código de emplazamiento no válido»: ` +
          "puede que haya cambiado la URL de la ficha del registro o el formato de sus códigos";
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
    sinFichaSeguidas = 0;
    const cambiada = yield* lectura.aplicar(enCola.registro.clave, bandas.success);
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

  const hechas: FichasDeLaNoche = {
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
