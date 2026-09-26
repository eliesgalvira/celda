import { LimitesDeBarrios } from "@celda/dominio/barrio";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  CONJUNTO,
  ENLACE_CONJUNTO,
  ficheroDeLimites,
  limitesDeOpenData,
  RECURSO,
  RegistroDeBarrio,
} from "./barrios.ts";
import {
  CONJUNTO_PADRON,
  ENLACE_PADRON,
  ficheroDePoblacion,
  poblacionDeOpenData,
  RECURSO_PADRON,
} from "./poblacion.ts";

/** Se presenta como Celda, igual que la ingesta, con un contacto. */
const USER_AGENT = "Celda (generador de capas; contacto en celda.elies.site)";

/** Pausa entre las dos peticiones: el `Crawl-delay` del `robots.txt` del portal. */
const PAUSA = "10 seconds";

/** Solo se aceptan los límites con esta licencia; si cambia, hay que revisar la atribución. */
const LICENCIA_ESPERADA = "CC-BY-4.0";

/** Lo que se usa de la respuesta de `package_show` de la API CKAN del portal. */
const Paquete = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Struct({
    license_id: Schema.String,
    resources: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        url: Schema.String,
        last_modified: Schema.NullOr(Schema.String),
      }),
    ),
  }),
});

/** El portal no da lo que se esperaba: otro recurso, otra licencia u otro formato. */
export class FuenteDeBarriosCambiada extends Schema.TaggedError<FuenteDeBarriosCambiada>()(
  "FuenteDeBarriosCambiada",
  { motivo: Schema.String },
) {
  override get message() {
    return `Open Data BCN ha cambiado: ${this.motivo}. Revisa el conjunto ${ENLACE_CONJUNTO}.`;
  }
}

const cambiada = (motivo: string) => new FuenteDeBarriosCambiada({ motivo });

/**
 * Descarga los límites de barrio de Open Data BCN y los escribe en `destino`. Hace dos peticiones
 * con 10 s entre ellas: los metadatos del conjunto (enlace del fichero, licencia y fecha de los
 * datos) y el fichero. Es una orden que lanza una persona cuando el Ayuntamiento publica límites
 * nuevos, no parte de la ingesta.
 */
export const descargarBarrios = Effect.fn("Capas.descargarBarrios")(function* (destino: string) {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const pedir = (url: string) =>
    http.get(url, { headers: { "user-agent": USER_AGENT } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((error) => cambiada(`${url} no responde bien: ${error.message}`)),
    );

  const paquete = yield* pedir(
    `https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=${CONJUNTO}`,
  ).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Paquete)),
    Effect.mapError((error) => cambiada(`los metadatos no se leen: ${error.message}`)),
  );
  if (paquete.result.license_id !== LICENCIA_ESPERADA) {
    return yield* cambiada(`la licencia es ${paquete.result.license_id}`);
  }
  const recurso = paquete.result.resources.find((r) => r.name === RECURSO);
  if (recurso === undefined) {
    return yield* cambiada(`no hay ningún recurso ${RECURSO}`);
  }
  const fecha = recurso.last_modified?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fecha)) {
    return yield* cambiada(`el recurso no tiene fecha (${recurso.last_modified ?? "nula"})`);
  }

  yield* Effect.sleep(PAUSA);
  const registros = yield* pedir(recurso.url).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(RegistroDeBarrio))),
    Effect.mapError((error) => cambiada(`${RECURSO} no se lee: ${error.message}`)),
  );
  const limites = yield* Effect.fromResult(
    limitesDeOpenData(registros, {
      atribucion: "Ajuntament de Barcelona",
      licencia: "CC BY 4.0",
      enlace: ENLACE_CONJUNTO,
      fecha,
    }),
  );
  yield* fs.writeFileString(destino, ficheroDeLimites(limites));
  return limites;
});

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeBarrios));

/** Lee los límites de barrio guardados en el repositorio. */
export const leerLimites = Effect.fn("Capas.leerLimites")(function* (ruta: string) {
  const fs = yield* FileSystem.FileSystem;
  const texto = yield* fs.readFileString(ruta);
  return yield* decodificarLimites(texto);
});

/** Lo que se usa de `package_show` para el padrón: sus CSV tienen la fecha en `created`. */
const PaqueteDelPadron = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Struct({
    license_id: Schema.String,
    resources: Schema.Array(
      Schema.Struct({ name: Schema.String, url: Schema.String, created: Schema.String }),
    ),
  }),
});

/** El padrón del portal no es el que se esperaba: otra licencia, sin CSV o ilegible. */
export class FuenteDePoblacionCambiada extends Schema.TaggedError<FuenteDePoblacionCambiada>()(
  "FuenteDePoblacionCambiada",
  { motivo: Schema.String },
) {
  override get message() {
    return `El padrón de Open Data BCN ha cambiado: ${this.motivo}. Revisa ${ENLACE_PADRON}.`;
  }
}

/**
 * Descarga el padrón más reciente de Open Data BCN, suma los habitantes por barrio y los escribe
 * en `destino` con el área y el límite simplificado de `limites`. Son dos peticiones con 10 s
 * entre ellas, como `descargarBarrios`: los metadatos del conjunto y el CSV del último año. La
 * lanza una persona cuando sale el padrón de un año nuevo, cada primavera.
 */
export const descargarPoblacion = Effect.fn("Capas.descargarPoblacion")(function* (
  destino: string,
  limites: LimitesDeBarrios,
) {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const cambiadaPadron = (motivo: string) => new FuenteDePoblacionCambiada({ motivo });
  const pedir = (url: string) =>
    http.get(url, { headers: { "user-agent": USER_AGENT } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((error) => cambiadaPadron(`${url} no responde bien: ${error.message}`)),
    );

  const paquete = yield* pedir(
    `https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=${CONJUNTO_PADRON}`,
  ).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(PaqueteDelPadron)),
    Effect.mapError((error) => cambiadaPadron(`los metadatos no se leen: ${error.message}`)),
  );
  if (paquete.result.license_id !== LICENCIA_ESPERADA) {
    return yield* cambiadaPadron(`la licencia es ${paquete.result.license_id}`);
  }
  const [recurso] = paquete.result.resources
    .filter((r) => RECURSO_PADRON.test(r.name))
    .toSorted((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  if (recurso === undefined) return yield* cambiadaPadron("no hay ningún CSV por año");
  const publicada = recurso.created.slice(0, 10);

  yield* Effect.sleep(PAUSA);
  const csv = yield* pedir(recurso.url).pipe(
    Effect.flatMap((respuesta) => respuesta.text),
    Effect.mapError((error) => cambiadaPadron(`${recurso.name} no se lee: ${error.message}`)),
  );
  const poblacion = yield* Effect.fromResult(
    poblacionDeOpenData(csv, limites, {
      atribucion: "Ajuntament de Barcelona",
      licencia: "CC BY 4.0",
      enlace: ENLACE_PADRON,
      publicada,
    }),
  );
  yield* fs.writeFileString(destino, ficheroDePoblacion(poblacion));
  return poblacion;
});
