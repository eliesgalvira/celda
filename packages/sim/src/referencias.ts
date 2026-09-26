import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { Malla, Resultado, Simulacion } from "./simulacion.ts";

/**
 * Los ficheros de resultados de referencia (ADR 0005): uno por simulación y versión, en
 * `src/referencia/<id>@<version>.json`. Guardan los casos con sus parámetros, su malla y lo que
 * dio la implementación en TypeScript, que es la referencia, junto con la tolerancia con que se
 * comparan. Otra implementación de la misma versión tiene que dar lo mismo dentro de esa
 * tolerancia.
 */

/** Un caso de una simulación: parámetros y malla con nombre. */
export interface CasoDeReferencia<P> {
  readonly nombre: string;
  readonly params: P;
  readonly malla: Malla;
}

const CasoGuardado = Schema.Struct({
  nombre: Schema.String,
  params: Schema.Json,
  malla: Schema.Struct({
    este: Schema.Array(Schema.Finite),
    norte: Schema.Array(Schema.Finite),
  }),
  resultado: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
});

const Fichero = Schema.Struct({
  simulacion: Schema.String,
  version: Schema.String,
  /** Diferencia absoluta máxima aceptada en cada valor del resultado. */
  tolerancia: Schema.Finite,
  casos: Schema.Array(CasoGuardado),
});
type Fichero = typeof Fichero.Type;

/** Con sangría, para revisar el fichero en cada cambio. */
const FicheroJson = Schema.fromJsonString(Fichero, { space: 2 });
const leerFichero = Schema.decodeEffect(FicheroJson);
const escribirFichero = Schema.encodeEffect(FicheroJson);

/** Dónde está el fichero de referencia de una versión. */
export const ficheroDeReferencia = Effect.fn("referencias.fichero")(function* (
  id: string,
  version: string,
) {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(new URL(`./referencia/${id}@${version}.json`, import.meta.url));
});

const aMalla = (malla: {
  readonly este: ReadonlyArray<number>;
  readonly norte: ReadonlyArray<number>;
}): Malla => ({
  este: Float64Array.from(malla.este),
  norte: Float64Array.from(malla.norte),
});

/** Las diferencias entre un resultado y el guardado, como frases; vacía si coinciden. */
const diferencias = (
  caso: string,
  obtenido: Resultado,
  guardado: Readonly<Record<string, ReadonlyArray<number>>>,
  tolerancia: number,
): ReadonlyArray<string> => {
  const campos = new Set([...Object.keys(obtenido), ...Object.keys(guardado)]);
  return [...campos].flatMap((campo) => {
    const a = obtenido[campo];
    const b = guardado[campo];
    if (a === undefined || b === undefined) {
      return [`${caso}: el campo «${campo}» solo está en uno de los dos resultados`];
    }
    if (a.length !== b.length) {
      return [`${caso}: «${campo}» tiene ${a.length} valores y la referencia ${b.length}`];
    }
    const fuera = b.findIndex(
      (valor, i) => !(Math.abs((a[i] ?? Number.NaN) - valor) <= tolerancia),
    );
    return fuera === -1
      ? []
      : [
          `${caso}: «${campo}»[${fuera}] vale ${a[fuera]} y la referencia ${b[fuera]} (tolerancia ${tolerancia})`,
        ];
  });
};

const guardar = <P, R extends Resultado>(
  simulacion: Simulacion<P, R>,
  casos: ReadonlyArray<CasoDeReferencia<P>>,
  tolerancia: number,
) =>
  Effect.gen(function* () {
    const encode = Schema.encodeEffect(simulacion.params);
    const guardados = yield* Effect.forEach(casos, (caso) =>
      Effect.map(encode(caso.params), (params) => ({
        nombre: caso.nombre,
        params,
        malla: { este: [...caso.malla.este], norte: [...caso.malla.norte] },
        resultado: Object.fromEntries(
          Object.entries(simulacion.ejecutar(caso.params, caso.malla)).map(([campo, valores]) => [
            campo,
            Array.from(valores, Number),
          ]),
        ),
      })),
    );
    const fichero: Fichero = {
      simulacion: simulacion.id,
      version: simulacion.version,
      tolerancia,
      casos: guardados,
    };
    return `${yield* escribirFichero(fichero)}\n`;
  });

/**
 * Compara una simulación con su fichero de referencia y devuelve las diferencias (vacía si
 * coincide). Si el fichero de su versión no existe, lo escribe con `casos` y `tolerancia` cuando
 * `CELDA_REFERENCIAS=escribir` (`pnpm --filter @celda/sim run referencias`); si no, lo cuenta como
 * diferencia. Nunca reescribe un fichero que ya existe: un cambio en lo que calcula la simulación
 * pide subir su versión.
 */
export const compararConReferencia = <P, R extends Resultado>(
  simulacion: Simulacion<P, R>,
  casos: ReadonlyArray<CasoDeReferencia<P>>,
  tolerancia: number,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ruta = yield* ficheroDeReferencia(simulacion.id, simulacion.version);
    if (!(yield* fs.exists(ruta))) {
      const modo = yield* Config.String("CELDA_REFERENCIAS").pipe(Config.withDefault(""));
      if (modo !== "escribir") {
        return [
          `Falta ${ruta}. Genéralo con \`pnpm --filter @celda/sim run referencias\` y revísalo.`,
        ];
      }
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(ruta), { recursive: true });
      yield* fs.writeFileString(ruta, yield* guardar(simulacion, casos, tolerancia));
    }
    const fichero = yield* leerFichero(yield* fs.readFileString(ruta));
    const nombres = casos.map((c) => c.nombre).join(", ");
    const guardados = fichero.casos.map((c) => c.nombre).join(", ");
    if (nombres !== guardados) {
      return [
        `Los casos de la prueba (${nombres}) no son los del fichero (${guardados}). Si lo que calcula ha cambiado, sube la versión.`,
      ];
    }
    const decode = Schema.decodeEffect(simulacion.params);
    const porCaso = yield* Effect.forEach(fichero.casos, (caso) =>
      Effect.map(decode(caso.params), (params) =>
        diferencias(
          caso.nombre,
          simulacion.ejecutar(params, aMalla(caso.malla)),
          caso.resultado,
          fichero.tolerancia,
        ),
      ),
    );
    return porCaso.flat();
  });
