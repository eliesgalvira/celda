import type { EmplazamientoLeido } from "@celda/dominio/capa";
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
import { leerPuntosDelMapa, type PuntosDelMapa, transferiblesDePuntos } from "./puntos.ts";
import type { EtiquetaDeMunicipio } from "./zonas.ts";

/** La capa de una provincia no se ha podido leer o indexar. */
export class IndiceFallido extends Schema.TaggedError<IndiceFallido>()("IndiceFallido", {
  provincia: Schema.String,
  motivo: Schema.String,
}) {}

/** Lo que dice un fallo al leer los puntos en lugar de la provincia: son de toda España. */
const PUNTOS = "puntos";

/** Una capa de provincia leída, con sus índices listos para agrupar. */
export interface ProvinciaIndexada {
  readonly capa: CapaDeProvincia;
  readonly indices: IndicesDeCapa<Indice>;
}

/**
 * Una parte de una capa ya leída que hay que indexar aparte, como los emplazamientos de un filtro
 * de compañías (ADR 0026): sus emplazamientos, en el orden en que se agrupan, y sus municipios.
 */
export interface ParteDeCapa {
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  /** Los municipios que pueden ser zona: los de una provincia cubierta, o ninguno. */
  readonly municipios: ReadonlyArray<EtiquetaDeMunicipio>;
  /** Si la capa tiene barrios: los de fuera de ellos se agrupan aparte en su nivel. */
  readonly conBarrios: boolean;
}

/** Los índices de lo que sale con un filtro: los suyos y los de la red que usan. */
export interface IndicesDeFiltro {
  readonly propios: IndicesDeCapa<Indice>;
  readonly redUsada: IndicesDeCapa<Indice> | undefined;
}

/**
 * Lee la capa de una provincia e indexa sus emplazamientos (ADR 0016). En el navegador lo hace un
 * Worker: analizar el JSON y agrupar con supercluster no bloquean el mapa, y aquí solo se
 * rehidratan los índices. El mismo Worker lee los puntos de toda España de la vista de puntos
 * (ADR 0028).
 */
export class IndexadorDeProvincias extends Context.Service<
  IndexadorDeProvincias,
  {
    /**
     * Lee e indexa la capa de una provincia. Sus municipios son zona solo si está `cubierta`: en
     * una a medias, un municipio del borde de lo barrido contaría solo una parte (ADR 0017).
     */
    readonly indexar: (
      provincia: string,
      texto: string,
      cubierta: boolean,
    ) => Effect.Effect<ProvinciaIndexada, IndiceFallido>;
    /**
     * Indexa aparte los emplazamientos de una capa ya leída que salen con un filtro de compañías:
     * los suyos y, si hay, los de la red que usan (ADR 0026). No vuelve a leer la capa.
     */
    readonly indexarFiltro: (
      provincia: string,
      propios: ParteDeCapa,
      redUsada: ParteDeCapa | undefined,
    ) => Effect.Effect<IndicesDeFiltro, IndiceFallido>;
    /** Lee los puntos de toda España y escribe su GeoJSON (`leerPuntosDelMapa`). */
    readonly leerPuntos: (texto: string) => Effect.Effect<PuntosDelMapa, IndiceFallido>;
  }
>()("@celda/web/capa/indexador/IndexadorDeProvincias") {}

/**
 * Una parte de una capa como viaja al Worker: en columnas, para transferirla sin copiar sus
 * búferes. Es lo único que los índices necesitan de cada emplazamiento.
 */
interface ParteEnColumnas {
  readonly cuantos: number;
  /** Longitud y latitud de cada emplazamiento, una detrás de otra. */
  readonly posiciones: Float64Array<ArrayBuffer>;
  /** 1 si el emplazamiento cae en un barrio. */
  readonly enBarrio: Uint8Array<ArrayBuffer>;
  /** La posición de su municipio en `municipios`, o -1 si no tiene o no puede ser zona. */
  readonly municipio: Int32Array<ArrayBuffer>;
  readonly municipios: ReadonlyArray<EtiquetaDeMunicipio>;
  readonly conBarrios: boolean;
}

/** Lo que se le pide al Worker: leer e indexar una capa, o indexar una parte de una ya leída. */
export type SolicitudDeIndice =
  | {
      readonly tipo: "capa";
      readonly numero: number;
      readonly provincia: string;
      readonly texto: string;
      readonly cubierta: boolean;
    }
  | {
      readonly tipo: "filtro";
      readonly numero: number;
      readonly provincia: string;
      readonly propios: ParteEnColumnas;
      readonly redUsada: ParteEnColumnas | undefined;
    }
  | { readonly tipo: "puntos"; readonly numero: number; readonly texto: string };

