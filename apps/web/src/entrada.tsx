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
import { simuladorDelNavegador } from "./simulacion/navegador.ts";
import { almacenEnIndexedDb } from "./ubicacion/almacen.ts";
import { buscadorNominatim } from "./ubicacion/buscador.ts";
import { geolocalizacionDelNavegador } from "./ubicacion/geolocalizacion.ts";

const dispositivo = detectarDispositivo(leerNavegador()).tipo;

const almacen = almacenEnIndexedDb(globalThis.indexedDB);

/** Los servicios reales, con la configuración de las variables `VITE_*` del build. */
const servicios = Layer.mergeAll(
  Layer.mergeAll(
    // Las capas y las fichas, de `/capas` en el mismo origen que la web (ADR 0018).
    fichasDelOrigen.pipe(Layer.provideMerge(capaDelOrigen), Layer.provide(indexadorDelNavegador)),
    buscadorNominatim,
  ).pipe(Layer.provide(FetchHttpClient.layer)),
  simuladorDelNavegador,
  geolocalizacionDelNavegador(navigator, dispositivo),
  brujulaDelNavegador(window, dispositivo),
  almacen,
  // El buzón de las aportaciones (ADR 0020). Su cliente se descarga al compartir la primera vez.
  sincronizacionDelNavegador(import.meta.env["VITE_CELDA_CONVEX_URL"]).pipe(Layer.provide(almacen)),
  criptoDelNavegador,
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env))));

const raiz = document.getElementById("raiz");
if (raiz !== null) {
  render(() => <App servicios={servicios} />, raiz);
}
// Prueba de la CI (sin efecto).
