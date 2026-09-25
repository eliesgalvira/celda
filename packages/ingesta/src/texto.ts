/**
 * Texto de una respuesta en ISO-8859-1. Cada byte es el carácter Unicode del mismo número, así
 * que no hace falta `TextDecoder`, que en el runtime de Convex solo garantiza UTF-8.
 */
export const decodificarLatin1 = (bytes: Uint8Array): string => {
  const trozos: Array<string> = [];
  for (let inicio = 0; inicio < bytes.length; inicio += 8192) {
    trozos.push(String.fromCharCode(...bytes.subarray(inicio, inicio + 8192)));
  }
  return trozos.join("");
};

/**
 * Letras que llegan al registro oficial leídas con la página de códigos 850 y guardadas otra
 * vez en Latin-1: `Güell` se publica como `G³ell`. Solo se corrigen los caracteres que no
 * aparecen en una dirección escrita bien.
 */
const MAL_CODIFICADAS: ReadonlyArray<readonly [string, string]> = [["³", "ü"]];

/**
 * Corrige un texto de la fuente: la codificación rota, los acentos sueltos que hacen de
 * apóstrofo (`D´URGELL`, `D`URGELL`), los guiones bajos entre palabras (`GRAN_VIA`) y los
 * espacios de más. En la descarga del 26/09/2026 había 9 direcciones con el acento y 4 con
 * guiones bajos.
 */
export const repararTexto = (texto: string): string =>
  MAL_CODIFICADAS.reduce((actual, [roto, bueno]) => actual.replaceAll(roto, bueno), texto)
    .replaceAll(/[´`]/gu, "'")
    .replaceAll("_", " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** Entidades HTML que usa la ficha del registro oficial, más las numéricas. */
const ENTIDADES = new Map(
  Object.entries({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    nbsp: " ",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    ntilde: "ñ",
    Ntilde: "Ñ",
    uuml: "ü",
    Uuml: "Ü",
    ccedil: "ç",
    Ccedil: "Ç",
    agrave: "à",
    egrave: "è",
    ograve: "ò",
    Agrave: "À",
    Egrave: "È",
    Ograve: "Ò",
    ordm: "º",
    ordf: "ª",
    micro: "µ",
  }),
);

/** Texto visible de un trozo de HTML: sin etiquetas y con las entidades resueltas. */
export const textoDeHtml = (html: string): string =>
  repararTexto(
    html
      .replaceAll(/<[^>]*>/gu, " ")
      .replaceAll(/&#(\d+);/gu, (_, codigo: string) => String.fromCharCode(Number(codigo)))
      .replaceAll(/&([a-zA-Z]+);/gu, (entidad, nombre: string) => ENTIDADES.get(nombre) ?? entidad),
  );
