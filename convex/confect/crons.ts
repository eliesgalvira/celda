import { CronJob, CronJobs } from "@confect/server";
import * as Cron from "effect/Cron";

import refs from "./_generated/refs";

/**
 * Cada hora, a los 7 minutos, se borran las huellas de IP de más de 24 horas y las sales de los
 * días pasados. Una huella vive así como mucho 25 horas.
 */
export const LIMPIEZA_DE_HUELLAS = CronJob.make(
  "limpieza de huellas de IP",
  Cron.parseUnsafe("7 * * * *"),
  refs.internal.limpieza.huellas,
);

export default CronJobs.make().add(LIMPIEZA_DE_HUELLAS);
