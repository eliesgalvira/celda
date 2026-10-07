import { Coordenada } from "@celda/dominio/area";
import type { HechoDeFicha } from "@celda/dominio/ficha";
import { Banda } from "@celda/dominio/banda";
import { MedidaDeExposicion } from "@celda/dominio/exposicion";
import { Observacion } from "@celda/dominio/observacion";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type FichaLeida, ListadoCrudo, Registro } from "./extractor.ts";
import { alDia, ObservacionGuardada, observacionDe, sinCrudo } from "./guardado.ts";
import { registroDeCrudo } from "./registro-oficial/normalizar.ts";

/**
 * El historial de cada registro (ADR 0027, fase 2): los hechos que la ingesta ve de cada registro
 * del ministerio, por su clave, en el orden en que los ve. Se escriben en la misma transacción que
 * la observación y nunca se cambian ni se borran. Cada hecho guarda lo que escribió el registro,
 * antes de que Celda lo limpie, así que la limpieza se puede cambiar sin tocar el historial.
 *
 * Tipos:
 *
 * - `conocido-antes`: el punto de partida. La observación que la base ya tenía al empezar el
 *   historial, con su fecha: desde cuándo dice lo que dice. Ya estaba en el registro en esa fecha,
 *   y quizá mucho antes: no es una fecha de alta.
 * - `alta`: el listado trae un registro que la base no tenía. Con `conocidoDesde`, el registro ya
 *   lo tenía y es Celda la que empieza a reconocer su titular.
 * - `listado`: el listado trae otra cosa de un registro, o Celda guarda por primera vez lo que
 *   escribió. `cambia` dice si cambia lo que Celda enseña.
 * - `vuelta`: el listado vuelve a traer un registro retirado.
 * - `ficha`: la ficha dice otra cosa, Celda guarda por primera vez lo que escribió o vuelve a
 *   tenerla tras no tenerla. `cambia` dice si cambian las bandas o las medidas que se enseñan. Lleva
 *   el SHA-256 de su página, cuyos bytes están en el archivo de páginas.
 * - `sin-ficha`: la ficha dice «Código de emplazamiento no válido».
 * - `retirada`: el registro falta en dos barridos seguidos de su zona.
 *
 * `antes`, si está, es la última vez que Celda vio lo anterior: lo nuevo llegó al registro entre
 * esa fecha y la del hecho.
 */

// ── Lectura de lo guardado ───────────────────────────────────────────────────────────────────

const Forma1 = Schema.Literal(1);
const Antes = Schema.optionalKey(Schema.Finite);
const { crudo: _crudo, ...camposDelRegistro } = Registro.fields;
const RegistroSinCrudo = Schema.Struct(camposDelRegistro);
const ListadoGuardado = Schema.Union([
  Schema.Struct({ crudo: ListadoCrudo }),
  Schema.Struct({ registro: RegistroSinCrudo }),
]);
const FichaGuardada = Schema.Union([
  Schema.Struct({ pagina: Schema.String }),
  Schema.Struct({
    leida: Schema.Struct({
      bandas: Schema.Array(Banda),
      medidasDeExposicion: Schema.Array(MedidaDeExposicion),
    }),
  }),
]);

/**
 * Las formas de cada tipo. Se leen sin aceptar claves de más, así que un hecho que no encaja en
 * una forma conocida falla en lugar de leerse a medias.
 */
const FORMAS = {
  "conocido-antes": Schema.Struct({ forma: Forma1, observacion: ObservacionGuardada }),
  alta: Schema.Struct({
    forma: Forma1,
    listado: ListadoGuardado,
    antes: Antes,
    conocidoDesde: Schema.optionalKey(Schema.Finite),
  }),
  listado: Schema.Struct({
    forma: Forma1,
    listado: ListadoGuardado,
    cambia: Schema.Boolean,
    antes: Antes,
  }),
  vuelta: Schema.Struct({
    forma: Forma1,
    listado: ListadoGuardado,
    cambia: Schema.Boolean,
    antes: Antes,
  }),
  ficha: Schema.Struct({
    forma: Forma1,
    ficha: FichaGuardada,
    cambia: Schema.Boolean,
    antes: Antes,
  }),
  "sin-ficha": Schema.Struct({ forma: Forma1, antes: Antes }),
  retirada: Schema.Struct({ forma: Forma1, antes: Antes }),
} as const;

type Formas = typeof FORMAS;

/** Un hecho leído de la base, con su forma comprobada. */
export type HechoLeido = {
  [T in keyof Formas]: {
    readonly tipo: T;
    readonly fecha: number;
    readonly datos: Formas[T]["Type"];
  };
}[keyof Formas];

const ESTRICTO = { onExcessProperty: "error" } as const;

const decodificadorDe = <S extends Schema.Top & { readonly DecodingServices: never }>(forma: S) =>
  Schema.decodeUnknownResult(Schema.fromJsonString(forma), ESTRICTO);

