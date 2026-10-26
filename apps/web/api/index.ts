/** La función de Vercel de `GET /api`: el índice de la API (`src/api/indice.ts`). */
import { indice } from "../src/api/indice.ts";

export const GET = (peticion: Request): Response => indice(peticion);
