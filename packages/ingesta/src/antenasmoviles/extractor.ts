import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import type * as HttpClient from "effect/unstable/http/HttpClient";

import { clienteDeFuente, type OpcionesCliente } from "../cliente.ts";
import {
  ExtractorDePuntos,
  FuenteNoDisponible,
  type Punto,
  RespuestaInesperada,
} from "../extractor.ts";
import { ZONA_BARCELONA } from "../zona.ts";
import {
  enLaCaja,
  esHtml,
  type Filtro,
  observacionesDeDetalle,
  ORIGEN,
  puntosDeListado,
  URL_LISTADO,
  urlDeDetalle,
} from "./normalizar.ts";

/**
 * Cómo se trata a antenasmoviles.es. Es una web sin ánimo de lucro: una petición cada 5 s como
 * poco y pocas por noche. Ver `docs/investigacion/fuentes-comunitarias.md`, apartado 2.
 */
export interface Opciones extends OpcionesCliente {
  /** Qué puntos se guardan. El listado es de toda España y se filtra aquí. */
  readonly dentro: Filtro;
}

/** La pausa más corta entre dos peticiones a antenasmoviles.es. */
export const PAUSA_MINIMA = Duration.seconds(5);

/** El cliente por defecto: una petición cada 5 s y unas 110 por ejecución. */
export const OPCIONES_CLIENTE: OpcionesCliente = {
  userAgent: "Celda (ingesta; contacto en celda.elies.site)",
  pausa: PAUSA_MINIMA,
  // `robots.txt`, el listado, unos 100 detalles y margen para reintentos.
  maxPeticiones: 110,
  // El listado de toda España son unos 850 KB comprimidos.
  espera: Duration.seconds(30),
  reintentos: 2,
};

/** Las de Convex: la caja de Barcelona. */
export const OPCIONES: Opciones = { ...OPCIONES_CLIENTE, dentro: enLaCaja(ZONA_BARCELONA) };

/** La pausa desde la configuración, en segundos, sin bajar nunca de `PAUSA_MINIMA`. */
export const pausaDesdeSegundos = (segundos: number): Duration.Duration =>
  Duration.max(Duration.seconds(segundos), PAUSA_MINIMA);

/** Las opciones se pueden cambiar con variables de entorno del despliegue, sin bajar de 5 s. */
export const opcionesDesdeConfig: Config.Config<Opciones> = Config.all({
  maxPeticiones: Config.Int("CELDA_ANTENASMOVILES_MAX_PETICIONES").pipe(
    Config.withDefault(OPCIONES.maxPeticiones),
  ),
  pausaSegundos: Config.Int("CELDA_ANTENASMOVILES_PAUSA_SEGUNDOS").pipe(
    Config.withDefault(Duration.toSeconds(PAUSA_MINIMA)),
  ),
}).pipe(
  Config.map(({ maxPeticiones, pausaSegundos }) => ({
    ...OPCIONES,
    maxPeticiones,
    pausa: pausaDesdeSegundos(pausaSegundos),
  })),
);

/**
 * Extractor de antenasmoviles.es. Lee el listado de toda España una vez, se queda con los
 * puntos que deja pasar `dentro` y pide el detalle de los puntos que le pida el proceso. Un 403 o una página
 * HTML donde debería haber JSON es la fuente bloqueando a Celda, no una zona sin antenas.
 */
export const capa = (
  opciones: Opciones,
): Layer.Layer<ExtractorDePuntos, never, HttpClient.HttpClient> =>
  Layer.effect(
    ExtractorDePuntos,
    Effect.gen(function* () {
      const cliente = yield* clienteDeFuente(ORIGEN, opciones);

      const obtener = Effect.fn("AntenasMoviles.obtener")(function* (url: string) {
        const respuesta = yield* cliente.pedir(url);
        const texto = new TextDecoder().decode(respuesta.cuerpo);
        if (respuesta.estado === 403 || (respuesta.estado === 200 && esHtml(texto))) {
          return yield* new FuenteNoDisponible({
            url,
            motivo: `HTTP ${respuesta.estado}: la fuente parece estar bloqueando a Celda`,
          });
        }
        if (respuesta.estado !== 200) {
          return yield* new RespuestaInesperada({ url, motivo: `HTTP ${respuesta.estado}` });
        }
        return texto;
      });

      /**
       * Una zona sin puntos no es un dato sino un fallo de la fuente: guardarlo contaría todos
       * los puntos como ausentes y dos noches así retirarían sus correcciones.
       */
      const puntos = Effect.gen(function* () {
        const listado = puntosDeListado(yield* obtener(URL_LISTADO), opciones.dentro);
        if (Result.isFailure(listado)) {
          return yield* new RespuestaInesperada({ url: URL_LISTADO, motivo: listado.failure });
        }
        if (listado.success.puntos.length === 0) {
          return yield* new RespuestaInesperada({
            url: URL_LISTADO,
            motivo: `ningún punto en la zona entre ${listado.success.filas} filas`,
          });
        }
        return { puntos: listado.success.puntos, avisos: listado.success.avisos };
      }).pipe(Effect.withSpan("AntenasMoviles.puntos"));

      const detalle = Effect.fn("AntenasMoviles.detalle")(function* (punto: Punto) {
        const url = urlDeDetalle(punto.codigos);
        const leido = observacionesDeDetalle(yield* obtener(url));
        if (Result.isFailure(leido)) {
          return yield* new RespuestaInesperada({ url, motivo: leido.failure });
        }
        return leido.success;
      });

      return ExtractorDePuntos.of({ fuente: "antenasmoviles", puntos, detalle });
    }),
  );
