// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
// Un servidor HTTPS con certificados a medida y los ficheros de esos certificados: Effect no tiene
// un servidor HTTPS propio, y los certificados se leen una vez, al cargar la prueba.
// @effect-diagnostics nodeBuiltinImport:off
import { clienteDeFuente, type OpcionesCliente } from "@celda/ingesta/cliente";
import { describirError } from "@celda/ingesta/extractor";
import { INTERMEDIO_FNMT } from "@celda/ingesta/registro-oficial/intermedio";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as NodeFS from "node:fs";
import * as NodeHttps from "node:https";
import type * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import {
  clienteHttpDelRegistro,
  type Confianza,
  confianzaDelRegistro,
} from "./conexionDelRegistro.ts";

/** Los certificados de prueba de `pruebas/tls/generar.sh`. */
const certificado = (nombre: string): string =>
  NodeFS.readFileSync(new URL(`pruebas/tls/${nombre}`, import.meta.url), "utf8");

const RAIZ = certificado("raiz.pem");
const INTERMEDIO = certificado("intermedio.pem");

/** Un servidor HTTPS en localhost que presenta solo la hoja, sin el intermedio que la firma. */
const servidorSinCadena = (hoja: string) =>
  Effect.acquireRelease(
    Effect.callback<NodeHttps.Server>((reanudar) => {
      const servidor = NodeHttps.createServer(
        { cert: certificado(`${hoja}.pem`), key: certificado(`${hoja}.key`) },
        (peticion, respuesta) => {
          respuesta.end(peticion.url === "/robots.txt" ? "User-agent: *\nAllow: /\n" : "hola");
        },
      );
      servidor.listen(0, "127.0.0.1", () => reanudar(Effect.succeed(servidor)));
    }),
    (servidor) =>
      Effect.callback<void>((reanudar) => {
        servidor.closeAllConnections();
        servidor.close(() => reanudar(Effect.void));
      }),
  ).pipe(
    Effect.map((servidor) => {
      // SAFETY: un servidor que escucha en un puerto TCP da su dirección como `AddressInfo`.
      const { port } = servidor.address() as NodeNet.AddressInfo;
      return `https://localhost:${port}`;
    }),
  );

const OPCIONES: OpcionesCliente = {
  userAgent: "Celda (prueba)",
  pausa: Duration.zero,
  maxPeticiones: 10,
  espera: Duration.seconds(10),
  reintentos: 0,
};

/** Pide `/hola` al servidor con la hoja `hoja` desde un cliente que confía en `confianza`. */
const pedir = (hoja: string, confianza: Confianza) =>
  Effect.gen(function* () {
    const origen = yield* servidorSinCadena(hoja);
    const cliente = yield* clienteDeFuente(origen, OPCIONES);
    const respuesta = yield* cliente.pedir(`${origen}/hola`);
    return new TextDecoder().decode(respuesta.cuerpo);
  }).pipe(Effect.scoped, Effect.provide(clienteHttpDelRegistro(confianza)), Effect.result);

/** El motivo de un fallo del cliente, o `""` si no ha fallado. */
const motivo = (salida: Effect.Success<ReturnType<typeof pedir>>): string =>
  Result.isFailure(salida) ? describirError(salida.failure) : "";

describe("la conexión con el registro oficial", () => {
  it.live("sin el intermedio, no puede verificar una hoja que llega sola y dice por qué", () =>
    Effect.gen(function* () {
      const salida = yield* pedir("hoja", { raices: [RAIZ], intermedios: [] });
      assert.strictEqual(salida._tag, "Failure");
      assert.include(motivo(salida), "el certificado del servidor no se pudo verificar");
      assert.include(motivo(salida), "falta el certificado de su emisor");
      assert.notInclude(motivo(salida), "--use-system-ca");
    }),
  );

  it.live("con el intermedio, completa la cadena hasta la raíz", () =>
    Effect.gen(function* () {
      const salida = yield* pedir("hoja", { raices: [RAIZ], intermedios: [INTERMEDIO] });
      if (Result.isFailure(salida)) return assert.fail(describirError(salida.failure));
      assert.strictEqual(salida.success, "hola");
    }),
  );

  it.live("sigue rechazando la hoja de otra autoridad que llega sin su cadena", () =>
    Effect.gen(function* () {
      const salida = yield* pedir("otra-hoja", { raices: [RAIZ], intermedios: [INTERMEDIO] });
      assert.strictEqual(salida._tag, "Failure");
      assert.include(motivo(salida), "el certificado del servidor no se pudo verificar");
    }),
  );

  it.live("no toma el intermedio por una raíz: sin la raíz, la cadena no vale", () =>
    Effect.gen(function* () {
      const salida = yield* pedir("hoja", { raices: [], intermedios: [INTERMEDIO] });
      assert.strictEqual(salida._tag, "Failure");
      assert.include(motivo(salida), "el certificado del servidor no se pudo verificar");
    }),
  );

  it("confía en las raíces de siempre de Node y en el intermedio de la FNMT", () => {
    const confianza = confianzaDelRegistro();
    assert.deepStrictEqual(confianza.raices, NodeTls.getCACertificates("default"));
    assert.deepStrictEqual(confianza.intermedios, [INTERMEDIO_FNMT]);
  });
});
