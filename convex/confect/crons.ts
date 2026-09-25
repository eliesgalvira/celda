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

export default CronJobs.make().add(INGESTA_REGISTRO_OFICIAL);
