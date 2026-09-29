import {
  CapaIlegible,
  decodificarVigente,
  FICHERO_VIGENTE,
  VersionDistinta,
  type Vigente,
} from "@celda/dominio/capa";
import { leerResumen, type ResumenLeido } from "@celda/dominio/provincias";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { crearAgrupador } from "./agrupacion.ts";
import { IndexadorDeProvincias, type IndiceFallido } from "./indexador.ts";
import { type ProvinciaCargada, prefijoDeProvincia } from "./nacional.ts";

/** El origen no tiene todavía ninguna capa publicada: no hay `vigente.json`. */
export class SinCapaPublicada extends Schema.TaggedError<SinCapaPublicada>()(
  "SinCapaPublicada",
  {},
) {}

/** El origen no ha dicho qué capa cargar: no responde o responde algo que no es `vigente.json`. */
export class OrigenNoResponde extends Schema.TaggedError<OrigenNoResponde>()("OrigenNoResponde", {
  motivo: Schema.String,
}) {}

/** El fichero de la capa no ha llegado. */
export class CapaNoDescargada extends Schema.TaggedError<CapaNoDescargada>()("CapaNoDescargada", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

export type FalloCapa =
  | SinCapaPublicada
  | OrigenNoResponde
  | CapaNoDescargada
  | CapaIlegible
  | VersionDistinta
  | IndiceFallido;

/**
 * La capa de emplazamientos que dibuja el mapa, en el formato 5 (ADR 0016): el resumen nacional
 * de la versión vigente y, a demanda, la capa de cada provincia, indexada. Lo que llega se queda
 * para toda la visita: el mapa y las fichas leen de lo mismo.
 */
export class CapaEmplazamientos extends Context.Service<
  CapaEmplazamientos,
  {
    /** `vigente.json` y el resumen de esa versión. */
    readonly resumen: Effect.Effect<ResumenLeido, FalloCapa>;
    /**
     * La capa de una provincia del resumen, indexada. Si el origen ya no la tiene, porque la
     * pestaña lleva abierta desde antes de varias publicaciones, lee la de la versión vigente y la
     * marca con su versión.
     */
    readonly provincia: (codigo: string) => Effect.Effect<ProvinciaCargada, FalloCapa>;
  }
>()("@celda/web/capa/servicio/CapaEmplazamientos") {}

/**
 * De dónde se leen las capas y las fichas publicadas: `VITE_CAPAS_ORIGEN`, o `/capas` en el mismo
 * origen que la web. Siempre como URL absoluta y sin barra final.
 */
export const origenDeCapas: Config.Config<string> = Config.String("VITE_CAPAS_ORIGEN").pipe(
  Config.withDefault("/capas"),
  Config.map((origen) => new URL(origen, globalThis.location.href).href.replace(/\/$/u, "")),
);

/**
 * Lee `vigente.json` del origen: qué versión hay que cargar. Es el único fichero que cambia, y el
 * origen lo sirve sin caché larga.
 */
export const leerVigente = (http: HttpClient.HttpClient, origen: string) =>
  Effect.gen(function* () {
    const respuesta = yield* http
      .get(`${origen}/${FICHERO_VIGENTE}`)
      .pipe(Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })));
    if (respuesta.status === 404) {
      return yield* new SinCapaPublicada();
    }
    const texto = yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
      Effect.flatMap((ok) => ok.text),
      Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })),
    );
    return yield* Effect.fromResult(decodificarVigente(texto)).pipe(
      Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })),
    );
  });

/** Un fichero publicado, o `None` si el origen ya no lo tiene (404). */
export const descargarFichero = (http: HttpClient.HttpClient, origen: string, fichero: string) =>
  Effect.gen(function* () {
    const url = `${origen}/${fichero}`;
    const respuesta = yield* http
      .get(url)
      .pipe(Effect.mapError((error) => new CapaNoDescargada({ url, motivo: error.message })));
    if (respuesta.status === 404) return Option.none<string>();
    return Option.some(
      yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
        Effect.flatMap((ok) => ok.text),
        Effect.mapError((error) => new CapaNoDescargada({ url, motivo: error.message })),
      ),
    );
  });

