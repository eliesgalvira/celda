import { dividir } from "@celda/dominio/barrido";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/unstable/http/HttpClient";

import { clienteDeFuente, type OpcionesCliente } from "../cliente.ts";
import {
  type ErrorDeExtractor,
  Extractor,
  ExtractorPorCajas,
  type ListadoDeCaja,
  type Registro,
  RespuestaInesperada,
} from "../extractor.ts";
import { decodificarLatin1 } from "../texto.ts";
import { type Caja, ZONA_BARCELONA } from "../zona.ts";
import {
  bandasDeFicha,
  listadoDeElementos,
  ORIGEN,
  RespuestaListado,
  TOPE_LISTADO,
  urlDeListado,
} from "./normalizar.ts";

/** Cómo se comporta el extractor con el geoportal. Ver `docs/investigacion/registro-oficial.md`. */
export interface Opciones extends OpcionesCliente {
  /** Caja que se recorre, en grados ETRS89. */
  readonly zona: Caja;
}

export const OPCIONES: Opciones = {
  userAgent: "Celda (ingesta; contacto en celda.elies.site)",
  pausa: Duration.seconds(3),
  maxPeticiones: 300,
  espera: Duration.seconds(10),
  reintentos: 3,
  zona: ZONA_BARCELONA,
};

/**
 * Cómo se trata al geoportal, desde variables de entorno del despliegue, sin bajar de 3 s entre
 * peticiones. El primer producto del `User-Agent` es el nombre con el que se busca a Celda en
 * `robots.txt`, que se respeta siempre.
 */
export const opcionesClienteDesdeConfig: Config.Config<OpcionesCliente> = Config.all({
  maxPeticiones: Config.Int("CELDA_REGISTRO_MAX_PETICIONES").pipe(
    Config.withDefault(OPCIONES.maxPeticiones),
  ),
  pausaSegundos: Config.Int("CELDA_REGISTRO_PAUSA_SEGUNDOS").pipe(Config.withDefault(3)),
  userAgent: Config.String("CELDA_REGISTRO_USER_AGENT").pipe(
    Config.withDefault(OPCIONES.userAgent),
  ),
  reintentos: Config.Int("CELDA_REGISTRO_REINTENTOS").pipe(Config.withDefault(OPCIONES.reintentos)),
  esperaSegundos: Config.Int("CELDA_REGISTRO_ESPERA_SEGUNDOS").pipe(
    Config.withDefault(Duration.toSeconds(OPCIONES.espera)),
  ),
}).pipe(
  Config.map(({ maxPeticiones, pausaSegundos, userAgent, reintentos, esperaSegundos }) => ({
    maxPeticiones,
    userAgent,
    reintentos: Math.max(reintentos, 0),
    espera: Duration.seconds(Math.max(esperaSegundos, 1)),
    pausa: Duration.seconds(Math.max(pausaSegundos, 3)),
  })),
);

/** Las opciones del cliente y la caja de Barcelona, para la ingesta de Convex. */
export const opcionesDesdeConfig: Config.Config<Opciones> = Config.map(
  opcionesClienteDesdeConfig,
  (cliente) => ({ ...cliente, zona: OPCIONES.zona }),
);

/** Profundidad máxima al dividir cajas. A 6 niveles la caja de Barcelona mide unos 300 m. */
const PROFUNDIDAD_MAXIMA = 6;

/**
 * El geoportal del ministerio visto por el extractor: el listado de una caja en una petición y la
 * ficha de un registro, con el cliente de la fuente, que respeta `robots.txt`, deja `pausa` entre
 * peticiones, no pasa de `maxPeticiones` y reintenta los fallos pasajeros con espera exponencial.
 */
