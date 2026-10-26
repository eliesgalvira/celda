/**
 * La consulta de ejemplo de la página de la API y su respuesta. La respuesta es un dato exportado,
 * con la versión de la publicación tal cual, y por eso va aparte del resto de textos de la página
 * (`apps/web/src/textosSinJerga.test.ts`).
 */
import { SITIO } from "../marca/alCompartir.ts";

/**
 * La respuesta de verdad a la consulta de ejemplo, recortada a los campos que explica la página:
 * leída el 26/10/2026 de la publicación `sitios@2026-10-21T22:30:02Z`.
 */
export const CONSULTA_DE_EJEMPLO = `${SITIO}/api/emplazamientos?lat=41.172&lon=-2.434&radio=15km&compania=orange&limite=1`;
export const RESPUESTA_DE_EJEMPLO = `{
  "version": "sitios@2026-10-21T22:30:02Z",
  "total": 3,
  "hayMas": true,
  "emplazamientos": [{
    "clave": "orange-CYLR9857A",
    "distanciaMetros": 6472,
    "companias": ["vodafone", "orange"],
    "bandas": [
      { "compania": "vodafone", "mhz": [700, 800, 900, 3500] },
      { "compania": "orange", "mhz": [800, 900] }
    ],
    "municipio": { "codigo": "42113", "nombre": "Medinaceli" },
    "ficha": "${SITIO}/capas/fichas/42/7acbdf405eddd167.json"
  }]
}`;
