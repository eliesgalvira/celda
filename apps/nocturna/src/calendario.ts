import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Cuándo corre la ingesta (ADR 0029): el primer sábado de cada mes y el domingo siguiente, a la
 * misma hora de una zona horaria. El temporizador de systemd la lanza con lo mismo
 * (`nix/nocturna-nixos.mod.nix`). El programa solo lo usa para decir, en el diario y en la orden
 * `estado`, cuándo es la próxima ejecución y si retoma la ronda o empieza otra. Lo que lee cada
 * ejecución lo decide lo que guarda la base (`RECIENTE`).
 */
export interface Calendario {
  /** La hora del día a la que empieza, en minutos desde la medianoche. */
  readonly minuto: number;
  /** La zona horaria de esa hora, como `Europe/Madrid`. */
  readonly zonaHoraria: string;
}

/** Por defecto, a las 00:30 de Madrid, la hora de producción. */
export const CALENDARIO: Calendario = { minuto: 30, zonaHoraria: "Europe/Madrid" };

/** Una ejecución que lanza el temporizador. */
export interface EjecucionProgramada {
  readonly instante: number;
  /** El primer sábado del mes, que empieza una ronda, o el domingo siguiente, que la retoma. */
  readonly dia: "sabado" | "domingo";
}

/** El instante de un día del calendario a su hora, en su zona horaria. */
const instanteDe = (calendario: Calendario, anio: number, mes: number, dia: number): number =>
  DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(
      {
        year: anio,
        month: mes,
        day: dia,
        hour: Math.floor(calendario.minuto / 60),
        minute: calendario.minuto % 60,
      },
      { timeZone: calendario.zonaHoraria, adjustForTimeZone: true },
    ),
  );

/** Las dos ejecuciones de un mes: la del primer sábado y la del domingo siguiente. */
const delMes = (
  calendario: Calendario,
  anio: number,
  mes: number,
): ReadonlyArray<EjecucionProgramada> => {
  // El día de la semana de una fecha no depende de la zona horaria.
  const primero = DateTime.getPartUtc(
    DateTime.makeUnsafe({ year: anio, month: mes, day: 1 }),
    "weekDay",
  );
  const sabado = 1 + ((6 - primero + 7) % 7);
  return [
    { instante: instanteDe(calendario, anio, mes, sabado), dia: "sabado" },
    { instante: instanteDe(calendario, anio, mes, sabado + 1), dia: "domingo" },
  ];
};

/** La primera ejecución del calendario después de `ahora`. */
export const proximaEjecucion = (calendario: Calendario, ahora: number): EjecucionProgramada => {
  const hoy = DateTime.toParts(
    DateTime.makeZonedUnsafe(ahora, { timeZone: calendario.zonaHoraria }),
  );
  // La de este mes, si aún no ha pasado, o la del siguiente.
  const meses = [0, 1].map((paso) => {
    const indice = hoy.month - 1 + paso;
    return { anio: hoy.year + Math.floor(indice / 12), mes: (indice % 12) + 1 };
  });
  const siguiente = meses
    .flatMap(({ anio, mes }) => delMes(calendario, anio, mes))
    .find((ejecucion) => ejecucion.instante > ahora);
  // La del mes siguiente siempre es posterior a `ahora`.
  return siguiente ?? { instante: ahora, dia: "sabado" };
};

const dosCifras = (n: number): string => String(n).padStart(2, "0");

/** «domingo 8/11/2026 a las 00:30 (Europe/Madrid)». */
export const describirProgramada = (
  calendario: Calendario,
  ejecucion: EjecucionProgramada,
): string => {
  const local = DateTime.toParts(
    DateTime.makeZonedUnsafe(ejecucion.instante, { timeZone: calendario.zonaHoraria }),
  );
  return (
    `${ejecucion.dia === "sabado" ? "sábado" : "domingo"} ` +
    `${local.day}/${local.month}/${local.year} a las ` +
    `${dosCifras(local.hour)}:${dosCifras(local.minute)} (${calendario.zonaHoraria})`
  );
};

const Hora = Schema.String.check(
  Schema.makeFilter(
    (hora: string) =>
      /^([01]\d|2[0-3]):[0-5]\d$/u.test(hora) ||
      `«${hora}» no es una hora del día como 00:30, con dos cifras para las horas y dos para los minutos`,
  ),
);

const ZonaHoraria = Schema.String.check(
  Schema.makeFilter(
    (zona: string) =>
      Option.isSome(DateTime.zoneMakeNamed(zona)) ||
      `«${zona}» no es una zona horaria de la base de datos de la IANA, como Europe/Madrid`,
  ),
);

/**
 * El calendario desde variables de entorno, las mismas con que el módulo de NixOS programa el
 * temporizador:
 *
 * - `CELDA_INGESTA_HORA`: la hora de cada ejecución, `HH:MM` (`00:30`).
 * - `CELDA_INGESTA_ZONA_HORARIA`: su zona horaria (`Europe/Madrid`).
 */
export const calendarioDesdeConfig: Config.Config<Calendario> = Config.all({
  hora: Config.schema(Hora, "CELDA_INGESTA_HORA").pipe(Config.withDefault("00:30")),
  zonaHoraria: Config.schema(ZonaHoraria, "CELDA_INGESTA_ZONA_HORARIA").pipe(
    Config.withDefault(CALENDARIO.zonaHoraria),
  ),
}).pipe(
  Config.map(({ hora, zonaHoraria }): Calendario => {
    const [horas = 0, minutos = 0] = hora.split(":").map(Number);
    return { minuto: horas * 60 + minutos, zonaHoraria };
  }),
);