const DECODIFICADORES = {
  "conocido-antes": decodificadorDe(FORMAS["conocido-antes"]),
  alta: decodificadorDe(FORMAS.alta),
  listado: decodificadorDe(FORMAS.listado),
  vuelta: decodificadorDe(FORMAS.vuelta),
  ficha: decodificadorDe(FORMAS.ficha),
  "sin-ficha": decodificadorDe(FORMAS["sin-ficha"]),
  retirada: decodificadorDe(FORMAS.retirada),
};

const conMotivo = <A>(
  tipo: string,
  fecha: number,
  leido: Result.Result<A, Schema.SchemaError>,
): Result.Result<A, string> =>
  Result.mapError(
    leido,
    (error) => `hecho ${tipo} del ${fecha} que no encaja en su forma: ${error.message}`,
  );

/** Lee un hecho guardado, o dice por qué no encaja en ninguna forma conocida. */
export const leerHecho = (
  tipo: string,
  fecha: number,
  datos: string,
): Result.Result<HechoLeido, string> => {
  switch (tipo) {
    case "conocido-antes":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "alta":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "listado":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "vuelta":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "ficha":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "sin-ficha":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    case "retirada":
      return Result.map(conMotivo(tipo, fecha, DECODIFICADORES[tipo](datos)), (d) => ({
        tipo,
        fecha,
        datos: d,
      }));
    default:
      return Result.fail(`tipo de hecho desconocido: ${tipo}`);
  }
};

// ── Repetir el historial ─────────────────────────────────────────────────────────────────────

/** Lo que se publica de un registro, el resultado de repetir su historial. */
export interface RegistroRepetido {
  readonly observacion: Observacion;
  readonly retiradaEn: number | null;
}

const registroDelListado = (
  listado: typeof ListadoGuardado.Type,
): Result.Result<Registro, string> => {
  if ("registro" in listado) return Result.succeed(listado.registro);
  const leido = registroDeCrudo(listado.crudo);
  switch (leido.tipo) {
    case "registro":
      return Result.succeed(leido.registro);
    case "otro-titular":
      return Result.fail(`${listado.crudo.id} es de otro titular, ${leido.titular}`);
    case "aviso":
      return Result.fail(leido.aviso);
  }
};

/** Lo que se lee hoy de la página de una ficha del archivo, por su SHA-256. */
export type FichasDeLasPaginas = ReadonlyMap<
  string,
  Pick<FichaLeida, "bandas" | "medidasDeExposicion">
>;

const leidaDeLaFicha = (ficha: typeof FichaGuardada.Type, paginas: FichasDeLasPaginas) => {
  if ("leida" in ficha) return Result.succeed(ficha.leida);
  const leida = paginas.get(ficha.pagina);
  return leida === undefined
    ? Result.fail(`la página ${ficha.pagina} no está en el archivo o no se lee`)
    : Result.succeed(leida);
};

/** Las páginas del archivo que hacen falta para repetir unos hechos. */
export const paginasDe = (hechos: ReadonlyArray<HechoLeido>): ReadonlyArray<string> =>
  hechos.flatMap((h) =>
    h.tipo === "ficha" && "pagina" in h.datos.ficha ? [h.datos.ficha.pagina] : [],
  );

/**
 * Lo que dice de un registro su historial, repitiendo sus hechos en orden con la limpieza y la
 * lectura de hoy: las fichas se vuelven a leer de sus páginas del archivo (`paginas`). Tiene que
 * coincidir con lo que publica la tabla `observaciones` (`registroPublicado`): lo comprueba la
 * orden `comprobar-historial`.
 */
export const repetirHechos = (
  fuente: Observacion["fuente"],
  hechos: ReadonlyArray<HechoLeido>,
  paginas: FichasDeLasPaginas,
): Result.Result<RegistroRepetido, string> => {
  let estado: ObservacionGuardada | undefined;
  for (const hecho of hechos) {
    switch (hecho.tipo) {
      case "conocido-antes":
        estado = hecho.datos.observacion;
        break;
      case "alta": {
        const registro = registroDelListado(hecho.datos.listado);
        if (Result.isFailure(registro)) return Result.fail(registro.failure);
        estado = {
          ...registro.success,
          fuente,
          afirma: "presente",
          bandas: [],
          fecha: hecho.fecha,
          fichaLeidaEn: null,
          ausencias: 0,
          retiradaEn: null,
        };
        break;
      }
      case "listado":
      case "vuelta": {
        if (estado === undefined) return Result.fail(`${hecho.tipo} sin alta`);
        const registro = registroDelListado(hecho.datos.listado);
        if (Result.isFailure(registro)) return Result.fail(registro.failure);
        const { cambia } = hecho.datos;
        const siguiente: ObservacionGuardada = {
          ...sinCrudo(estado),
          ...registro.success,
          fecha: cambia ? hecho.fecha : estado.fecha,
          retiradaEn: null,
        };
        estado = cambia ? sinMarca(siguiente) : siguiente;
        break;
      }
      case "ficha": {
        if (estado === undefined) return Result.fail("ficha sin alta");
        const leida = leidaDeLaFicha(hecho.datos.ficha, paginas);
        if (Result.isFailure(leida)) return Result.fail(leida.failure);
        estado = sinMarca({
          ...estado,
          bandas: leida.success.bandas,
          medidasDeExposicion: leida.success.medidasDeExposicion,
          fecha: hecho.datos.cambia ? hecho.fecha : estado.fecha,
        });
        break;
      }
      case "sin-ficha":
        if (estado === undefined) return Result.fail("sin-ficha sin alta");
        estado = { ...estado, sinFichaEnRegistro: hecho.fecha };
        break;
      case "retirada":
        if (estado === undefined) return Result.fail("retirada sin alta");
        estado = { ...estado, retiradaEn: hecho.fecha };
        break;
    }
  }
  if (estado === undefined) return Result.fail("sin hechos");
  return Result.succeed(registroPublicado(estado));
};

