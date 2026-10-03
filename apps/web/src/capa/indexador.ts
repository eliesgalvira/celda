import {
  type CapaDeProvincia,
  capaConNombresDeLugar,
  leerCapaDeProvincia,
} from "@celda/dominio/provincias";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  type Indice,
  type IndiceSerializado,
  type IndicesDeCapa,
  indexarCapa,
  indicesDeCapa,
  rehidratarIndice,
  serializarIndice,
} from "./indice.ts";

/** La capa de una provincia no se ha podido leer o indexar. */
export class IndiceFallido extends Schema.TaggedError<IndiceFallido>()("IndiceFallido", {
  provincia: Schema.String,
  motivo: Schema.String,
}) {}

/** Una capa de provincia leída, con sus índices listos para agrupar. */
export interface ProvinciaIndexada {
  readonly capa: CapaDeProvincia;
  readonly indices: IndicesDeCapa<Indice>;
}

/**
 * Lee la capa de una provincia e indexa sus emplazamientos (ADR 0016). En el navegador lo hace un
 * Worker: analizar el JSON y agrupar con supercluster no bloquean el mapa, y aquí solo se
 * rehidratan los índices.
 */
export class IndexadorDeProvincias extends Context.Service<
  IndexadorDeProvincias,
  {
    readonly indexar: (
      provincia: string,
      texto: string,
    ) => Effect.Effect<ProvinciaIndexada, IndiceFallido>;
  }
>()("@celda/web/capa/indexador/IndexadorDeProvincias") {}

/** Lo que se le pide al Worker. */
export interface SolicitudDeIndice {
  readonly numero: number;
  readonly provincia: string;
  readonly texto: string;
}

/** Lo que contesta el Worker: la capa leída y sus índices serializados, o por qué no. */
export type RespuestaDeIndice =
  | {
      readonly numero: number;
      readonly tipo: "lista";
      readonly capa: CapaDeProvincia;
      readonly todos: IndiceSerializado;
      readonly fuera: IndiceSerializado | undefined;
      /** Por nivel de municipios, el de los que no van en zona (`IndicesDeCapa`). */
      readonly fueraDeZonas: ReadonlyArray<IndiceSerializado | undefined>;
    }
  | { readonly numero: number; readonly tipo: "fallo"; readonly motivo: string };

/** Una respuesta del Worker con los búferes que se transfieren con ella. */
export interface RespuestaParaEnviar {
  readonly respuesta: RespuestaDeIndice;
  readonly transferibles: ReadonlyArray<ArrayBuffer>;
}

/** Lee la capa de una provincia con el nombre de lugar de sus municipios, el que se enseña. */
const leerCapa = (texto: string, provincia: string) =>
  Result.map(leerCapaDeProvincia(texto, provincia), capaConNombresDeLugar);

/**
 * Lo que hace el Worker con una solicitud: leer la capa, indexarla y serializar los índices. Los
 * búferes de `transferibles` se transfieren con la respuesta.
 */
export const atenderIndice = (solicitud: SolicitudDeIndice): RespuestaParaEnviar => {
  const leida = leerCapa(solicitud.texto, solicitud.provincia);
  if (Result.isFailure(leida)) {
    return {
      respuesta: { numero: solicitud.numero, tipo: "fallo", motivo: leida.failure.motivo },
      transferibles: [],
    };
  }
  const capa = leida.success;
  const indices = indexarCapa(capa.emplazamientos, capa.barrios.length > 0, capa.municipios);
  const todos = serializarIndice(indices.todos);
  const fuera = indices.fuera === undefined ? undefined : serializarIndice(indices.fuera);
  const fueraDeZonas = indices.fueraDeZonas.map((indice) =>
    indice === undefined ? undefined : serializarIndice(indice),
  );
  return {
    respuesta: {
      numero: solicitud.numero,
      tipo: "lista",
      capa,
      todos: todos.serializado,
      fuera: fuera?.serializado,
      fueraDeZonas: fueraDeZonas.map((indice) => indice?.serializado),
    },
    transferibles: [
      ...todos.transferibles,
      ...(fuera?.transferibles ?? []),
      ...fueraDeZonas.flatMap((indice) => indice?.transferibles ?? []),
    ],
  };
};

