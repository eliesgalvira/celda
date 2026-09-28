/**
 * Tipos de vía que el registro oficial pone delante del nombre, a veces dos seguidos
 * («VP PZ DE LAS CORTES»).
 */
const TIPOS_DE_VIA = new Set([
  "AV",
  "AVDA",
  "C",
  "CL",
  "CM",
  "CR",
  "CTRA",
  "GL",
  "GV",
  "PG",
  "PJ",
  "PL",
  "PS",
  "PZ",
  "RB",
  "RD",
  "TR",
  "UR",
  "VP",
]);

/** Artículos y preposiciones que unas compañías escriben y otras no («CL DE JOSE ORTEGA Y GASSET»). */
const PARTICULAS = new Set([
  "D",
  "DE",
  "DEL",
  "DELS",
  "EL",
  "ELS",
  "L",
  "LA",
  "LAS",
  "LES",
  "LOS",
  "Y",
]);

const palabras = (texto: string): Array<string> => texto.split(/[^A-Z0-9]+/u).filter(Boolean);

/**
 * La vía, el número y el municipio de una dirección del registro oficial («vía, número. MUNICIPIO,
 * PROVINCIA»), escritos igual para todas las compañías: sin tildes, sin el tipo de vía, sin
 * artículos ni preposiciones y con el número sin ceros a la izquierda. Así «CL DE JOSE ORTEGA Y
 * GASSET, 91» y «CL JOSE ORTEGA Y GASSET, 91» dan lo mismo.
 *
 * Sin nombre de vía o sin número («CL , 92», «PZ ESPAÑA, S/N») no hay clave: esas direcciones no
 * dicen en qué edificio está la estación.
 */
export const claveDeDireccion = (direccion: string): string | undefined => {
  const texto = direccion.normalize("NFD").replaceAll(/\p{M}/gu, "").toUpperCase();
  const partes = texto.split(". ");
  const via = partes.length > 1 ? partes.slice(0, -1).join(". ") : texto;
  const municipio = partes.length > 1 ? palabras(partes.at(-1) ?? "").join(" ") : "";
  const coma = via.indexOf(",");
  if (coma < 0) {
    return undefined;
  }
  const nombre = palabras(via.slice(0, coma));
  while (nombre.length > 0 && TIPOS_DE_VIA.has(nombre[0] ?? "")) {
    nombre.shift();
  }
  const sinParticulas = nombre.filter((palabra) => !PARTICULAS.has(palabra)).join(" ");
  const numero = /\d+/u.exec(via.slice(coma + 1))?.[0];
  return sinParticulas === "" || numero === undefined
    ? undefined
    : `${sinParticulas}, ${Number(numero)}. ${municipio}`;
};
