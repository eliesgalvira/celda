import type { Banda } from "@celda/dominio/banda";
import type { Fuente } from "@celda/dominio/observacion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Extractor, type Listado, type Registro, RespuestaInesperada } from "../extractor.ts";
import {
  bandasDeFicha,
  bandasDeFilas,
  listadoDeElementos,
  RespuestaListado,
} from "../registro-oficial/normalizar.ts";
import { decodificarLatin1 } from "../texto.ts";

/** Lo que devolvería una fuente: su listado y las bandas de cada ficha, por clave. */
export interface FuenteGrabada {
  readonly listado: Listado;
  readonly fichas: ReadonlyMap<string, ReadonlyArray<Banda>>;
}

/**
 * Extractor de prueba que devuelve una fuente grabada sin hacer peticiones. Una ficha que no
 * está grabada falla como fallaría una ficha ilegible de la fuente real; `muestraCampusNord`
 * graba todas.
 */
export const capaGrabada = (fuente: Fuente, grabada: FuenteGrabada): Layer.Layer<Extractor> =>
  Layer.succeed(
    Extractor,
    Extractor.of({
      fuente,
      listado: Effect.succeed(grabada.listado),
      ficha: (registro: Registro) => {
        const bandas = grabada.fichas.get(registro.clave);
        return bandas === undefined
          ? Effect.fail(new RespuestaInesperada({ url: registro.url, motivo: "ficha no grabada" }))
          : Effect.succeed(bandas);
      },
    }),
  );

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
 * fichas. Las fichas en HTML pasan por el mismo analizador que en producción;
 * las demás salen de su conversión a JSON en la investigación.
 */
export const muestraCampusNord = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const carpeta = yield* carpetaDeMuestras;
  const leer = (nombre: string) =>
    Effect.map(fs.readFile(path.join(carpeta, nombre)), decodificarLatin1);

  const respuesta = yield* decodificarListado(yield* leer("geojson-campus-nord.iso-8859-1.json"));
  const listado = listadoDeElementos("features" in respuesta ? respuesta.features : []);

  const fichas = new Map<string, ReadonlyArray<Banda>>();
  const json = yield* decodificarFichas(
    new TextDecoder().decode(yield* fs.readFile(path.join(carpeta, "fichas-campus-nord.json"))),
  );
  for (const ficha of json.fichas) {
    const bandas = bandasDeFilas(
      ficha.caracteristicas.map((c) => ({
        operador: c.operador,
        referencia: c.referencia,
        bandaMhz: c.banda_mhz,
      })),
    );
    if (Result.isSuccess(bandas)) {
      fichas.set(ficha.codigo, bandas.success);
    }
  }
  for (const [clave, fichero] of FICHAS_HTML) {
    const bandas = bandasDeFicha(yield* leer(fichero));
    if (Result.isSuccess(bandas)) {
      fichas.set(clave, bandas.success);
    }
  }
  // De los 40 registros hay 23 fichas grabadas; las demás cuentan como fichas sin bandas.
  for (const registro of listado.registros) {
    if (!fichas.has(registro.clave)) {
      fichas.set(registro.clave, []);
    }
  }
  const grabada: FuenteGrabada = { listado, fichas };
  return grabada;
});

/** Bytes de una respuesta grabada, para las pruebas del extractor con un cliente HTTP falso. */
export const leerMuestra = (nombre: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFile(path.join(yield* carpetaDeMuestras, nombre));
  });