/** Los índices de una capa o de una parte, serializados (`IndicesDeCapa`). */
interface IndicesSerializados {
  readonly todos: IndiceSerializado;
  readonly fuera: IndiceSerializado | undefined;
  /** Por nivel de municipios, el de los que no van en zona (`IndicesDeCapa`). */
  readonly fueraDeZonas: ReadonlyArray<IndiceSerializado | undefined>;
}

/** Lo que contesta el Worker: la capa leída o las partes del filtro, indexadas, o por qué no. */
export type RespuestaDeIndice =
  | ({
      readonly numero: number;
      readonly tipo: "lista";
      readonly capa: CapaDeProvincia;
    } & IndicesSerializados)
  | {
      readonly numero: number;
      readonly tipo: "filtro";
      readonly propios: IndicesSerializados;
      readonly redUsada: IndicesSerializados | undefined;
    }
  | { readonly numero: number; readonly tipo: "puntos"; readonly puntos: PuntosDelMapa }
  | { readonly numero: number; readonly tipo: "fallo"; readonly motivo: string };

/** Algo que viaja al Worker o viene de él, con los búferes que se transfieren sin copiarse. */
interface ConTransferibles<A> {
  readonly valor: A;
  readonly transferibles: ReadonlyArray<ArrayBuffer>;
}

/** Una parte de una capa en columnas, con los búferes que se transfieren con ella. */
const parteEnColumnas = (parte: ParteDeCapa): ConTransferibles<ParteEnColumnas> => {
  const n = parte.emplazamientos.length;
  const posiciones = new Float64Array(2 * n);
  const enBarrio = new Uint8Array(n);
  const municipio = new Int32Array(n);
  const posicionDeMunicipio = new Map(parte.municipios.map((m, i) => [m.codigo, i]));
  for (const [i, e] of parte.emplazamientos.entries()) {
    posiciones[2 * i] = e.posicion.longitud;
    posiciones[2 * i + 1] = e.posicion.latitud;
    enBarrio[i] = e.barrio === null ? 0 : 1;
    municipio[i] = posicionDeMunicipio.get(e.municipio ?? "") ?? -1;
  }
  return {
    valor: {
      cuantos: n,
      posiciones,
      enBarrio,
      municipio,
      municipios: parte.municipios,
      conBarrios: parte.conBarrios,
    },
    transferibles: [posiciones.buffer, enBarrio.buffer, municipio.buffer],
  };
};

/**
 * Lo que los índices necesitan de cada emplazamiento de una parte en columnas. El barrio no es el
 * suyo: solo dice si tiene alguno, que es lo que mira el índice de los de fuera.
 */
const deColumnas = (parte: ParteEnColumnas) =>
  Array.from({ length: parte.cuantos }, (_, i) => ({
    posicion: {
      longitud: parte.posiciones[2 * i] ?? 0,
      latitud: parte.posiciones[2 * i + 1] ?? 0,
    },
    barrio: parte.enBarrio[i] === 1 ? "" : null,
    municipio: parte.municipios[parte.municipio[i] ?? -1]?.codigo ?? null,
  }));

