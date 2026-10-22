import type { Ficha } from "@celda/dominio/ficha";
import { generarLoteDeProvincia } from "@celda/dominio/provincias";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { FUENTE_DE_MUNICIPIOS } from "../capa/pruebas.ts";
import { FichaNoLeida, FichasPublicadas } from "./servicio.ts";

/** Lo que el servicio de prueba contesta: una ficha, que no existe o un fallo. */
type RespuestaDePrueba = Ficha | "no-existe" | FichaNoLeida;

export interface FichasDePrueba {
  readonly capa: Layer.Layer<FichasPublicadas>;
  /**
   * Entrega `respuesta` a las lecturas abiertas de `clave`, cuando la prueba quiera: así se
   * simulan respuestas lentas. Sin lecturas abiertas no llega a nadie.
   */
  readonly responder: (clave: string, respuesta: RespuestaDePrueba) => void;
  /** Las claves con una lectura abierta ahora, en el orden en que se abrieron. */
  readonly abiertas: () => ReadonlyArray<string>;
}

const esFallo = Schema.is(FichaNoLeida);

/**
 * Un servicio de fichas de prueba que no contesta nada hasta que la prueba se lo pide. Es para las
 * pantallas que abren fichas sin probarlas; el panel se prueba con el servicio real sobre
 * `origenDePrueba`.
 */
export const fichasDePrueba = (): FichasDePrueba => {
  const lecturas: Array<{
    readonly clave: string;
    readonly reanudar: (efecto: Effect.Effect<Option.Option<Ficha>, FichaNoLeida>) => void;
  }> = [];

  const leer = ({ clave }: { readonly clave: string }) =>
    Effect.callback<Option.Option<Ficha>, FichaNoLeida>((reanudar) => {
      const lectura = { clave, reanudar };
      lecturas.push(lectura);
      return Effect.sync(() => {
        const i = lecturas.indexOf(lectura);
        if (i >= 0) lecturas.splice(i, 1);
      });
    });

  return {
    capa: Layer.succeed(
      FichasPublicadas,
      FichasPublicadas.of({
        leer,
        precargar: () => Effect.void,
        baremo: () => Effect.succeed(Option.none()),
      }),
    ),
    responder: (clave, respuesta) => {
      for (const lectura of lecturas.filter((l) => l.clave === clave)) {
        lecturas.splice(lecturas.indexOf(lectura), 1);
        lectura.reanudar(
          esFallo(respuesta)
            ? Effect.fail(respuesta)
            : Effect.succeed(respuesta === "no-existe" ? Option.none() : Option.some(respuesta)),
        );
      }
    },
    abiertas: () => lecturas.map((l) => l.clave),
  };
};

/** Lo que el origen de prueba contesta a una petición: un estado y un cuerpo. */
export interface RespuestaHttp {
  readonly estado: number;
  readonly cuerpo: string;
}

export interface OrigenDePrueba {
  readonly capa: Layer.Layer<HttpClient.HttpClient>;
  /** Contesta a las peticiones abiertas de `url`. Sin peticiones abiertas no llega a nadie. */
  readonly responder: (url: string, respuesta: RespuestaHttp) => void;
  /** Las URL con una petición abierta ahora, en orden. */
  readonly abiertas: () => ReadonlyArray<string>;
  /** Todas las URL pedidas desde el principio, en orden. */
  readonly pedidas: () => ReadonlyArray<string>;
  /** Las URL cuyas peticiones se cancelaron antes de la respuesta. */
  readonly canceladas: () => ReadonlyArray<string>;
}

/**
 * Un origen estático de prueba: cada petición queda abierta hasta que la prueba la contesta, o
 * hasta que quien la hizo la cancela. Así se prueban respuestas lentas, fuera de orden y
 * cancelaciones con el cliente HTTP real de los servicios.
 */
export const origenDePrueba = (): OrigenDePrueba => {
  const abiertas: Array<{ readonly url: string; readonly contestar: (r: RespuestaHttp) => void }> =
    [];
  const pedidas: Array<string> = [];
  const canceladas: Array<string> = [];

  const cliente = HttpClient.make((request, url) =>
    Effect.callback<HttpClientResponse.HttpClientResponse>((reanudar) => {
      const abierta = {
        url: url.href,
        contestar: (respuesta: RespuestaHttp) => {
          reanudar(
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(respuesta.cuerpo, { status: respuesta.estado }),
              ),
            ),
          );
        },
      };
      abiertas.push(abierta);
      pedidas.push(url.href);
      return Effect.sync(() => {
        const i = abiertas.indexOf(abierta);
        if (i >= 0) {
          abiertas.splice(i, 1);
          canceladas.push(url.href);
        }
      });
    }),
  );

  return {
    capa: Layer.succeed(HttpClient.HttpClient, cliente),
    responder: (url, respuesta) => {
      for (const abierta of abiertas.filter((a) => a.url === url)) {
        abiertas.splice(abiertas.indexOf(abierta), 1);
        abierta.contestar(respuesta);
      }
    },
    abiertas: () => abiertas.map((a) => a.url),
    pedidas: () => [...pedidas],
    canceladas: () => [...canceladas],
  };
};

/** El cuerpo de un lote de fichas de Barcelona con esas fichas, como lo publica Celda. */
export const loteConFichas = (fichas: ReadonlyArray<Ficha>): RespuestaHttp => ({
  estado: 200,
  cuerpo: generarLoteDeProvincia("08", fichas, new Map(), FUENTE_DE_MUNICIPIOS),
});
