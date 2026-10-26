/**
 * La página que reciben `/api` y `/api/emplazamientos` abiertas sin parámetros desde un navegador
 * (`negociacion.ts`). El HTML está en `@celda/ui`, y su hoja de estilo sale del tema en la build.
 */
import { paginaDeLaApi } from "../../../../packages/ui/src/api/pagina.ts";
import { LIMITE_MAXIMO, RADIO_MAXIMO_METROS } from "./consulta.ts";
import { DOCUMENTACION, html } from "./http.ts";

/** El repositorio del código, que enlaza el pie de la página. */
const CODIGO = "https://github.com/eliesgalvira/celda";

/**
 * Lo que deja pasar la regla del cortafuegos del proyecto en Vercel (ADR 0032). La regla vive en
 * Vercel y no en el repositorio: si cambia allí, hay que cambiarlo aquí y en `docs/api.md`.
 */
export const CONSULTAS_POR_MINUTO = 60;

export const pagina = (): Response =>
  html(
    paginaDeLaApi({
      documentacion: DOCUMENTACION,
      codigo: CODIGO,
      radioMaximoKm: RADIO_MAXIMO_METROS / 1000,
      limiteMaximo: LIMITE_MAXIMO,
      consultasPorMinuto: CONSULTAS_POR_MINUTO,
    }),
  );
