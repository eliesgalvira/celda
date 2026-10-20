import { Coordenada } from "@celda/dominio/area";
import { type Banda, compararTexto } from "@celda/dominio/banda";
import type { Caja } from "@celda/dominio/barrido";
import { Compania } from "@celda/dominio/compania";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";
import type { Fuente } from "@celda/dominio/observacion";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Un elemento del listado del registro oficial tal como lo escribe el registro, antes de que Celda
 * lo limpie (ADR 0027): su `id` (razón social y código), su `Gis_ID`, su `Dirección` y sus
 * coordenadas. Con él se comparan dos listados, así que cambiar la limpieza no cambia nada.
 */
export const ListadoCrudo = Schema.Struct({
  id: Schema.String,
  gisId: Schema.String,
  direccion: Schema.String,
  longitud: Schema.Finite,
  latitud: Schema.Finite,
});
export type ListadoCrudo = typeof ListadoCrudo.Type;

/** Una fila de «Características técnicas» de la ficha, con el texto de cada celda. */
export const FilaFicha = Schema.Struct({
  operador: Schema.String,
  referencia: Schema.String,
  bandaMhz: Schema.String,
});
export type FilaFicha = typeof FilaFicha.Type;

/** Una fila de «Niveles medidos en el entorno» de la ficha, con el texto de cada celda. */
export const FilaDeNiveles = Schema.Struct({
  distancia: Schema.String,
  acimut: Schema.String,
  valor: Schema.String,
});
export type FilaDeNiveles = typeof FilaDeNiveles.Type;

/**
 * Las dos tablas de una ficha tal como las escribe el registro, con el texto de cada celda sin
 * limpiar (ADR 0027). Con ellas se comparan dos lecturas de la ficha.
 */
export const FichaCruda = Schema.Struct({
  caracteristicas: Schema.Array(FilaFicha),
  niveles: Schema.Array(FilaDeNiveles),
});
export type FichaCruda = typeof FichaCruda.Type;

/**
 * Una estación base tal como sale del listado de una fuente, antes de leer su ficha. `crudo` es
 * lo que escribió el registro oficial; falta en las fuentes que no lo dan y en las observaciones
 * guardadas antes del ADR 0027.
 */
export const Registro = Schema.Struct({
  clave: Schema.String,
  compania: Compania,
  codigo: Schema.String,
  posicion: Coordenada,
  direccion: Schema.String,
  municipio: Schema.String,
  url: Schema.String,
  crudo: Schema.optionalKey(ListadoCrudo),
});
export type Registro = typeof Registro.Type;

/**
 * Entre dos lecturas del listado con la misma clave, la que se queda: la primera por lo que
 * escribió el registro. Así la que se guarda no depende del orden de los elementos, que el
 * registro puede cambiar de una petición a otra como cambia el de las filas de una ficha.
 */
export const laQueSeQueda = (a: ListadoCrudo, b: ListadoCrudo): ListadoCrudo =>
  (compararTexto(a.gisId, b.gisId) ||
    compararTexto(a.direccion, b.direccion) ||
    a.longitud - b.longitud ||
    a.latitud - b.latitud) <= 0
    ? a
    : b;

/**
 * Si de dos registros con la misma clave se queda `a` (`laQueSeQueda`). Uno sin lo que escribió
 * el registro, que no sale del listado, se queda si ya estaba.
 */
export const seQueda = (a: Registro, b: Registro): boolean =>
  a.crudo === undefined || b.crudo === undefined || laQueSeQueda(a.crudo, b.crudo) === a.crudo;

/** Lo que se lee de la ficha de una estación base. */
export interface FichaLeida {
  readonly bandas: ReadonlyArray<Banda>;
  /** Las medidas de exposición del ministerio, quizá ninguna. */
  readonly medidasDeExposicion: ReadonlyArray<MedidaDeExposicion>;
  /** Las tablas tal como las escribe el registro, si la fuente las da (ADR 0027). */
  readonly cruda?: FichaCruda;
  /** El SHA-256 de la página de la que sale, la del archivo de páginas (ADR 0027). */
  readonly pagina?: string;
}

/** Resultado de recorrer el listado entero de una fuente. */
export interface Listado {
  readonly registros: ReadonlyArray<Registro>;
  /** Elementos que no se han podido leer, con el motivo. No paran la ejecución. */
  readonly avisos: ReadonlyArray<string>;
  /**
   * Registros de otros titulares, que no son compañías de Celda pero que la ingesta guarda aparte
   * sin enseñarlos en el mapa: las licencias locales de 2,6 GHz y los de titulares que no
   * reconoce, que además son un aviso. Sin repetir.
   */
  readonly otros?: ReadonlyArray<RegistroDeOtroTitular>;
}

/**
 * Un registro del listado de otro titular, como lo escribe el registro: una licencia local
 * (`local`) o uno que Celda no reconoce.
 */
export interface RegistroDeOtroTitular {
  readonly titular: string;
  readonly local: boolean;
  readonly crudo: ListadoCrudo;
}

