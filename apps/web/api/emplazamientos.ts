/**
 * La función de Vercel de `GET /api/emplazamientos` (ADR 0032). Lo que hace está en
 * `src/api/emplazamientos.ts`; aquí solo se monta una vez por instancia, con su caché de ficheros,
 * y se le pasa cada petición.
 */
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { atender } from "../src/api/emplazamientos.ts";
import { publicacionDelOrigen } from "../src/api/publicacion.ts";

const entorno = ManagedRuntime.make(
  publicacionDelOrigen.pipe(Layer.provide(FetchHttpClient.layer)),
);

export const GET = (peticion: Request): Promise<Response> => entorno.runPromise(atender(peticion));
