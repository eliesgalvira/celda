import { BARCELONA, type Coordenada, contiene } from "@celda/dominio/area";
import type { Credito } from "@celda/ui/Atribucion.tsx";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/** Una dirección encontrada: cómo se llama, dónde queda y su posición. */
export interface Direccion {
  /** Lo que se busca: «Carrer de Provença, 450» o «Basílica de la Sagrada Familia». */
  readonly nombre: string;
  /** El barrio, el distrito y el municipio. */
  readonly detalle: string;
  readonly posicion: Coordenada;
}

/** La búsqueda no ha podido hacerse, y por qué. */
export class BusquedaFallida extends Schema.TaggedError<BusquedaFallida>()("BusquedaFallida", {
  motivo: Schema.Literals(["apagada", "sin-respuesta", "limite"]),
  detalle: Schema.String,
}) {}

/**
 * La búsqueda de direcciones para elegir un punto (historias 26 y 27). Solo busca cuando la
 * persona lo pide, nunca mientras escribe, y dentro de la zona de Barcelona.
 */
export class BuscadorDeDirecciones extends Context.Service<
  BuscadorDeDirecciones,
  {
    readonly buscar: (consulta: string) => Effect.Effect<ReadonlyArray<Direccion>, BusquedaFallida>;
    /** A quién se cita junto al buscador: el servicio y la licencia de sus datos. */
    readonly atribucion: Credito;
  }
>()("@celda/web/ubicacion/buscador/BuscadorDeDirecciones") {}

/** Consultas más cortas no se envían: no darían nada útil. */
export const LETRAS_MINIMAS = 3;

/** La consulta tal como se envía y se guarda en la caché. */
export const normalizarConsulta = (consulta: string): string =>
  consulta.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("es-ES");

/** El valor de `VITE_BUSCADOR_URL` que apaga el buscador sin tocar el código. */
const APAGADO = "apagado";

/** La política de uso de Nominatim pide como mucho una petición por segundo. */
const INTERVALO = Duration.seconds(1);
const ESPERA_MAXIMA = Duration.seconds(10);
const RESULTADOS = 5;

const Resultado = Schema.Struct({
  lat: Schema.FiniteFromString,
  lon: Schema.FiniteFromString,
  name: Schema.optional(Schema.String),
  address: Schema.optional(
    Schema.Struct({
      road: Schema.optional(Schema.String),
      pedestrian: Schema.optional(Schema.String),
      house_number: Schema.optional(Schema.String),
      neighbourhood: Schema.optional(Schema.String),
      quarter: Schema.optional(Schema.String),
      suburb: Schema.optional(Schema.String),
      city: Schema.optional(Schema.String),
      town: Schema.optional(Schema.String),
      village: Schema.optional(Schema.String),
    }),
  ),
});
type Resultado = typeof Resultado.Type;

const leerRespuesta = HttpClientResponse.schemaBodyJson(Schema.Array(Resultado));

/** De un resultado de Nominatim a una dirección con un nombre corto y un detalle. */
export const direccionDe = (resultado: Resultado): Direccion | undefined => {
  const direccion = resultado.address ?? {};
  const calle = direccion.road ?? direccion.pedestrian;
  const conNumero =
    calle === undefined
      ? undefined
      : [calle, direccion.house_number].filter((parte) => parte !== undefined).join(", ");
  const nombre = resultado.name !== undefined && resultado.name !== "" ? resultado.name : conNumero;
  if (nombre === undefined) return undefined;
  const lugar = [
    nombre === conNumero ? undefined : calle,
    direccion.quarter ?? direccion.neighbourhood,
    direccion.suburb,
    direccion.city ?? direccion.town ?? direccion.village,
  ].filter((parte): parte is string => parte !== undefined && parte !== nombre);
  return {
    nombre,
    detalle: [...new Set(lugar)].join(", "),
    posicion: { longitud: resultado.lon, latitud: resultado.lat },
  };
};

/** Las direcciones de la respuesta que caen en la zona, sin repetir las que se leen igual. */
export const direccionesDe = (resultados: ReadonlyArray<Resultado>): ReadonlyArray<Direccion> => {
  const vistas = new Set<string>();
  return resultados.flatMap((resultado) => {
    const direccion = direccionDe(resultado);
    if (direccion === undefined || !contiene(BARCELONA.limites, direccion.posicion)) return [];
    const clave = `${direccion.nombre}|${direccion.detalle}`;
    if (vistas.has(clave)) return [];
    vistas.add(clave);
    return [direccion];
  });
};

