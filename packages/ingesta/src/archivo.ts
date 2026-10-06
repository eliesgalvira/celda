import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * El archivo de páginas del registro oficial (ADR 0027): cada respuesta del listado y de las
 * fichas tal como llegó, en bytes, para volver a leerla sin pedirla otra vez cuando cambie la
 * lectura. El extractor archiva cada página antes de leerla. Nunca se publica.
 */

/** De qué parte del registro es una página. */
export type TipoDePagina = "listado" | "ficha";

/**
 * Lo que sacó la lectura de una página al llegar:
 *
 * - `leida`: un listado o una ficha que se ha podido leer;
 * - `sin-ficha`: una ficha con el aviso «Código de emplazamiento no válido»;
 * - `ilegible`: un listado o una ficha del geoportal que la lectura de entonces no entendía;
 * - `ajena`: una página que no es del geoportal, como la de un cortafuegos, o un listado en HTML.
 *
 * Es lo que decidió la lectura de entonces. La de hoy puede decidir otra cosa con los mismos bytes.
 */
export type ResultadoDePagina = "leida" | "sin-ficha" | "ilegible" | "ajena";

/** Una página del registro oficial que ha llegado con HTTP 200, con sus bytes tal como llegan. */
export interface PaginaDelRegistro {
  readonly tipo: TipoDePagina;
  readonly url: string;
  /** La clave de la estación base de una ficha. Un listado no tiene. */
  readonly clave: string | undefined;
  /** Los bytes de la respuesta, en ISO-8859-1 como los manda el geoportal, sin decodificar. */
  readonly cuerpo: Uint8Array;
  readonly resultado: ResultadoDePagina;
}

/**
 * Dónde se archivan las páginas. Por defecto, en ningún sitio: las pruebas que no lo miran no
 * archivan nada, y la ingesta nocturna pone el suyo. Archivar no falla nunca: si no puede, lo dice
 * el diario y la lectura sigue, porque el archivo no puede parar la ingesta.
 */
export const ArchivoDePaginas = Context.Reference<{
  readonly archivar: (pagina: PaginaDelRegistro) => Effect.Effect<void>;
}>("@celda/ingesta/archivo/ArchivoDePaginas", {
  defaultValue: () => ({ archivar: () => Effect.void }),
});

/** Archiva una página en el archivo del contexto. */
export const archivar = Effect.fn("Ingesta.archivar")(function* (pagina: PaginaDelRegistro) {
  const archivo = yield* ArchivoDePaginas;
  yield* archivo.archivar(pagina);
});
