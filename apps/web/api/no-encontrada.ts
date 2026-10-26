/**
 * La función de Vercel a la que `vercel.json` manda las rutas de `/api/` que no existen, para que
 * contesten con un 404 en JSON y no con la página del mapa (`src/api/indice.ts`).
 */
import { noEncontrada } from "../src/api/indice.ts";

export const GET = (): Response => noEncontrada();