/** Rehidrata los índices de una respuesta del Worker. */
const indexadaDe = (
  respuesta: Extract<RespuestaDeIndice, { readonly tipo: "lista" }>,
): ProvinciaIndexada => {
  const { capa } = respuesta;
  const posiciones = indicesDeCapa(
    capa.emplazamientos,
    respuesta.fuera !== undefined,
    capa.municipios,
  );
  return {
    capa,
    indices: {
      todos: rehidratarIndice(respuesta.todos, posiciones.todos),
      fuera:
        respuesta.fuera === undefined
          ? undefined
          : rehidratarIndice(respuesta.fuera, posiciones.fuera ?? []),
      fueraDeZonas: respuesta.fueraDeZonas.map((serializado, i) =>
        serializado === undefined
          ? undefined
          : rehidratarIndice(serializado, posiciones.fueraDeZonas[i] ?? []),
      ),
    },
  };
};

/**
 * El indexador en el mismo hilo, sin serializar nada: el de las pruebas que no miran el Worker y
 * el de Node.
 */
export const indexadorEnHilo = Layer.succeed(
  IndexadorDeProvincias,
  IndexadorDeProvincias.of({
    indexar: (provincia, texto) =>
      Effect.suspend(() => {
        const leida = leerCapa(texto, provincia);
        if (Result.isFailure(leida)) {
          return Effect.fail(new IndiceFallido({ provincia, motivo: leida.failure.motivo }));
        }
        const capa = leida.success;
        return Effect.succeed({
          capa,
          indices: indexarCapa(capa.emplazamientos, capa.barrios.length > 0, capa.municipios),
        });
      }),
  }),
);

/**
 * Lo que el indexador necesita de un Worker. En el navegador lo da `new Worker(...)`; en las
 * pruebas, uno de prueba que contesta en otra tarea.
 */
export interface PuertoIndexador {
  readonly enviar: (solicitud: SolicitudDeIndice) => void;
  /** Registra quién recibe las respuestas y los fallos del Worker. Se llama una vez. */
  readonly escuchar: (
    alResponder: (respuesta: RespuestaDeIndice) => void,
    alFallar: (motivo: string) => void,
  ) => void;
  readonly terminar: () => void;
}

/** El Worker se ha caído con solicitudes pendientes. */
interface WorkerCaido {
  readonly tipo: "caido";
  readonly motivo: string;
}

/**
 * El indexador sobre un Worker, que se crea con la primera provincia y dura toda la visita. El
 * Worker atiende las solicitudes en orden. Una lectura interrumpida no para el Worker, que puede
 * estar con otra provincia: su respuesta se descarta. Si el Worker falla, fallan las que esperan y
 * la siguiente arranca otro.
 */
export const indexadorEnWorker = (
  crear: () => PuertoIndexador,
): Layer.Layer<IndexadorDeProvincias> =>
  Layer.effect(
    IndexadorDeProvincias,
    Effect.gen(function* () {
      let actual: PuertoIndexador | undefined;
      let numero = 0;
      const esperando = new Map<number, (respuesta: RespuestaDeIndice | WorkerCaido) => void>();

      const descartar = () => {
        actual?.terminar();
        actual = undefined;
      };
      yield* Effect.addFinalizer(() => Effect.sync(descartar));

      const puerto = (): PuertoIndexador => {
        if (actual === undefined) {
          const nuevo = crear();
          nuevo.escuchar(
            (respuesta) => {
              const avisar = esperando.get(respuesta.numero);
              esperando.delete(respuesta.numero);
              avisar?.(respuesta);
            },
            (motivo) => {
              descartar();
              const todos = [...esperando.values()];
              esperando.clear();
              for (const avisar of todos) avisar({ tipo: "caido", motivo });
            },
          );
          actual = nuevo;
        }
        return actual;
      };

      const indexar = (provincia: string, texto: string) =>
        Effect.callback<ProvinciaIndexada, IndiceFallido>((reanudar) => {
          numero += 1;
          const este = numero;
          esperando.set(este, (respuesta) => {
            if (respuesta.tipo === "caido") {
              reanudar(
                Effect.fail(
                  new IndiceFallido({
                    provincia,
                    motivo: `El Worker ha fallado: ${respuesta.motivo}`,
                  }),
                ),
              );
            } else if (respuesta.tipo === "fallo") {
              reanudar(Effect.fail(new IndiceFallido({ provincia, motivo: respuesta.motivo })));
            } else {
              reanudar(Effect.sync(() => indexadaDe(respuesta)));
            }
          });
          puerto().enviar({ numero: este, provincia, texto });
          return Effect.sync(() => {
            esperando.delete(este);
          });
        });

      return IndexadorDeProvincias.of({
        indexar: (provincia, texto) =>
          indexar(provincia, texto).pipe(Effect.withSpan("IndexadorDeProvincias.indexar")),
      });
    }),
  );
