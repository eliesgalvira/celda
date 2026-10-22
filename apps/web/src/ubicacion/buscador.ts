import { type Coordenada, contiene, type Rectangulo } from "@celda/dominio/area";
import { nombreDeResultado } from "@celda/dominio/nombreDeLugar";
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

import type { VariableDeLaWeb } from "../variables.ts";

/** Una dirección encontrada: cómo se llama, dónde queda y su posición. */
export interface Direccion {
  /** Lo que se busca: «Carrer de Provença, 450» o «Basílica de la Sagrada Familia». */
  readonly nombre: string;
  /** Dónde queda dentro del municipio: la calle, el barrio, el distrito o el pueblo. */
  readonly detalle: string;
  /**
   * El municipio y su provincia, «Medinaceli (Soria)». Distingue los lugares que se llaman igual en
   * municipios distintos. Vacío si Nominatim no da ninguno de los dos.
   */
  readonly lugar: string;
  readonly posicion: Coordenada;
}

/** La búsqueda no ha podido hacerse, y por qué. */
export class BusquedaFallida extends Schema.TaggedError<BusquedaFallida>()("BusquedaFallida", {
  motivo: Schema.Literals(["apagada", "sin-respuesta", "limite"]),
  detalle: Schema.String,
}) {}

/**
 * La búsqueda de direcciones para elegir un punto (historias 9, 26 y 27). Solo busca cuando la
 * persona lo pide, nunca mientras escribe, y en toda España.
 */