/** La fuente no ha respondido bien ni después de los reintentos. */
export class FuenteNoDisponible extends Schema.TaggedError<FuenteNoDisponible>()(
  "FuenteNoDisponible",
  { url: Schema.String, motivo: Schema.String },
) {}

/** La fuente ha respondido algo que el extractor no sabe leer. */
export class RespuestaInesperada extends Schema.TaggedError<RespuestaInesperada>()(
  "RespuestaInesperada",
  { url: Schema.String, motivo: Schema.String },
) {}

/**
 * El registro oficial no tiene ficha de la estación base, aunque su listado la incluya: su
 * página de detalle dice «Código de emplazamiento no válido». La estación base queda sin ficha en
 * el registro, y la ficha se vuelve a pedir con la espera de siempre por si el ministerio lo
 * arregla.
 */
export class SinFichaEnElRegistro extends Schema.TaggedError<SinFichaEnElRegistro>()(
  "SinFichaEnElRegistro",
  { url: Schema.String, motivo: Schema.String },
) {}

/** El `robots.txt` de la fuente prohíbe esa ruta a Celda. */
export class ProhibidoPorRobots extends Schema.TaggedError<ProhibidoPorRobots>()(
  "ProhibidoPorRobots",
  { url: Schema.String },
) {}

/**
 * La fuente está bloqueando a Celda: responde 401 o 403, o devuelve una página que no es lo que
 * se ha pedido, como un aviso de un cortafuegos. No se insiste: se deja de pedir hasta la noche
 * siguiente.
 */
export class FuenteBloqueada extends Schema.TaggedError<FuenteBloqueada>()("FuenteBloqueada", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

/**
 * La fuente pide que se espere: un 429, o un 503 con `Retry-After`. Si pide poco, el cliente
 * espera lo que pide y repite; si pide más, no lo dice o sigue pidiéndolo tras los reintentos,
 * no se insiste: se deja de pedir hasta la ejecución siguiente.
 */
export class FuentePideEsperar extends Schema.TaggedError<FuentePideEsperar>()(
  "FuentePideEsperar",
  { url: Schema.String, motivo: Schema.String },
) {}

/** La ejecución ha gastado todas las peticiones que tiene permitidas hacia la fuente. */
export class LimiteDePeticiones extends Schema.TaggedError<LimiteDePeticiones>()(
  "LimiteDePeticiones",
  { maximo: Schema.Int },
) {}

export type ErrorDeExtractor =
  | FuenteNoDisponible
  | FuenteBloqueada
  | FuentePideEsperar
  | RespuestaInesperada
  | SinFichaEnElRegistro
  | ProhibidoPorRobots
  | LimiteDePeticiones;

/** Texto de un error para el estado de la ingesta. */
export const describirError = (error: ErrorDeExtractor): string => {
  switch (error._tag) {
    case "FuenteNoDisponible":
    case "FuenteBloqueada":
    case "FuentePideEsperar":
    case "RespuestaInesperada":
    case "SinFichaEnElRegistro":
      return `${error._tag}: ${error.motivo} (${error.url})`;
    case "ProhibidoPorRobots":
      return `${error._tag}: ${error.url}`;
    case "LimiteDePeticiones":
      return `${error._tag}: ${error.maximo} peticiones`;
  }
};

/** Lo que devuelve una fuente al pedirle el listado de una caja, en una sola petición. */
export interface ListadoDeCaja {
  /** Sin repetir y ordenados por clave. */
  readonly registros: ReadonlyArray<Registro>;
  readonly avisos: ReadonlyArray<string>;
  /** Los registros de otros titulares, que no van al mapa (`Listado.otros`). */
  readonly otros?: ReadonlyArray<RegistroDeOtroTitular>;
  /**
   * Si la respuesta llega al tope de elementos de la fuente. Entonces le pueden faltar
   * registros sin que la fuente avise, y la caja hay que dividirla.
   */
  readonly enElTope: boolean;
  /** Bytes de la respuesta. */
  readonly bytes: number;
}

/**
 * Extractor de una fuente cuyo listado se pide por cajas y corta en un tope, como el registro
 * oficial. Qué cajas se piden lo decide el barrido por zonas (`barrido.ts`). Cada instancia vive
 * lo que dura una ejecución: su límite de peticiones cuenta desde que se construye la capa.
 */
export class ExtractorPorCajas extends Context.Service<
  ExtractorPorCajas,
  {
    readonly fuente: Fuente;
    /** El listado de una caja, bordes incluidos. */
    readonly caja: (caja: Caja) => Effect.Effect<ListadoDeCaja, ErrorDeExtractor>;
    /** Lee la ficha de un registro. */
    readonly ficha: (registro: Registro) => Effect.Effect<FichaLeida, ErrorDeExtractor>;
    /** Peticiones hechas a la fuente desde que se construyó, con los reintentos. */
    readonly peticiones: Effect.Effect<number>;
  }
>()("@celda/ingesta/extractor/ExtractorPorCajas") {}
