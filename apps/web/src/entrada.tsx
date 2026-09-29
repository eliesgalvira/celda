// Lo primero: pone en marcha la descarga del mapa base antes de evaluar el resto.
import "./mapa/precarga.ts";
import "@celda/ui/tema.css";

import { render } from "@solidjs/web";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { App } from "./App.tsx";
import { indexadorDelNavegador } from "./capa/navegador.ts";
import { conOrigenDeReserva, memoriaEnElNavegador } from "./capa/origenes.ts";
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

/** Los servicios reales, con la configuración de las variables `VITE_*` del build. */
const servicios = Layer.mergeAll(
  Layer.mergeAll(
    fichasDelOrigen.pipe(
      Layer.provideMerge(capaDelOrigen),
      Layer.provide(indexadorDelNavegador),
      // R2 y, si no contesta, la copia de reserva de Vercel (ADR 0010).
      Layer.provide(conOrigenDeReserva.pipe(Layer.provide(memoriaEnElNavegador(window)))),
    ),
    buscadorNominatim,
  ).pipe(Layer.provide(FetchHttpClient.layer)),
  simuladorDelNavegador,
  geolocalizacionDelNavegador(navigator, dispositivo),
  brujulaDelNavegador(window, dispositivo),
  almacenEnIndexedDb(globalThis.indexedDB),
  criptoDelNavegador,
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env))));

const raiz = document.getElementById("raiz");
if (raiz !== null) {
  render(() => <App servicios={servicios} />, raiz);
}
