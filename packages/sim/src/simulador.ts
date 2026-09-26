import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { atender, type Respuesta, type Solicitud } from "./protocolo.ts";
import { SIMULACIONES, type SimulacionRegistrada } from "./registro.ts";
import type { Malla, Resultado, Simulacion } from "./simulacion.ts";

/** Una simulación no ha dado resultado: parámetros no válidos, versión distinta o Worker caído. */
export class SimulacionFallida extends Schema.TaggedError<SimulacionFallida>()(
  "SimulacionFallida",
  {
    simulacion: Schema.String,
    motivo: Schema.String,
  },
) {}

/**
 * Ejecuta simulaciones (ADR 0005). En el navegador lo hace un Web Worker, y la interfaz sigue
 * respondiendo mientras calcula. Interrumpir `ejecutar`, por ejemplo porque se ha seleccionado
 * otro emplazamiento, cancela el cálculo en curso.
 */
export class Simulador extends Context.Service<
  Simulador,
  {
    readonly ejecutar: <P, R extends Resultado>(
      simulacion: Simulacion<P, R>,
      params: P,
      malla: Malla,
    ) => Effect.Effect<R, SimulacionFallida>;
  }
>()("@celda/sim/simulador") {}

/** Cómo se hace llegar una solicitud a quien calcula. */
type Enviar = (solicitud: Solicitud) => Effect.Effect<Respuesta, SimulacionFallida>;

const conEnvio = (enviar: Enviar) => {
  let numero = 0;
  return Simulador.of({
    ejecutar: Effect.fn("Simulador.ejecutar")(function* <P, R extends Resultado>(
      simulacion: Simulacion<P, R>,
      params: P,
      malla: Malla,
    ) {
      const fallo = (motivo: string) =>
        new SimulacionFallida({ simulacion: `${simulacion.id}@${simulacion.version}`, motivo });
      // Cada simulación trae su esquema: no hay uno que compilar una sola vez.
      // oxlint-disable-next-line celda/no-inline-schema-compile
      const codificados = yield* Schema.encodeEffect(simulacion.params)(params).pipe(
        Effect.mapError((error) => fallo(`Parámetros no válidos: ${error.message}`)),
      );
      numero += 1;
      const respuesta = yield* enviar({
        numero,
        simulacion: simulacion.id,
        version: simulacion.version,
        params: codificados,
        malla,
      });
      if (respuesta.tipo === "fallo") {
        return yield* fallo(respuesta.motivo);
      }
      // SAFETY: quien ha calculado es esta misma simulación, con el mismo id y la misma versión
      // (atender lo comprueba), así que el resultado tiene la forma de `R`.
      return respuesta.resultado as R;
    }),
  });
};

/**
 * El simulador que calcula en el mismo hilo, con el mismo registro y el mismo protocolo que el
 * Worker. Es el de las pruebas y el de Node.
 */
export const simuladorEnHilo = (
  registro: ReadonlyArray<SimulacionRegistrada> = SIMULACIONES,
): Layer.Layer<Simulador> =>
  Layer.succeed(
    Simulador,
    conEnvio((solicitud) => Effect.sync(() => atender(registro, solicitud))),
  );

/**
 * Lo que el simulador necesita de un Worker. En el navegador lo da `new Worker(...)`; en las
 * pruebas, un Worker de prueba que contesta cuando la prueba quiere.
 */
export interface PuertoWorker {
  readonly enviar: (solicitud: Solicitud) => void;
  /** Registra quién recibe las respuestas y los fallos del Worker. Se llama una vez. */
  readonly escuchar: (
    alResponder: (respuesta: Respuesta) => void,
    alFallar: (motivo: string) => void,
  ) => void;
  readonly terminar: () => void;
}

/**
 * El simulador que calcula en un Worker. Atiende una solicitud cada vez. Si una se interrumpe a
 * medias, termina el Worker, porque un cálculo síncrono no se puede parar de otra forma, y la
 * siguiente arranca uno nuevo. `crear` no se llama hasta la primera simulación.
 */
export const simuladorEnWorker = (crear: () => PuertoWorker): Layer.Layer<Simulador> =>
  Layer.effect(
    Simulador,
    Effect.gen(function* () {
      const turno = yield* Semaphore.make(1);
      let actual: PuertoWorker | undefined;
      let alResponder: (respuesta: Respuesta) => void = () => undefined;
      let alFallar: (motivo: string) => void = () => undefined;

      const descartar = (puerto: PuertoWorker) => {
        puerto.terminar();
        if (actual === puerto) {
          actual = undefined;
        }
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (actual !== undefined) {
            descartar(actual);
          }
        }),
      );

      const puerto = (): PuertoWorker => {
        if (actual === undefined) {
          const nuevo = crear();
          nuevo.escuchar(
            (respuesta) => alResponder(respuesta),
            (motivo) => alFallar(motivo),
          );
          actual = nuevo;
        }
        return actual;
      };

      const enviar: Enviar = (solicitud) =>
        Effect.callback<Respuesta, SimulacionFallida>((resume) => {
          const destino = puerto();
          alResponder = (respuesta) => {
            if (respuesta.numero === solicitud.numero) {
              resume(Effect.succeed(respuesta));
            }
          };
          alFallar = (motivo) => {
            descartar(destino);
            resume(
              Effect.fail(
                new SimulacionFallida({
                  simulacion: `${solicitud.simulacion}@${solicitud.version}`,
                  motivo: `El Worker ha fallado: ${motivo}`,
                }),
              ),
            );
          };
          destino.enviar(solicitud);
          return Effect.sync(() => descartar(destino));
        });

      return conEnvio((solicitud) => turno.withPermits(1)(enviar(solicitud)));
    }),
  );
