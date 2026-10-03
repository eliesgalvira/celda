/**
 * Los tokens del tema que pinta el estilo del mapa. Cada uno es una variable `--mapa-*` de
 * tema.css, con el mismo nombre en el tema claro y en el oscuro.
 */
export const TOKENS_MAPA = [
  // El suelo.
  "mapa-fondo",
  "mapa-urbano",
  "mapa-hospital",
  "mapa-educacion",
  "mapa-cementerio",
  "mapa-bosque",
  "mapa-hierba",
  "mapa-parque",
  "mapa-arena",
  "mapa-agua",
  "mapa-edificio",
  "mapa-edificio-borde",
  // Las vías.
  "mapa-tren",
  "mapa-camino",
  "mapa-calle",
  "mapa-calle-borde",
  "mapa-secundaria-borde",
  "mapa-principal-borde",
  "mapa-autovia",
  "mapa-autovia-borde",
  "mapa-autopista",
  "mapa-autopista-borde",
  // Los rótulos.
  "mapa-halo",
  "mapa-rotulo-capital",
  "mapa-rotulo-ciudad",
  "mapa-rotulo-pueblo",
  "mapa-rotulo-aldea",
  "mapa-rotulo-barrio",
  "mapa-rotulo-calle",
  "mapa-rotulo-agua",
  "mapa-rotulo-carretera",
  "mapa-pdi-transporte",
  "mapa-pdi-salud",
  "mapa-pdi-parque",
  "mapa-pdi-otro",
  // Lo que pinta Celda encima.
  "mapa-celda",
  "mapa-sinr-1",
  "mapa-sinr-2",
  "mapa-sinr-3",
  "mapa-sinr-4",
  "mapa-sinr-5",
  "mapa-sinr-6",
  "mapa-referencia",
] as const;

export type TokenMapa = (typeof TOKENS_MAPA)[number];

/** Devuelve el color de un token en una sintaxis que MapLibre entienda. */
export type ColorDeToken = (token: TokenMapa) => string;