const sinMarca = (o: ObservacionGuardada): ObservacionGuardada => {
  const { sinFichaEnRegistro: _marca, ...resto } = o;
  return resto;
};

const mismaPosicion = Schema.toEquivalence(Coordenada);
const mismasBandas = Schema.toEquivalence(Schema.Array(Banda));
const mismasMedidas = Schema.toEquivalence(Schema.UndefinedOr(Schema.Array(MedidaDeExposicion)));

/** Cada campo que se publica de una observación, con cómo se comparan dos. */
const CAMPOS: ReadonlyArray<readonly [string, (a: Observacion, b: Observacion) => boolean]> = [
  ["fuente", (a, b) => a.fuente === b.fuente],
  ["clave", (a, b) => a.clave === b.clave],
  ["compania", (a, b) => a.compania === b.compania],
  ["codigo", (a, b) => a.codigo === b.codigo],
  ["posicion", (a, b) => mismaPosicion(a.posicion, b.posicion)],
  ["direccion", (a, b) => a.direccion === b.direccion],
  ["municipio", (a, b) => a.municipio === b.municipio],
  ["bandas", (a, b) => mismasBandas(a.bandas, b.bandas)],
  ["url", (a, b) => a.url === b.url],
  ["fecha", (a, b) => a.fecha === b.fecha],
  ["afirma", (a, b) => a.afirma === b.afirma],
  ["sinFichaEnRegistro", (a, b) => a.sinFichaEnRegistro === b.sinFichaEnRegistro],
  ["medidasDeExposicion", (a, b) => mismasMedidas(a.medidasDeExposicion, b.medidasDeExposicion)],
];

/**
 * Los campos en que no coinciden dos registros publicados, vacío si coinciden: lo que la orden
 * `comprobar-historial` dice de cada registro cuyo historial no da lo que publica la tabla.
 */
export const camposDistintos = (
  a: RegistroRepetido,
  b: RegistroRepetido,
): ReadonlyArray<string> => [
  ...CAMPOS.flatMap(([campo, iguales]) => (iguales(a.observacion, b.observacion) ? [] : [campo])),
  ...(a.retiradaEn === b.retiradaEn ? [] : ["retiradaEn"]),
];

/** Lo que se publica de una observación guardada, con la limpieza de hoy. */
export const registroPublicado = (o: ObservacionGuardada): RegistroRepetido => ({
  observacion: observacionDe(alDia(o)),
  retiradaEn: o.retiradaEn,
});

// ── Lo que se publica del historial ──────────────────────────────────────────────────────────

/** Lo que la base da de un hecho para publicarlo, sin leer lo que guarda entero. */
export interface HechoParaLaFicha {
  readonly tipo: string;
  readonly fecha: number;
  readonly antes: number | null;
  readonly cambia: boolean | null;
  readonly conocidoDesde: number | null;
}

/**
 * Lo que la ficha publicada cuenta de un hecho (`HechoDeFicha` de `@celda/dominio/ficha`):
 *
 * - nada si no cambia nada que se enseñe, como la primera vez que Celda guarda lo que escribió el
 *   registro sin que cambie;
 * - de un alta de un titular que Celda empieza a reconocer, que estaba en el registro antes;
 * - de una vuelta con otro listado, la vuelta y el cambio.
 */
export const hechosDeFicha = (hecho: HechoParaLaFicha): ReadonlyArray<HechoDeFicha> => {
  const { fecha } = hecho;
  const conAntes = (tipo: HechoDeFicha["tipo"]): HechoDeFicha =>
    hecho.antes === null ? { tipo, fecha } : { tipo, fecha, antes: hecho.antes };
  switch (hecho.tipo) {
    case "conocido-antes":
      return [{ tipo: "en-el-registro-antes", fecha }];
    case "alta":
      return hecho.conocidoDesde === null
        ? [conAntes("alta")]
        : [{ tipo: "en-el-registro-antes", fecha: hecho.conocidoDesde }];
    case "listado":
      return hecho.cambia === true ? [conAntes("cambio-de-listado")] : [];
    case "ficha":
      return hecho.cambia === true ? [conAntes("cambio-de-ficha")] : [];
    case "vuelta":
      return hecho.cambia === true
        ? [conAntes("vuelta"), conAntes("cambio-de-listado")]
        : [conAntes("vuelta")];
    case "sin-ficha":
      return [conAntes("sin-ficha")];
    case "retirada":
      return [conAntes("retirada")];
    default:
      return [];
  }
};
