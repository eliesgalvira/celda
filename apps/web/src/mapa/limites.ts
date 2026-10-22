import { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import { type LineasDeLimites, lineasDeLimites } from "@celda/ui/mapa/limites.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * Los límites de comunidades y provincias del mapa (ADR 0023), en dos ficheros de la propia web
 * que escribe `pnpm run limites` en `tools/capas`, servidos con la huella en el nombre y una caché
 * inmutable. El general (`limites.json`, simplificado a 1 km) se pide al arrancar y se dibuja con
 * la silueta de España, antes que el mapa base. El de detalle (`limites-detalle.json`, a 150 m)
 * se pide la primera vez que el mapa se acerca a `ZOOM_DEL_DETALLE` y sustituye al general en la
 * misma fuente, sin parpadeo ni líneas dobles.
 */

/** Desde este zoom, la línea a 1 km se separa a la vista de la real. */
export const ZOOM_DEL_DETALLE = 7;

/** El fichero de límites no ha llegado o no se puede leer. */
class LimitesNoDescargados extends Schema.TaggedError<LimitesNoDescargados>()(
  "LimitesNoDescargados",
  { url: Schema.String, motivo: Schema.String },
) {}

const decodificar = Schema.decodeEffect(Schema.fromJsonString(LimitesDeComunidadesYProvincias));

/** Descarga y lee el fichero de límites de `url`. */
export const leerLimites = Effect.fn("Mapa.leerLimites")(function* (url: string) {
  const http = yield* HttpClient.HttpClient;
  const fallo = (motivo: string) => new LimitesNoDescargados({ url, motivo });
  const respuesta = yield* http.get(url).pipe(Effect.mapError((error) => fallo(error.message)));
  const texto = yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
    Effect.flatMap((ok) => ok.text),
    Effect.mapError((error) => fallo(error.message)),
  );
  return yield* decodificar(texto).pipe(Effect.mapError((error) => fallo(error.message)));
});

/** Lo que hacen los límites con un mapa. En las pruebas, un mapa que apunta lo que recibe. */
export interface MapaParaLimites {
  /**
   * Llama a `escuchar` cuando el mapa ya ha pintado la silueta de España: las líneas nunca salen
   * sueltas sobre el fondo, sin la tierra ni la costa.
   */
  readonly trasLaSilueta: (escuchar: () => void) => void;
  /** Llama a `escuchar` una sola vez, la primera vez que el mapa llega a `zoom` o más cerca. */
  readonly alAcercarse: (zoom: number, escuchar: () => void) => void;
  /** Llama a `escuchar` cuando el mapa se quita: después ya no se le puede pedir nada. */
  readonly alQuitarse: (escuchar: () => void) => void;
  /** Pone las líneas en la fuente de los límites. */
  readonly dibujar: (lineas: LineasDeLimites) => void;
}

/**
 * Un fichero que se pide la primera vez que hace falta y se guarda para toda la visita. Si no
 * llega, da `undefined` y la siguiente vez se vuelve a pedir.
 */
const unaVezPorVisita = (
  leer: Effect.Effect<LimitesDeComunidadesYProvincias, LimitesNoDescargados>,
): (() => Promise<LineasDeLimites | undefined>) => {
  let lineas: Promise<LineasDeLimites | undefined> | undefined;
  return () => {
    lineas ??= Effect.runPromiseExit(leer).then((salida) => {
      if (Exit.isSuccess(salida)) return lineasDeLimites(salida.value);
      lineas = undefined;
      return undefined;
    });
    return lineas;
  };
};

/** Los dos ficheros de límites: el general, que va desde el principio, y el de detalle. */
export interface LecturasDeLimites {
  readonly general: Effect.Effect<LimitesDeComunidadesYProvincias, LimitesNoDescargados>;
  readonly detalle: Effect.Effect<LimitesDeComunidadesYProvincias, LimitesNoDescargados>;
}

/**
 * Los límites de la visita. `adelantar` pide ya el general, al cargarse el código del mapa.
 * `poner` los dibuja en cada mapa que recibe: el general en cuanto el mapa pinta la silueta y el
 * de detalle la primera vez que el mapa pasa de `ZOOM_DEL_DETALLE`. Una vez puesto el de detalle,
 * el general ya no lo pisa aunque llegue tarde. Mover el mapa no vuelve a pedir nada, y si el mapa
 * se crea otra vez, el nuevo recibe las mismas líneas. Si un fichero no llega, el mapa se queda
 * con lo que tenga y nada se reintenta solo; el siguiente mapa que se cree lo vuelve a pedir.
 */
export const limitesDeLaVisita = (leer: LecturasDeLimites) => {
  const general = unaVezPorVisita(leer.general);
  const detalle = unaVezPorVisita(leer.detalle);
  return {
    adelantar: (): void => {
      void general();
    },
    poner: (mapa: MapaParaLimites): void => {
      let quitado = false;
      let conDetalle = false;
      mapa.alQuitarse(() => {
        quitado = true;
      });
      const conSilueta = new Promise<void>((resolver) => mapa.trasLaSilueta(resolver));
      const dibujar = (lineas: Promise<LineasDeLimites | undefined>, deDetalle: boolean) =>
        void Promise.all([lineas, conSilueta]).then(([llegadas]) => {
          if (llegadas === undefined || quitado || conDetalle) return;
          conDetalle = deDetalle;
          mapa.dibujar(llegadas);
        });
      dibujar(general(), false);
      mapa.alAcercarse(ZOOM_DEL_DETALLE, () => dibujar(detalle(), true));
    },
  };
};
