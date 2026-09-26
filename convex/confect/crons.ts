import { CronJob, CronJobs } from "@confect/server";
import * as Cron from "effect/Cron";

import refs from "./_generated/refs";

/**
 * Ingesta nocturna. Convex evalúa los crons en UTC: las 2:15 UTC son las 4:15 en Barcelona en
 * verano y las 3:15 en invierno, con el geoportal sin tráfico.
 */
export const INGESTA_REGISTRO_OFICIAL = CronJob.make(
  "ingesta del registro oficial",
  Cron.parseUnsafe("15 2 * * *"),
  refs.internal.ingesta.registroOficial,
);

/**
 * antenasmoviles.es una hora después, cuando la del registro ya ha acabado. Con el interruptor
 * apagado, que es como empieza, solo apunta una ejecución omitida.
 */
export const INGESTA_ANTENASMOVILES = CronJob.make(
  "ingesta de antenasmoviles.es",
  Cron.parseUnsafe("15 3 * * *"),
  refs.internal.ingesta.antenasMoviles,
);

export default CronJobs.make().add(INGESTA_REGISTRO_OFICIAL).add(INGESTA_ANTENASMOVILES);