/** Serializa los índices de una capa o de una parte, con sus búferes. */
const serializarIndices = (
  indices: IndicesDeCapa<Indice>,
): ConTransferibles<IndicesSerializados> => {
  const todos = serializarIndice(indices.todos);
  const fuera = indices.fuera === undefined ? undefined : serializarIndice(indices.fuera);
  const fueraDeZonas = indices.fueraDeZonas.map((indice) =>
    indice === undefined ? undefined : serializarIndice(indice),
  );
  return {
    valor: {
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

/** Indexa una parte en columnas: lo mismo que `indexarCapa` con sus emplazamientos. */
const indexarParte = (parte: ParteEnColumnas) =>
  serializarIndices(indexarCapa(deColumnas(parte), parte.conBarrios, parte.municipios));

/** Una respuesta del Worker con los búferes que se transfieren con ella. */
export interface RespuestaParaEnviar {
  readonly respuesta: RespuestaDeIndice;
  readonly transferibles: ReadonlyArray<ArrayBuffer>;
}

/** Lee la capa de una provincia con el nombre de lugar de sus municipios, el que se enseña. */
const leerCapa = (texto: string, provincia: string) =>
  Result.map(leerCapaDeProvincia(texto, provincia), capaConNombresDeLugar);

/** Los municipios que pueden ser zona: los de una provincia cubierta. */
const municipiosDeZona = (capa: CapaDeProvincia, cubierta: boolean) =>
  cubierta ? capa.municipios : [];

/**
 * Lo que hace el Worker con una solicitud: leer la capa, indexarla y serializar los índices. Los
 * búferes de `transferibles` se transfieren con la respuesta.
 */
export const atenderIndice = (solicitud: SolicitudDeIndice): RespuestaParaEnviar => {
  if (solicitud.tipo === "puntos") {
    const leidos = leerPuntosDelMapa(solicitud.texto);
    return Result.isFailure(leidos)
      ? {
          respuesta: { numero: solicitud.numero, tipo: "fallo", motivo: leidos.failure.motivo },
          transferibles: [],
        }
      : {
          respuesta: { numero: solicitud.numero, tipo: "puntos", puntos: leidos.success },
          transferibles: transferiblesDePuntos(leidos.success),
        };
  }
  if (solicitud.tipo === "filtro") {
    const propios = indexarParte(solicitud.propios);
    const redUsada =
      solicitud.redUsada === undefined ? undefined : indexarParte(solicitud.redUsada);
    return {
      respuesta: {
        numero: solicitud.numero,
        tipo: "filtro",
        propios: propios.valor,
        redUsada: redUsada?.valor,
      },
      transferibles: [...propios.transferibles, ...(redUsada?.transferibles ?? [])],
    };
  }
  const leida = leerCapa(solicitud.texto, solicitud.provincia);
  if (Result.isFailure(leida)) {
    return {
      respuesta: { numero: solicitud.numero, tipo: "fallo", motivo: leida.failure.motivo },
      transferibles: [],
    };
  }
  const capa = leida.success;
  const { valor: serializados, transferibles } = serializarIndices(
    indexarCapa(
      capa.emplazamientos,
      capa.barrios.length > 0,
      municipiosDeZona(capa, solicitud.cubierta),
    ),
  );
  return {
    respuesta: { numero: solicitud.numero, tipo: "lista", capa, ...serializados },
    transferibles,
  };
};

/**
 * Rehidrata unos índices serializados, con los emplazamientos, los barrios y los municipios con
 * que se construyeron: de ellos salen las posiciones de cada uno.
 */
const rehidratarIndices = (
  serializados: IndicesSerializados,
  parte: ParteDeCapa,
): IndicesDeCapa<Indice> => {
  const posiciones = indicesDeCapa(
    parte.emplazamientos,
    serializados.fuera !== undefined,
    parte.municipios,
  );
  return {
    todos: rehidratarIndice(serializados.todos, posiciones.todos),
    fuera:
      serializados.fuera === undefined
        ? undefined
        : rehidratarIndice(serializados.fuera, posiciones.fuera ?? []),
    fueraDeZonas: serializados.fueraDeZonas.map((serializado, i) =>
      serializado === undefined
        ? undefined
        : rehidratarIndice(serializado, posiciones.fueraDeZonas[i] ?? []),
    ),
  };
};

/** Rehidrata los índices de una respuesta del Worker. */
const indexadaDe = (
  respuesta: Extract<RespuestaDeIndice, { readonly tipo: "lista" }>,
  cubierta: boolean,
): ProvinciaIndexada => {
  const { capa } = respuesta;
  return {
    capa,
    indices: rehidratarIndices(respuesta, {
      emplazamientos: capa.emplazamientos,
      municipios: municipiosDeZona(capa, cubierta),
      conBarrios: respuesta.fuera !== undefined,
    }),
  };
};

/** Indexa una parte en el mismo hilo, sin serializar nada. */
const indexarEnHilo = (parte: ParteDeCapa) =>
  indexarCapa(parte.emplazamientos, parte.conBarrios, parte.municipios);

/**
 * El indexador en el mismo hilo, sin serializar nada: el de las pruebas que no miran el Worker y
 * el de Node.
 */
export const indexadorEnHilo = Layer.succeed(
  IndexadorDeProvincias,
  IndexadorDeProvincias.of({
    indexar: (provincia, texto, cubierta) =>
      Effect.suspend(() => {
        const leida = leerCapa(texto, provincia);
        if (Result.isFailure(leida)) {
          return Effect.fail(new IndiceFallido({ provincia, motivo: leida.failure.motivo }));
        }
        const capa = leida.success;
        return Effect.succeed({
          capa,
          indices: indexarCapa(
            capa.emplazamientos,
            capa.barrios.length > 0,
            municipiosDeZona(capa, cubierta),
          ),
        });
      }),
    indexarFiltro: (_provincia, propios, redUsada) =>
      Effect.sync(() => ({
        propios: indexarEnHilo(propios),
        redUsada: redUsada === undefined ? undefined : indexarEnHilo(redUsada),
      })),
    leerPuntos: (texto) =>
      Effect.suspend(() => {
        const leidos = leerPuntosDelMapa(texto);
        return Result.isFailure(leidos)
          ? Effect.fail(new IndiceFallido({ provincia: PUNTOS, motivo: leidos.failure.motivo }))
          : Effect.succeed(leidos.success);
      }),
  }),
);

/**
 * Lo que el indexador necesita de un Worker. En el navegador lo da `new Worker(...)`; en las
 * pruebas, uno de prueba que contesta en otra tarea.
 */
export interface PuertoIndexador {
  /** Manda una solicitud; los búferes de `transferibles` pasan al Worker sin copiarse. */
  readonly enviar: (
    solicitud: SolicitudDeIndice,
    transferibles?: ReadonlyArray<ArrayBuffer>,
  ) => void;
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

      /**
       * Manda una solicitud al Worker y espera su respuesta. `leer` saca de ella lo que se pide, o
       * `undefined` si es de otro tipo.
       */
      const pedir = <A>(
        provincia: string,
        solicitud: (numero: number) => SolicitudDeIndice,
        transferibles: ReadonlyArray<ArrayBuffer>,
        leer: (respuesta: RespuestaDeIndice) => A | undefined,
      ) =>
        Effect.callback<A, IndiceFallido>((reanudar) => {
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
              reanudar(
                Effect.suspend(() => {
                  const leida = leer(respuesta);
                  return leida === undefined
                    ? Effect.fail(
                        new IndiceFallido({
                          provincia,
                          motivo: "el Worker ha contestado otra cosa",
                        }),
                      )
                    : Effect.succeed(leida);
                }),
              );
            }
          });
          puerto().enviar(solicitud(este), transferibles);
          return Effect.sync(() => {
            esperando.delete(este);
          });
        });

      const indexar = (provincia: string, texto: string, cubierta: boolean) =>
        pedir(
          provincia,
          (este) => ({ tipo: "capa", numero: este, provincia, texto, cubierta }),
          [],
          (respuesta) => (respuesta.tipo === "lista" ? indexadaDe(respuesta, cubierta) : undefined),
        );

      const indexarFiltro = (
        provincia: string,
        propios: ParteDeCapa,
        redUsada: ParteDeCapa | undefined,
      ) =>
        Effect.suspend(() => {
          const suyos = parteEnColumnas(propios);
          const deLaRed = redUsada === undefined ? undefined : parteEnColumnas(redUsada);
          return pedir(
            provincia,
            (este) => ({
              tipo: "filtro",
              numero: este,
              provincia,
              propios: suyos.valor,
              redUsada: deLaRed?.valor,
            }),
            [...suyos.transferibles, ...(deLaRed?.transferibles ?? [])],
            (respuesta): IndicesDeFiltro | undefined =>
              respuesta.tipo === "filtro"
                ? {
                    propios: rehidratarIndices(respuesta.propios, propios),
                    redUsada:
                      respuesta.redUsada === undefined || redUsada === undefined
                        ? undefined
                        : rehidratarIndices(respuesta.redUsada, redUsada),
                  }
                : undefined,
          );
        });

      const leerPuntos = (texto: string) =>
        pedir(
          PUNTOS,
          (este) => ({ tipo: "puntos", numero: este, texto }),
          [],
          (respuesta) => (respuesta.tipo === "puntos" ? respuesta.puntos : undefined),
        );

      return IndexadorDeProvincias.of({
        indexar: (provincia, texto, cubierta) =>
          indexar(provincia, texto, cubierta).pipe(
            Effect.withSpan("IndexadorDeProvincias.indexar"),
          ),
        indexarFiltro: (provincia, propios, redUsada) =>
          indexarFiltro(provincia, propios, redUsada).pipe(
            Effect.withSpan("IndexadorDeProvincias.indexarFiltro"),
          ),
        leerPuntos: (texto) =>
          leerPuntos(texto).pipe(Effect.withSpan("IndexadorDeProvincias.leerPuntos")),
      });
    }),
  );
