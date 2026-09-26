import "@celda/ui/tema.css";

import { render } from "@solidjs/web";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { App } from "./App.tsx";
import { capaEnVivo } from "./capa/servicio.ts";
import { fichasEnVivo } from "./ficha/servicio.ts";

/** Los servicios de datos reales, con la configuración de las variables `VITE_*` del build. */
const servicios = Layer.merge(
  capaEnVivo.pipe(Layer.provide(FetchHttpClient.layer)),
  fichasEnVivo,
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env))));

const raiz = document.getElementById("raiz");
if (raiz !== null) {
  render(() => <App servicios={servicios} />, raiz);
}
