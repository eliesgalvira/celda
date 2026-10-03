import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";

/**
 * Los componentes del despliegue: el limitador de cubos de fichas del buzón (ADR 0020). Este
 * fichero no lo genera nadie; Confect lo lee para tipar `confect/_generated/components.ts`.
 */
const app = defineApp();
app.use(rateLimiter);

export default app;