const geoportal = Effect.fn("RegistroOficial.geoportal")(function* (opciones: OpcionesCliente) {
  const cliente = yield* clienteDeFuente(ORIGEN, opciones);

  const obtener = Effect.fn("RegistroOficial.obtener")(function* (url: string) {
    const respuesta = yield* cliente.pedir(url);
    if (respuesta.estado !== 200) {
      return yield* new RespuestaInesperada({ url, motivo: `HTTP ${respuesta.estado}` });
    }
    return { texto: decodificarLatin1(respuesta.cuerpo), bytes: respuesta.cuerpo.byteLength };
  });

  const decodificarListado = Schema.decodeUnknownEffect(RespuestaListado);

  /** Los elementos de una caja tal como llegan. Una caja sin estaciones llega como `{}`. */
  const elementos = Effect.fn("RegistroOficial.elementos")(function* (caja: Caja) {
    const url = urlDeListado(caja);
    const { texto, bytes } = yield* obtener(url);
    const respuesta = yield* decodificarListado(texto).pipe(
      Effect.mapError((error) => new RespuestaInesperada({ url, motivo: error.message })),
    );
    return { elementos: "features" in respuesta ? respuesta.features : [], bytes };
  });

  const listadoDeCaja = Effect.fn("RegistroOficial.caja")(function* (caja: Caja) {
    const respuesta = yield* elementos(caja);
    const listado: ListadoDeCaja = {
      ...listadoDeElementos(respuesta.elementos),
      enElTope: respuesta.elementos.length >= TOPE_LISTADO,
      bytes: respuesta.bytes,
    };
    return listado;
  });

  const ficha = Effect.fn("RegistroOficial.ficha")(function* (registro: Registro) {
    const bandas = bandasDeFicha((yield* obtener(registro.url)).texto);
    if (Result.isFailure(bandas)) {
      return yield* new RespuestaInesperada({ url: registro.url, motivo: bandas.failure });
    }
    return bandas.success;
  });

  return { elementos, listadoDeCaja, ficha, peticiones: cliente.peticiones };
});

/**
 * Extractor del registro oficial (Infoantenas) para la ingesta de Convex: recorre el listado de
 * `zona` por cajas que divide en cuatro al llegar al tope de 1000 elementos.
 */
export const capa = (opciones: Opciones): Layer.Layer<Extractor, never, HttpClient.HttpClient> =>
  Layer.effect(
    Extractor,
    Effect.gen(function* () {
      const fuente = yield* geoportal(opciones);

      const elementosDeCaja = (
        caja: Caja,
        profundidad: number,
      ): Effect.Effect<ReadonlyArray<unknown>, ErrorDeExtractor> =>
        Effect.gen(function* () {
          const { elementos } = yield* fuente.elementos(caja);
          if (elementos.length < TOPE_LISTADO) {
            return elementos;
          }
          if (profundidad >= PROFUNDIDAD_MAXIMA) {
            return yield* new RespuestaInesperada({
              url: urlDeListado(caja),
              motivo: "caja con 1000 elementos al máximo de divisiones",
            });
          }
          const partes = yield* Effect.forEach(dividir(caja), (parte) =>
            elementosDeCaja(parte, profundidad + 1),
          );
          return partes.flat();
        });

      /**
       * Una zona entera sin elementos no es un dato sino un fallo de la fuente: guardarlo
       * contaría todas las estaciones como ausentes y dos noches así las retirarían.
       */
      const listado = Effect.gen(function* () {
        const resultado = listadoDeElementos(yield* elementosDeCaja(opciones.zona, 0));
        if (resultado.registros.length === 0) {
          return yield* new RespuestaInesperada({
            url: urlDeListado(opciones.zona),
            motivo: "el listado de toda la zona está vacío",
          });
        }
        return resultado;
      }).pipe(Effect.withSpan("RegistroOficial.listado"));

      return Extractor.of({ fuente: "registro-oficial", listado, ficha: fuente.ficha });
    }),
  );

/**
 * Extractor del registro oficial para el barrido por zonas de la ingesta nocturna: pide el
 * listado de cada caja tal cual y dice si ha llegado al tope. Qué cajas se piden y cuándo se
 * dividen lo decide `recorrerCuadro` (`barrido.ts`).
 */
export const capaPorCajas = (
  opciones: OpcionesCliente,
): Layer.Layer<ExtractorPorCajas, never, HttpClient.HttpClient> =>
  Layer.effect(
    ExtractorPorCajas,
    Effect.map(geoportal(opciones), (fuente) =>
      ExtractorPorCajas.of({
        fuente: "registro-oficial",
        caja: fuente.listadoDeCaja,
        ficha: fuente.ficha,
        peticiones: fuente.peticiones,
      }),
    ),
  );
