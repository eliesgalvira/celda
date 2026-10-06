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
 * Letras que llegan al registro oficial con otra página de códigos y se guardan otra vez en
 * Latin-1: `Güell` se publica como `G³ell`, `España` como `Espa±a` y `CAÑADA` como `CA¥ADA`. Solo
 * se corrigen caracteres que no aparecen en una dirección escrita bien. En la copia de la base
 * del 30/09/2026 había 27 direcciones con `±` y 2 con `¥`.
 */
const MAL_CODIFICADAS: ReadonlyArray<readonly [string, string]> = [
  ["³", "ü"],
  ["±", "ñ"],
  ["¥", "Ñ"],
];

/**
 * Texto en UTF-8 leído como Latin-1, dos caracteres por letra: `Ã©` es `é` y `Ã±` es `ñ`. Si el
 * segundo byte no tenía carácter en la página de códigos de Windows, llega como `?` y ya no se sabe
 * qué letra era (`Á`, `Í`, `Ï`, `Ð` o `Ý`): solo se repara en palabras conocidas, como
 * `POLÃ?GONO`, la única de la copia del 30/09/2026.
 */
const DOBLE_CODIFICACION = /Ã([\u00A0-\u00BF])/gu;
const PALABRAS_SIN_LETRA: ReadonlyArray<readonly [RegExp, string]> = [
  [/POLÃ\?GONO/gu, "POLÍGONO"],
  [/PolÃ\?gono/gu, "Polígono"],
];

/** Repara la doble codificación de UTF-8 que se puede deshacer con seguridad. */
const sinDobleCodificacion = (texto: string): string =>
  PALABRAS_SIN_LETRA.reduce(
    (actual, [rota, buena]) => actual.replaceAll(rota, buena),
    texto.replaceAll(DOBLE_CODIFICACION, (_doble, segundo: string) =>
      String.fromCharCode(0xc0 + (segundo.charCodeAt(0) - 0x80)),
    ),
  );

/**
 * Corrige un texto de la fuente: la codificación rota, los acentos sueltos que hacen de
 * apóstrofo (`D´URGELL`, `D`URGELL`), los guiones bajos entre palabras (`GRAN_VIA`) y los
 * espacios de más. En la descarga del 26/09/2026 había 9 direcciones con el acento y 4 con
 * guiones bajos. La doble codificación va antes que las letras sueltas, porque `Ã±` es `ñ` y no
 * `Ãñ`.
 */
export const repararTexto = (texto: string): string =>
  MAL_CODIFICADAS.reduce(
    (actual, [roto, bueno]) => actual.replaceAll(roto, bueno),
    sinDobleCodificacion(texto),
  )
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
