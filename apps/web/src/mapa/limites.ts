import { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import { type LineasDeLimites, lineasDeLimites } from "@celda/ui/mapa/limites.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * Los límites de comunidades y provincias del mapa (ADR 0023). Son un fichero de la propia web
 * (`limites.json`, que escribe `pnpm run limites` en `tools/capas`), servido con la huella en el
 * nombre y una caché inmutable. No va en el JavaScript: se pide después del primer pintado
 * completo del mapa, para no quitarle red ni CPU al mapa base ni a los marcadores.
 */

/** El fichero de límites no ha llegado o no se puede leer. */
export class LimitesNoDescargados extends Schema.TaggedError<LimitesNoDescargados>()(
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
  /** Llama a `escuchar` una sola vez, cuando el mapa acaba su primer pintado completo. */
  readonly trasElPrimerPintado: (escuchar: () => void) => void;
  /** Llama a `escuchar` cuando el mapa se quita: después ya no se le puede pedir nada. */
  readonly alQuitarse: (escuchar: () => void) => void;
  /** Pone las líneas en la fuente de los límites. */
  readonly dibujar: (lineas: LineasDeLimites) => void;
}

/**
 * Pone los límites en cada mapa que recibe, después de su primer pintado. El fichero se pide la
 * primera vez que hace falta y se guarda para toda la visita: mover el mapa no lo vuelve a pedir,
 * y si el mapa se crea otra vez, el nuevo recibe las mismas líneas. Si no llega, el mapa se queda
 * sin límites de comunidad y provincia y nada se reintenta solo; el siguiente mapa que se cree lo
 * vuelve a pedir.
 */
export const limitesDeLaVisita = (
  leer: Effect.Effect<LimitesDeComunidadesYProvincias, LimitesNoDescargados>,
): ((mapa: MapaParaLimites) => void) => {
  let lineas: Promise<LineasDeLimites | undefined> | undefined;
  const pedir = () => {
    lineas ??= Effect.runPromiseExit(leer).then((salida) => {
      if (Exit.isSuccess(salida)) return lineasDeLimites(salida.value);
      lineas = undefined;
      return undefined;
    });
    return lineas;
  };
  return (mapa) => {
    let quitado = false;
    mapa.alQuitarse(() => {
      quitado = true;
    });
    mapa.trasElPrimerPintado(() => {
      void pedir().then((llegadas) => {
        if (llegadas !== undefined && !quitado) mapa.dibujar(llegadas);
      });
    });
  };
};