export class BuscadorDeDirecciones extends Context.Service<
  BuscadorDeDirecciones,
  {
    /**
     * Las direcciones de España que responden a la consulta. Las que caen en `encuadre`, lo que se
     * ve del mapa, van primero; las demás siguen detrás, en el orden de Nominatim.
     */
    readonly buscar: (
      consulta: string,
      encuadre?: Rectangulo,
    ) => Effect.Effect<ReadonlyArray<Direccion>, BusquedaFallida>;
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
/** En toda España hay muchos lugares con el mismo nombre: se piden más para poder elegir. */
const RESULTADOS = 10;

const Resultado = Schema.Struct({
  lat: Schema.FiniteFromString,
  lon: Schema.FiniteFromString,
  name: Schema.optional(Schema.String),
  /** Todas las etiquetas `name*` del lugar: de aquí sale su `name:es`. */
  namedetails: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  address: Schema.optional(
    Schema.Struct({
      road: Schema.optional(Schema.String),
      pedestrian: Schema.optional(Schema.String),
      house_number: Schema.optional(Schema.String),
      neighbourhood: Schema.optional(Schema.String),
      quarter: Schema.optional(Schema.String),
      suburb: Schema.optional(Schema.String),
      city_district: Schema.optional(Schema.String),
      borough: Schema.optional(Schema.String),
      hamlet: Schema.optional(Schema.String),
      village: Schema.optional(Schema.String),
      town: Schema.optional(Schema.String),
      city: Schema.optional(Schema.String),
      municipality: Schema.optional(Schema.String),
      province: Schema.optional(Schema.String),
      state_district: Schema.optional(Schema.String),
      state: Schema.optional(Schema.String),
    }),
  ),
});
type Resultado = typeof Resultado.Type;

const leerRespuesta = HttpClientResponse.schemaBodyJson(Schema.Array(Resultado));

/** Quita lo que falta, lo vacío, lo repetido y lo que ya se dice en `ya`. */
const partes = (
  lista: ReadonlyArray<string | undefined>,
  ya: ReadonlyArray<string | undefined>,
): ReadonlyArray<string> => [
  ...new Set(
    lista.filter(
      (parte): parte is string => parte !== undefined && parte !== "" && !ya.includes(parte),
    ),
  ),
];

/**
 * «Municipio (Provincia)». Sin provincia, la comunidad; sin municipio, «Provincia de …» o la
 * comunidad.
 */
const lugarDe = (
  municipio: string | undefined,
  provincia: string | undefined,
  comunidad: string | undefined,
): string => {
  const region = provincia ?? comunidad;
  if (municipio !== undefined) return region === undefined ? municipio : `${municipio} (${region})`;
  if (provincia !== undefined) return `Provincia de ${provincia}`;
  return comunidad ?? "";
};

/**
 * De un resultado de Nominatim a una dirección con un nombre corto, dónde queda y en qué
 * municipio y provincia. `enLaComunitat` dice si su punto cae en la Comunitat Valenciana.
 *
 * En España, Nominatim da el municipio en `municipality` cuando el límite municipal no está unido
 * a un núcleo (los concellos de Galicia) y si no, en `city`, `town` o `village`, por ese orden. En
 * un núcleo de un municipio mayor, `village` o `hamlet` es el núcleo y `town`, el municipio
 * (Bajamar, en San Cristóbal de La Laguna). La provincia llega en `state_district`; en las
 * comunidades de una sola provincia no llega, y se da la comunidad (Comunidad de Madrid).
 *
 * Con `accept-language=und`, Nominatim da el `name` de OpenStreetMap, que en los bilingües lleva
 * las dos formas: «Donostia / San Sebastián», «Alacant / Alicante». Cada nombre va en una sola,
 * como en el mapa base (ADR 0025, `nombreDeResultado`): la del resultado con su `name:es`, que
 * llega en `namedetails`, y las de la dirección por la tabla de bilingües o, si no está, la
 * primera.
 */
const direccionDe = (resultado: Resultado, enLaComunitat: boolean): Direccion | undefined => {
  const unaForma = (nombre: string | undefined, es?: string): string | undefined =>
    nombre === undefined ? undefined : nombreDeResultado(nombre, es, enLaComunitat);
  const original = resultado.address ?? {};
  const direccion = {
    road: unaForma(original.road),
    pedestrian: unaForma(original.pedestrian),
    house_number: original.house_number,
    neighbourhood: unaForma(original.neighbourhood),
    quarter: unaForma(original.quarter),
    suburb: unaForma(original.suburb),
    city_district: unaForma(original.city_district),
    borough: unaForma(original.borough),
    hamlet: unaForma(original.hamlet),
    village: unaForma(original.village),
    town: unaForma(original.town),
    city: unaForma(original.city),
    municipality: unaForma(original.municipality),
    province: unaForma(original.province),
    state_district: unaForma(original.state_district),
    state: unaForma(original.state),
  };
  const name = unaForma(resultado.name, resultado.namedetails?.["name:es"]);
  const calle = direccion.road ?? direccion.pedestrian;
  const conNumero =
    calle === undefined
      ? undefined
      : [calle, direccion.house_number].filter((parte) => parte !== undefined).join(", ");
  const nombre = name !== undefined && name !== "" ? name : conNumero;
  if (nombre === undefined) return undefined;
  const municipio = direccion.municipality ?? direccion.city ?? direccion.town ?? direccion.village;
  const provincia = direccion.province ?? direccion.state_district;
  const detalle = partes(
    [
      nombre === conNumero ? undefined : calle,
      direccion.quarter ?? direccion.neighbourhood,
      direccion.suburb ?? direccion.city_district ?? direccion.borough,
      direccion.village,
      direccion.hamlet,
    ],
    [nombre, municipio],
  );
  return {
    nombre,
    detalle: detalle.join(", "),
    lugar: lugarDe(municipio, provincia, direccion.state),
    posicion: { longitud: resultado.lon, latitud: resultado.lat },
  };
};

/**
 * Las direcciones de la respuesta, en su orden y sin repetir las que se leen igual.
 * `enLaComunitat` dice si un punto cae en la Comunitat Valenciana.
 */
const direccionesDe = (
  resultados: ReadonlyArray<Resultado>,
  enLaComunitat: (posicion: Coordenada) => boolean,
): ReadonlyArray<Direccion> => {
  const vistas = new Set<string>();
  return resultados.flatMap((resultado) => {
    const direccion = direccionDe(
      resultado,
      enLaComunitat({ longitud: resultado.lon, latitud: resultado.lat }),
    );
    if (direccion === undefined) return [];
    const clave = `${direccion.nombre}|${direccion.detalle}|${direccion.lugar}`;
    if (vistas.has(clave)) return [];
    vistas.add(clave);
    return [direccion];
  });
};

/**
 * Primero las direcciones que caen en lo que se ve del mapa y después las demás, cada grupo en el
 * orden en que llegó. Sin encuadre, el orden no cambia.
 */
export const ordenarPorEncuadre = (
  direcciones: ReadonlyArray<Direccion>,
  encuadre: Rectangulo | undefined,
): ReadonlyArray<Direccion> => {
  if (encuadre === undefined) return direcciones;
  const dentro = direcciones.filter((direccion) => contiene(encuadre, direccion.posicion));
  return dentro.length === 0
    ? direcciones
    : [...dentro, ...direcciones.filter((direccion) => !dentro.includes(direccion))];
};

const ATRIBUCION_NOMINATIM: Credito = {
  texto: "Nominatim · datos de OpenStreetMap (ODbL)",
  enlace: "https://nominatim.org/",
};

/**
 * El buscador sobre la API de Nominatim en `VITE_BUSCADOR_URL` (por defecto, el servidor público
 * de OpenStreetMap). Respeta su política de uso (ADR 0013): una petición por segundo como mucho
 * desde cada navegador, solo al pedirlo la persona y con caché. Busca en toda España, sin
 * `viewbox`: Nominatim descarta lo que queda fuera de la caja en cuanto encuentra algo dentro, y
 * lo que se ve del mapa solo cambia el orden, aquí. Con `VITE_BUSCADOR_URL=apagado`, el buscador
 * queda apagado y lo dice.
 */
export const buscadorNominatim: Layer.Layer<BuscadorDeDirecciones, never, HttpClient.HttpClient> =
  Layer.effect(
    BuscadorDeDirecciones,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const url = yield* Config.String("VITE_BUSCADOR_URL" satisfies VariableDeLaWeb).pipe(
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
            // El `name:es` de cada lugar, para escribir en una sola forma un nombre con dos
            // (ADR 0025). Va en la misma respuesta: no es otra petición.
            namedetails: "1",
            limit: String(RESULTADOS),
            countrycodes: "es",
            // Los topónimos, en su nombre oficial: Girona, A Coruña, Donostia / San Sebastián.
            // Sin este parámetro, Nominatim usa el idioma del navegador y daría «Gerona» o «La
            // Coruña». Con un idioma que ningún lugar tiene (`und`, «sin determinar»), usa la
            // etiqueta `name` de OpenStreetMap, que es el nombre local. Los que llevan dos se
            // quedan en una (`direccionDe`).
            "accept-language": "und",
          },
        });

      const sinRespuesta = (detalle: string) =>
        new BusquedaFallida({ motivo: "sin-respuesta", detalle });

      /**
       * Si un punto cae en la Comunitat Valenciana. Su contorno (3,5 KB con gzip) se descarga con
       * la primera respuesta, no con la primera pantalla, y se queda para las demás. Si no llega,
       * la búsqueda falla y la siguiente lo vuelve a pedir.
       */
      const enLaComunitat = yield* Effect.tryPromise({
        try: () => import("@celda/dominio/comunitatValenciana"),
        catch: () => sinRespuesta("No ha llegado el contorno de la Comunitat Valenciana."),
      }).pipe(
        Effect.map((modulo) => modulo.enLaComunitatValenciana),
        Effect.cachedWithTTL((salida) =>
          Exit.isSuccess(salida) ? Duration.infinity : Duration.zero,
        ),
      );

      const pedir = (consulta: string): Effect.Effect<ReadonlyArray<Resultado>, BusquedaFallida> =>
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
          return resultados;
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

      const buscar = Effect.fn("BuscadorDeDirecciones.buscar")(function* (
        consulta: string,
        encuadre?: Rectangulo,
      ) {
        const normalizada = normalizarConsulta(consulta);
        if (url === APAGADO) {
          return yield* new BusquedaFallida({
            motivo: "apagada",
            detalle: "La búsqueda de direcciones está apagada en esta versión de Celda.",
          });
        }
        if (normalizada.length < LETRAS_MINIMAS) return [];
        // La caché guarda la respuesta de Nominatim; el orden depende de lo que se vea ahora.
        const resultados = yield* Cache.get(cache, normalizada);
        // El contorno llega después de la respuesta, fuera del turno y de su espera máxima.
        const direcciones = direccionesDe(resultados, yield* enLaComunitat);
        return ordenarPorEncuadre(direcciones, encuadre);
      });

      return BuscadorDeDirecciones.of({ buscar, atribucion: ATRIBUCION_NOMINATIM });
    }),
  );
