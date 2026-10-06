import { compararTexto } from "@celda/dominio/banda";
import type { Fuente } from "@celda/dominio/observacion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  type ErrorDeExtractor,
  ExtractorPorCajas,
  type FichaLeida,
  type Listado,
  type ListadoDeCaja,
  type Registro,
  RespuestaInesperada,
  SinFichaEnElRegistro,
} from "../extractor.ts";
import {
  AVISO_SIN_FICHA,
  bandasDeFilas,
  leerFicha,
  listadoDeElementos,
  medidasDeFilas,
  RespuestaListado,
  TOPE_LISTADO,
} from "../registro-oficial/normalizar.ts";
import type { Respondedor } from "./http.ts";
import { decodificarLatin1 } from "../texto.ts";
import { type Caja, enCaja } from "../zona.ts";

/** Lo que devolvería una fuente: su listado y lo que se lee de cada ficha, por clave. */
export interface FuenteGrabada {
  readonly listado: Listado;
  readonly fichas: ReadonlyMap<string, FichaLeida>;
  /**
   * Claves cuya ficha dice «Código de emplazamiento no válido», como la de `061723` de Vodafone
   * y la de `CLMR6422A` de Orange el 02/10/2026: el registro no tiene su ficha, aunque las liste.
   */
  readonly sinFicha?: ReadonlySet<string>;
}

/**
 * La ficha de un registro en una fuente grabada. Una ficha que no está grabada falla como
 * fallaría una ficha ilegible de la fuente real; `muestraCampusNord` graba todas.
 */
const fichaGrabada =
  (grabada: FuenteGrabada) =>
  (registro: Registro): Effect.Effect<FichaLeida, ErrorDeExtractor> => {
    if (grabada.sinFicha?.has(registro.clave) === true) {
      return Effect.fail(new SinFichaEnElRegistro({ url: registro.url, motivo: AVISO_SIN_FICHA }));
    }
    const leida = grabada.fichas.get(registro.clave);
    return leida === undefined
      ? Effect.fail(new RespuestaInesperada({ url: registro.url, motivo: "ficha no grabada" }))
      : Effect.succeed(leida);
  };

/** Bytes por registro en el listado del registro oficial (investigación 08). */
const BYTES_POR_REGISTRO = 617;

/**
 * `ExtractorPorCajas` de prueba que contesta como el geoportal a partir de una fuente grabada:
 * los registros que caen en la caja, bordes incluidos, ordenados por clave y cortados en `tope`
 * sin avisar más que con `enElTope`. Cada caja y cada ficha cuentan como una petición.
 */
export const capaGrabadaPorCajas = (
  fuente: Fuente,
  grabada: FuenteGrabada,
  tope: number = TOPE_LISTADO,
): Layer.Layer<ExtractorPorCajas> =>
  Layer.effect(
    ExtractorPorCajas,
    Effect.gen(function* () {
      const hechas = yield* Ref.make(0);
      const registros = grabada.listado.registros.toSorted((a, b) =>
        compararTexto(a.clave, b.clave),
      );
      return ExtractorPorCajas.of({
        fuente,
        caja: (caja: Caja) =>
          Effect.as(
            Ref.update(hechas, (n) => n + 1),
            listadoEnCaja(registros, caja, tope),
          ),
        ficha: (registro) =>
          Effect.andThen(
            Ref.update(hechas, (n) => n + 1),
            fichaGrabada(grabada)(registro),
          ),
        peticiones: Ref.get(hechas),
      });
    }),
  );

/** Lo que daría el geoportal para una caja con estos registros, ordenados por clave. */
const listadoEnCaja = (
  registros: ReadonlyArray<Registro>,
  caja: Caja,
  tope: number,
): ListadoDeCaja => {
  const dentro = registros.filter((r) => enCaja(caja, r.posicion.longitud, r.posicion.latitud));
  const devueltos = dentro.slice(0, tope);
  return {
    registros: devueltos,
    avisos: [],
    enElTope: devueltos.length >= tope,
    bytes: devueltos.length === 0 ? 2 : devueltos.length * BYTES_POR_REGISTRO,
  };
};

/** Carpeta de las respuestas grabadas en la investigación del registro oficial. */
const carpetaDeMuestras = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(
    yield* path.fromFileUrl(new URL(".", import.meta.url)),
    "../../../../docs/investigacion/muestras",
  );
});

const FichasEnJson = Schema.fromJsonString(
  Schema.Struct({
    fichas: Schema.Array(
      Schema.Struct({
        codigo: Schema.String,
        caracteristicas: Schema.Array(
          Schema.Struct({
            operador: Schema.String,
            referencia: Schema.String,
            banda_mhz: Schema.String,
          }),
        ),
        niveles_medidos: Schema.Array(
          Schema.Struct({
            distancia_m: Schema.String,
            acimut_grados: Schema.String,
            valor_uw_cm2: Schema.String,
          }),
        ),
      }),
    ),
  }),
);
const decodificarFichas = Schema.decodeUnknownEffect(FichasEnJson);
const decodificarListado = Schema.decodeUnknownEffect(RespuestaListado);

/** Fichas grabadas en HTML, por clave del registro. */
const FICHAS_HTML: ReadonlyArray<readonly [string, string]> = [
  ["ORANGE ESPAGNE, S.A.U. - CATR0228A", "detalle-orange-CATR0228A.iso-8859-1.html"],
  ["TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942", "detalle-telefonica-0800942.iso-8859-1.html"],
];