/** Descarga el resumen de la versión vigente y comprueba que es esa. */
export const descargarResumen = (http: HttpClient.HttpClient, origen: string, vigente: Vigente) =>
  Effect.gen(function* () {
    if (vigente.resumen === undefined) {
      // Un `vigente.json` del formato 4 o anterior: esta web ya no sabe leerlo.
      return yield* new CapaIlegible({ motivo: `${vigente.version} no es del formato 5` });
    }
    const url = `${origen}/${vigente.resumen}`;
    const contenido = yield* descargarFichero(http, origen, vigente.resumen);
    if (Option.isNone(contenido)) {
      return yield* new CapaNoDescargada({ url, motivo: "el origen no lo tiene" });
    }
    return yield* Effect.fromResult(leerResumen(contenido.value, vigente.version));
  });

/** Lo que se guarda para la visita: una vez leído, no se vuelve a pedir. */
const guardado = <A, E>(turno: Semaphore.Semaphore, cargar: Effect.Effect<A, E>) => {
  let leido = Option.none<A>();
  return turno.withPermits(1)(
    Effect.suspend(() =>
      Option.match(leido, {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.tap(cargar, (valor) =>
            Effect.sync(() => {
              leido = Option.some(valor);
            }),
          ),
      }),
    ),
  );
};

/**
 * La capa del origen estático, sin pasar por ningún backend (ADR 0008): `vigente.json`, su resumen
 * y las provincias que se pidan, cada una indexada por el `IndexadorDeProvincias`. Una carga
 * fallida no se guarda: la siguiente lo vuelve a intentar.
 */
export const capaDelOrigen = Layer.effect(
  CapaEmplazamientos,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const indexador = yield* IndexadorDeProvincias;
    const origen = yield* Effect.orDie(origenDeCapas);

    const resumen = guardado(
      yield* Semaphore.make(1),
      Effect.flatMap(leerVigente(http, origen), (vigente) =>
        descargarResumen(http, origen, vigente),
      ),
    ).pipe(Effect.withSpan("CapaEmplazamientos.resumen"));

    /** El texto de la capa de una provincia, de la versión del mapa o, si ya no está, de la vigente. */
    const textoDe = (codigo: string) =>
      Effect.gen(function* () {
        const delMapa = yield* resumen;
        const fichero = delMapa.provincias.find((p) => p.codigo === codigo)?.fichero;
        if (fichero === undefined) {
          return yield* new CapaIlegible({ motivo: `la provincia ${codigo} no tiene capa` });
        }
        const texto = yield* descargarFichero(http, origen, fichero);
        if (Option.isSome(texto)) {
          return { version: delMapa.version, fecha: delMapa.fecha, texto: texto.value };
        }
        const vigente = yield* leerVigente(http, origen);
        const url = `${origen}/${fichero}`;
        if (vigente.version === delMapa.version) {
          return yield* new CapaNoDescargada({ url, motivo: "el origen no la tiene" });
        }
        const nuevo = yield* descargarResumen(http, origen, vigente);
        const suyo = nuevo.provincias.find((p) => p.codigo === codigo)?.fichero;
        const deLaVigente =
          suyo === undefined ? Option.none<string>() : yield* descargarFichero(http, origen, suyo);
        if (Option.isNone(deLaVigente)) {
          return yield* new CapaNoDescargada({
            url,
            motivo: "ni esa versión ni la vigente la tienen",
          });
        }
        return { version: nuevo.version, fecha: nuevo.fecha, texto: deLaVigente.value };
      });

    const cargas = new Map<string, Effect.Effect<ProvinciaCargada, FalloCapa>>();
    const provincia = (codigo: string) => {
      let carga = cargas.get(codigo);
      if (carga === undefined) {
        carga = guardado(
          Semaphore.makeUnsafe(1),
          Effect.gen(function* () {
            const { version, fecha, texto } = yield* textoDe(codigo);
            const { capa, indices } = yield* indexador.indexar(codigo, texto);
            const cargada: ProvinciaCargada = {
              codigo,
              version,
              fecha,
              capa,
              agrupador: crearAgrupador(capa.emplazamientos, capa.barrios, {
                indices,
                prefijo: prefijoDeProvincia(codigo),
              }),
            };
            return cargada;
          }),
        );
        cargas.set(codigo, carga);
      }
      return carga.pipe(Effect.withSpan("CapaEmplazamientos.provincia"));
    };

    return CapaEmplazamientos.of({ resumen, provincia });
  }),
);