const ATRIBUCION_NOMINATIM: Credito = {
  texto: "Nominatim · datos de OpenStreetMap (ODbL)",
  enlace: "https://nominatim.org/",
};

/**
 * El buscador sobre la API de Nominatim en `VITE_BUSCADOR_URL` (por defecto, el servidor público
 * de OpenStreetMap). Respeta su política de uso (ADR 0013): una petición por
 * segundo como mucho desde cada navegador, solo al pedirlo la persona, con caché y limitada a la
 * zona de Barcelona. Con `VITE_BUSCADOR_URL=apagado`, el buscador queda apagado y lo dice.
 */
export const buscadorNominatim: Layer.Layer<BuscadorDeDirecciones, never, HttpClient.HttpClient> =
  Layer.effect(
    BuscadorDeDirecciones,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const url = yield* Config.String("VITE_BUSCADOR_URL").pipe(
        Config.withDefault("https://nominatim.openstreetmap.org"),
        Effect.orDie,
      );
      const turno = yield* Semaphore.make(1);
      const ultima = yield* Ref.make<number | undefined>(undefined);

      /** Espera lo que falte para el segundo desde la petición anterior. */
      const esperarTurno = Effect.gen(function* () {
        const antes = yield* Ref.get(ultima);
        const ahora = yield* Clock.currentTimeMillis;
        if (antes !== undefined) {
          const falta = antes + Duration.toMillis(INTERVALO) - ahora;
          if (falta > 0) yield* Effect.sleep(Duration.millis(falta));
        }
        yield* Ref.set(ultima, yield* Clock.currentTimeMillis);
      });

      const peticion = (consulta: string) =>
        HttpClientRequest.get(`${url}/search`, {
          urlParams: {
            q: consulta,
            format: "jsonv2",
            addressdetails: "1",
            limit: String(RESULTADOS),
            countrycodes: "es",
            "accept-language": "es",
            viewbox: [
              BARCELONA.limites.suroeste.longitud,
              BARCELONA.limites.noreste.latitud,
              BARCELONA.limites.noreste.longitud,
              BARCELONA.limites.suroeste.latitud,
            ].join(","),
            bounded: "1",
          },
        });

      const sinRespuesta = (detalle: string) =>
        new BusquedaFallida({ motivo: "sin-respuesta", detalle });

      const pedir = (consulta: string): Effect.Effect<ReadonlyArray<Direccion>, BusquedaFallida> =>
        Effect.gen(function* () {
          // Sin las cabeceras de trazas (`traceparent`, `b3`): con ellas el navegador manda antes
          // una petición OPTIONS de CORS, y cada búsqueda serían dos peticiones a Nominatim.
          const respuesta = yield* http
            .execute(peticion(consulta))
            .pipe(Effect.provideService(HttpClient.TracerPropagationEnabled, false));
          if (respuesta.status === 429) {
            return yield* new BusquedaFallida({
              motivo: "limite",
              detalle: "El buscador pide que esperemos antes de volver a buscar.",
            });
          }
          const resultados = yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
            Effect.flatMap(leerRespuesta),
          );
          return direccionesDe(resultados);
        }).pipe(
          Effect.timeout(ESPERA_MAXIMA),
          Effect.catchTags({
            TimeoutError: () => Effect.fail(sinRespuesta("El buscador no ha contestado a tiempo.")),
            HttpClientError: (error) => Effect.fail(sinRespuesta(error.message)),
            SchemaError: (error) => Effect.fail(sinRespuesta(error.message)),
          }),
        );

      const cache = yield* Cache.makeWith(
        // Una petición detrás de otra y con un segundo entre ellas, aunque se busque muy seguido.
        (consulta: string) => turno.withPermits(1)(Effect.andThen(esperarTurno, pedir(consulta))),
        {
          capacity: 100,
          // Solo se guardan las respuestas buenas: un fallo se puede reintentar.
          timeToLive: (salida) => (Exit.isSuccess(salida) ? Duration.hours(12) : Duration.zero),
        },
      );

      const buscar = Effect.fn("BuscadorDeDirecciones.buscar")(function* (consulta: string) {
        const normalizada = normalizarConsulta(consulta);
        if (url === APAGADO) {
          return yield* new BusquedaFallida({
            motivo: "apagada",
            detalle: "La búsqueda de direcciones está apagada en esta versión de Celda.",
          });
        }
        if (normalizada.length < LETRAS_MINIMAS) return [];
        return yield* Cache.get(cache, normalizada);
      });

      return BuscadorDeDirecciones.of({ buscar, atribucion: ATRIBUCION_NOMINATIM });
    }),
  );
