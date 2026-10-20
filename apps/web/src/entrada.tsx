// Lo primero: pone en marcha la descarga del mapa base antes de evaluar el resto.
import "./mapa/precarga.ts";
import "@celda/ui/tema.css";

import { render } from "@solidjs/web";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { App } from "./App.tsx";
import { sincronizacionDelNavegador } from "./buzon/sincronizacion.ts";
import { indexadorDelNavegador } from "./capa/navegador.ts";
import { capaDelOrigen } from "./capa/servicio.ts";
import { fichasDelOrigen } from "./ficha/servicio.ts";
import { criptoDelNavegador } from "./lib/cripto.ts";
import { brujulaDelNavegador } from "./mejorar/brujula.ts";
import { detectarDispositivo } from "./medir/dispositivo.ts";
import { leerNavegador } from "./medir/navegador.ts";
import { almacenEnIndexedDb } from "./ubicacion/almacen.ts";
import { buscadorNominatim } from "./ubicacion/buscador.ts";
import { geolocalizacionDelNavegador } from "./ubicacion/geolocalizacion.ts";
import type { VariableDeLaWeb } from "./variables.ts";

const dispositivo = detectarDispositivo(leerNavegador()).tipo;

const almacen = almacenEnIndexedDb(globalThis.indexedDB);

/**
 * Las variables de entorno del build que lee la web (`variables.ts`, #83), una a una y con su
 * nombre entero, que es como Vite escribe su valor en el JavaScript. El tipo pide todas las de la
 * lista y ninguna más.
 */
const variables: Readonly<Record<VariableDeLaWeb, string | undefined>> = {
  VITE_CELDA_CONVEX_URL: import.meta.env.VITE_CELDA_CONVEX_URL,
  VITE_BUSCADOR_URL: import.meta.env.VITE_BUSCADOR_URL,
  VITE_CAPAS_ORIGEN: import.meta.env.VITE_CAPAS_ORIGEN,
};

/** Los servicios reales, configurados con esas variables. */
const servicios = Layer.mergeAll(
  Layer.mergeAll(
    // Las capas y las fichas, de `/capas` en el mismo origen que la web (ADR 0018).
    fichasDelOrigen.pipe(Layer.provideMerge(capaDelOrigen), Layer.provide(indexadorDelNavegador)),
    buscadorNominatim,
  ).pipe(Layer.provide(FetchHttpClient.layer)),
  geolocalizacionDelNavegador(navigator, dispositivo),
  brujulaDelNavegador(window, dispositivo),
  almacen,
  // El buzón de las aportaciones (ADR 0020). Su cliente se descarga al compartir la primera vez.
  sincronizacionDelNavegador(variables.VITE_CELDA_CONVEX_URL).pipe(Layer.provide(almacen)),
  criptoDelNavegador,
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(variables))));

const raiz = document.getElementById("raiz");
if (raiz !== null) {
  render(() => <App servicios={servicios} />, raiz);
}