/**
 * El registro oficial grabado en Campus Nord el 26/09/2026: el listado de 40 elementos y 23
 * fichas, con sus bandas y sus medidas de exposición. Las fichas en HTML pasan por el mismo
 * analizador que en producción; las demás salen de su conversión a JSON en la investigación.
 */
export const muestraCampusNord = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const carpeta = yield* carpetaDeMuestras;
  const leer = (nombre: string) =>
    Effect.map(fs.readFile(path.join(carpeta, nombre)), decodificarLatin1);

  const respuesta = yield* decodificarListado(yield* leer("geojson-campus-nord.iso-8859-1.json"));
  const listado = listadoDeElementos("features" in respuesta ? respuesta.features : []);

  const fichas = new Map<string, FichaLeida>();
  const json = yield* decodificarFichas(
    new TextDecoder().decode(yield* fs.readFile(path.join(carpeta, "fichas-campus-nord.json"))),
  );
  for (const ficha of json.fichas) {
    const leida = Result.all({
      bandas: bandasDeFilas(
        ficha.caracteristicas.map((c) => ({
          operador: c.operador,
          referencia: c.referencia,
          bandaMhz: c.banda_mhz,
        })),
      ),
      medidasDeExposicion: medidasDeFilas(
        ficha.niveles_medidos.map((n) => ({
          distancia: n.distancia_m,
          acimut: n.acimut_grados,
          valor: n.valor_uw_cm2,
        })),
      ),
    });
    if (Result.isSuccess(leida)) {
      fichas.set(ficha.codigo, leida.success);
    }
  }
  for (const [clave, fichero] of FICHAS_HTML) {
    const leida = leerFicha(yield* leer(fichero));
    if (Result.isSuccess(leida)) {
      fichas.set(clave, leida.success);
    }
  }
  // De los 40 registros hay 23 fichas grabadas; las demás cuentan como fichas sin bandas ni medidas.
  for (const registro of listado.registros) {
    if (!fichas.has(registro.clave)) {
      fichas.set(registro.clave, { bandas: [], medidasDeExposicion: [] });
    }
  }
  const grabada: FuenteGrabada = { listado, fichas };
  return grabada;
});

/**
 * Listado del registro oficial grabado el 28/09/2026 en una ciudad (`muestras/espana/listado-*`).
 * Junta las cajas de la ciudad sin repetir elementos y va en UTF-8, con el texto tal como llegó:
 * el normalizador lo repara como en producción.
 */
export const listadoGrabado = (nombre: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bytes = yield* fs.readFile(
      path.join(yield* carpetaDeMuestras, "espana", `listado-${nombre}-2026-09-28.json`),
    );
    const respuesta = yield* decodificarListado(new TextDecoder().decode(bytes));
    return listadoDeElementos("features" in respuesta ? respuesta.features : []);
  });

/** Bytes de una respuesta grabada, para las pruebas del extractor con un cliente HTTP falso. */
export const leerMuestra = (nombre: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFile(path.join(yield* carpetaDeMuestras, nombre));
  });

const ListadoCrudo = Schema.fromJsonString(
  Schema.Struct({ features: Schema.Array(Schema.Unknown) }),
);
const ElementoConPosicion = Schema.Struct({
  id: Schema.String,
  geometry: Schema.Struct({ coordinates: Schema.Tuple([Schema.Finite, Schema.Finite]) }),
});
const decodificarListadoCrudo = Schema.decodeEffect(ListadoCrudo);
const decodificarElemento = Schema.decodeUnknownEffect(ElementoConPosicion);

/** Un elemento de un listado grabado, tal como llegó, con su `id` y su posición. */
export interface ElementoGrabado {
  readonly crudo: unknown;
  readonly id: string;
  readonly longitud: number;
  readonly latitud: number;
}

/** Bytes en ISO-8859-1, como los manda el geoportal. */
const latin1 = (texto: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(texto, (caracter) => caracter.charCodeAt(0));

/**
 * El geoportal con un listado grabado (`muestras/espana/listado-*`), para el cliente HTTP de
 * prueba: contesta el listado de cualquier caja con los elementos grabados que caen en ella,
 * bordes incluidos, ordenados por `id` y cortados en 1000 sin avisar, como el de verdad. Una caja
 * sin elementos da `{}`, y `robots.txt` no existe.
 */
export const geoportalGrabado = (nombre: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bytes = yield* fs.readFile(
      path.join(yield* carpetaDeMuestras, "espana", `listado-${nombre}-2026-09-28.json`),
    );
    const { features } = yield* decodificarListadoCrudo(new TextDecoder().decode(bytes));
    const leidos = yield* Effect.forEach(features, (crudo) =>
      Effect.map(decodificarElemento(crudo), ({ id, geometry }): ElementoGrabado => ({
        crudo,
        id,
        longitud: geometry.coordinates[0],
        latitud: geometry.coordinates[1],
      })),
    );
    const elementos = leidos.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const responder: Respondedor = (url) => {
      if (url.pathname === "/robots.txt") return { estado: 404, cuerpo: "" };
      const [oeste = 0, sur = 0, este = 0, norte = 0] = (url.searchParams.get("bbox") ?? "")
        .split(",")
        .map(Number);
      const dentro = elementos
        .filter((e) => enCaja([oeste, sur, este, norte], e.longitud, e.latitud))
        .slice(0, TOPE_LISTADO)
        .map((e) => e.crudo);
      const cuerpo =
        dentro.length === 0
          ? "{}"
          : JSON.stringify({ type: "FeatureCollection", features: dentro });
      return { estado: 200, cuerpo: latin1(cuerpo) };
    };
    return { responder, elementos };
  });
