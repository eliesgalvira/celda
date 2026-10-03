import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/unstable/http/HttpClient";

import { type ClienteDeFuente, clienteDeFuente, type OpcionesCliente } from "../cliente.ts";
import {
  ExtractorPorCajas,
  FuenteBloqueada,
  type ListadoDeCaja,
  type Registro,
  RespuestaInesperada,
  SinFichaEnElRegistro,
} from "../extractor.ts";
import { decodificarLatin1 } from "../texto.ts";
import type { Caja } from "../zona.ts";
import {
  AVISO_SIN_FICHA,
  bandasDeFicha,
  esFichaDelGeoportal,
  esFichaSinEmplazamiento,
  listadoDeElementos,
  ORIGEN,
  RespuestaListado,
  TOPE_LISTADO,
  urlDeListado,
} from "./normalizar.ts";

/**
 * Cómo se comporta el extractor con el geoportal. Ver `docs/investigacion/registro-oficial.md`.
 * El tope de peticiones deja barrer toda España en una noche (#50): la primera pasada son unas
 * 250 peticiones de listado y las siguientes, unas 215, más `robots.txt` y los reintentos.
 */
export const OPCIONES: OpcionesCliente = {
  userAgent: "Celda (ingesta; contacto en celda.elies.site)",
  pausa: Duration.seconds(3),
  maxPeticiones: 400,
  espera: Duration.seconds(10),
  reintentos: 3,
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

/** Estados con los que el geoportal estaría negando el paso a Celda. */
const ESTADOS_DE_BLOQUEO: ReadonlySet<number> = new Set([401, 403]);

/**
 * El geoportal del ministerio visto por el extractor: el listado de una caja en una petición y la
 * ficha de un registro, cada uno con su cliente de la fuente, que respeta `robots.txt`, deja su
 * pausa entre peticiones, no pasa de su tope y reintenta los fallos pasajeros con espera
 * exponencial. Un 401 o un 403, un listado en HTML o una página que no es una ficha son la fuente
 * bloqueando a Celda (`FuenteBloqueada`). La ficha con el aviso de código no válido es una
 * estación base sin ficha en el registro (`SinFichaEnElRegistro`).
 */
const geoportal = (listado: ClienteDeFuente, fichas: ClienteDeFuente) => {
  const obtener = Effect.fn("RegistroOficial.obtener")(function* (
    cliente: ClienteDeFuente,
    url: string,
  ) {
    const respuesta = yield* cliente.pedir(url);
    if (ESTADOS_DE_BLOQUEO.has(respuesta.estado)) {
      return yield* new FuenteBloqueada({ url, motivo: `HTTP ${respuesta.estado}` });
    }
    if (respuesta.estado !== 200) {
      return yield* new RespuestaInesperada({ url, motivo: `HTTP ${respuesta.estado}` });
    }
    return { texto: decodificarLatin1(respuesta.cuerpo), bytes: respuesta.cuerpo.byteLength };
  });

  const decodificarListado = Schema.decodeUnknownEffect(RespuestaListado);

  /** Los elementos de una caja tal como llegan. Una caja sin estaciones llega como `{}`. */
  const elementos = Effect.fn("RegistroOficial.elementos")(function* (caja: Caja) {
    const url = urlDeListado(caja);
    const { texto, bytes } = yield* obtener(listado, url);
    if (texto.trimStart().startsWith("<")) {
      return yield* new FuenteBloqueada({ url, motivo: "una página HTML en lugar del listado" });
    }
    const respuesta = yield* decodificarListado(texto).pipe(
      Effect.mapError((error) => new RespuestaInesperada({ url, motivo: error.message })),
    );
    return { elementos: "features" in respuesta ? respuesta.features : [], bytes };
  });

  const listadoDeCaja = Effect.fn("RegistroOficial.caja")(function* (caja: Caja) {
    const respuesta = yield* elementos(caja);
    const leido: ListadoDeCaja = {
      ...listadoDeElementos(respuesta.elementos),
      enElTope: respuesta.elementos.length >= TOPE_LISTADO,
      bytes: respuesta.bytes,
    };
    return leido;
  });

  const ficha = Effect.fn("RegistroOficial.ficha")(function* (registro: Registro) {
    const { texto } = yield* obtener(fichas, registro.url);
    if (!esFichaDelGeoportal(texto)) {
      return yield* new FuenteBloqueada({
        url: registro.url,
        motivo: "una página que no es una ficha del geoportal",
      });
    }
    if (esFichaSinEmplazamiento(texto)) {
      return yield* new SinFichaEnElRegistro({ url: registro.url, motivo: AVISO_SIN_FICHA });
    }
    const bandas = bandasDeFicha(texto);
    if (Result.isFailure(bandas)) {
      return yield* new RespuestaInesperada({ url: registro.url, motivo: bandas.failure });
    }
    return bandas.success;
  });

  const peticiones =
    listado === fichas
      ? listado.peticiones
      : Effect.map(
          Effect.all([listado.peticiones, fichas.peticiones]),
          ([deListado, deFichas]) => deListado + deFichas,
        );

  return { listadoDeCaja, ficha, peticiones };
};

/**
 * Extractor del registro oficial para el barrido por zonas de la ingesta nocturna: pide el
 * listado de cada caja tal cual y dice si ha llegado al tope. Qué cajas se piden y cuándo se
 * dividen lo decide `recorrerCuadro` (`barrido.ts`). Las fichas se piden con `fichas`, otra pausa
 * y otro tope sobre la misma conexión (`opcionesClienteDeFichas` en `fichas.ts`); sin ellas, con
 * las del listado.
 */
export const capaPorCajas = (
  opciones: OpcionesCliente,
  fichas?: OpcionesCliente,
): Layer.Layer<ExtractorPorCajas, never, HttpClient.HttpClient> =>
  Layer.effect(
    ExtractorPorCajas,
    Effect.gen(function* () {
      const listado = yield* clienteDeFuente(ORIGEN, opciones);
      const fuente = geoportal(
        listado,
        fichas === undefined ? listado : yield* listado.conOpciones(fichas),
      );
      return ExtractorPorCajas.of({
        fuente: "registro-oficial",
        caja: fuente.listadoDeCaja,
        ficha: fuente.ficha,
        peticiones: fuente.peticiones,
      });
    }),
  );
