import { decodificarVigente, FICHERO_VIGENTE, type Vigente } from "@celda/dominio/capa";
import {
  decodificarManifiesto,
  ficheroDeManifiesto,
  LARGO_HUELLA,
  leerResumen,
} from "@celda/dominio/provincias";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { AlmacenDeFicheros, AlmacenNoDisponible } from "./almacen.ts";
import { sha256 } from "./almacenes/firma.ts";

/**
 * La copia de reserva de Vercel (ADR 0010): la web sirve en `/capas` una copia de la versión
 * vigente de R2, y el cliente la lee cuando R2 no responde. La copia la monta el build de Vercel,
 * que lee de R2 solo la versión vigente (`copiarVigente`). La ingesta nocturna lo lanza con el
 * deploy hook cuando la copia no sirve ya lo que dice el `vigente.json` de R2
 * (`actualizarReserva`).
 */

// ── La copia, en el build ────────────────────────────────────────────────────────────────────────

/** Lee un fichero publicado; `None` si no existe. */
export type LeerPublicado = (
  fichero: string,
) => Effect.Effect<Option.Option<string>, AlmacenNoDisponible>;

/** La versión vigente no se ha podido copiar entera: la copia no tiene `vigente.json`. */
export class CopiaIncompleta extends Schema.TaggedError<CopiaIncompleta>()("CopiaIncompleta", {
  motivo: Schema.String,
}) {}

/** Ficheros que se leen y se escriben a la vez. */
const A_LA_VEZ = 8;

const bytesDe = (texto: string): number => new TextEncoder().encode(texto).length;

/**
 * La huella del nombre de un fichero nombrado por su contenido: `provincias/08/<huella>.json`,
 * `fichas/08/<huella>.json` o `resumen@<fecha>.<huella>.json`.
 */
const huellaDelNombre = (fichero: string): string | undefined =>
  new RegExp(`[/.]([0-9a-f]{${LARGO_HUELLA}})\\.json$`, "u").exec(fichero)?.[1];

/** Lee un fichero que tiene que estar, y comprueba su huella si la lleva en el nombre. */
const leerEntero = (leer: LeerPublicado, fichero: string) =>
  Effect.gen(function* () {
    const contenido = yield* leer(fichero);
    if (Option.isNone(contenido)) {
      return yield* new CopiaIncompleta({ motivo: `falta ${fichero}` });
    }
    const esperada = huellaDelNombre(fichero);
    if (esperada !== undefined) {
      const huella = yield* Effect.orDie(sha256(contenido.value));
      if (!huella.startsWith(esperada)) {
        return yield* new CopiaIncompleta({ motivo: `${fichero} no coincide con su huella` });
      }
    }
    return contenido.value;
  });

/** Lo que ha copiado `copiarVigente`. */
export interface CopiaHecha {
  readonly version: string;
  /** Ficheros copiados, contando `vigente.json`. */
  readonly ficheros: number;
  /** Suma de sus tamaños sin comprimir. */
  readonly bytes: number;
}

/**
 * Copia al almacén del contexto la versión vigente de lo publicado, y nada más: `vigente.json`, su
 * resumen, su manifiesto y las capas de provincia y los lotes que lista el manifiesto.
 *
 * 1. Lee `vigente.json` una vez. Todo lo demás es de esa versión, aunque mientras tanto se publique
 *    otra.
 * 2. Lee el resumen y el manifiesto y comprueba que el resumen es de esa versión y que la capa de
 *    cada provincia está en el manifiesto.
 * 3. Lee y guarda cada fichero del manifiesto. Si falta alguno o su contenido no coincide con la
 *    huella de su nombre, falla sin escribir `vigente.json`.
 * 4. Guarda el manifiesto y el resumen y, al final, `vigente.json`.
 *
 * Así la copia nunca anuncia algo que no tiene. Una versión del formato 4 no se copia: la web ya
 * no la lee.
 */
export const copiarVigente = Effect.fn("Reserva.copiarVigente")(function* (leer: LeerPublicado) {
  const destino = yield* AlmacenDeFicheros;
  const contenidoVigente = yield* leer(FICHERO_VIGENTE);
  if (Option.isNone(contenidoVigente)) {
    return yield* new CopiaIncompleta({ motivo: "no hay vigente.json" });
  }
  const vigente = decodificarVigente(contenidoVigente.value);
  if (Result.isFailure(vigente)) {
    return yield* new CopiaIncompleta({
      motivo: `vigente.json no se entiende: ${vigente.failure.message}`,
    });
  }
  const { version, resumen: ficheroResumen } = vigente.success;
  if (ficheroResumen === undefined) {
    return yield* new CopiaIncompleta({ motivo: `${version} no es del formato 5` });
  }

  const resumen = yield* leerEntero(leer, ficheroResumen);
  const leido = leerResumen(resumen, version);
  if (Result.isFailure(leido)) {
    return yield* new CopiaIncompleta({
      motivo: `${ficheroResumen} no se entiende: ${leido.failure.message}`,
    });
  }
  const ficheroManifiesto = ficheroDeManifiesto(version);
  const manifiesto = yield* leerEntero(leer, ficheroManifiesto);
  const listados = decodificarManifiesto(manifiesto);
  if (Result.isFailure(listados) || listados.success.version !== version) {
    return yield* new CopiaIncompleta({ motivo: `${ficheroManifiesto} no es de ${version}` });
  }
  const ficheros = listados.success.ficheros;
  const enManifiesto = new Set(ficheros);
  const sinListar = leido.success.provincias.flatMap((p) =>
    p.fichero === undefined || enManifiesto.has(p.fichero) ? [] : [p.fichero],
  );
  if (sinListar.length > 0) {
    return yield* new CopiaIncompleta({
      motivo: `el manifiesto no lista ${sinListar.join(", ")}`,
    });
  }

  const bytes = yield* Effect.forEach(
    ficheros,
    (fichero) =>
      Effect.gen(function* () {
        const contenido = yield* leerEntero(leer, fichero);
        yield* destino.guardar(fichero, contenido);
        return bytesDe(contenido);
      }),
    { concurrency: A_LA_VEZ },
  );
  yield* destino.guardar(ficheroManifiesto, manifiesto);
  yield* destino.guardar(ficheroResumen, resumen);
  yield* destino.cambiarVigente(contenidoVigente.value);

  const hecha: CopiaHecha = {
    version,
    ficheros: ficheros.length + 3,
    bytes: [manifiesto, resumen, contenidoVigente.value].reduce(
      (suma, texto) => suma + bytesDe(texto),
      bytes.reduce((suma, n) => suma + n, 0),
    ),
  };
  return hecha;
});

/** Reintentos de una lectura por HTTP que falla por algo pasajero. */
const REINTENTOS = 3;

/**
 * Lee lo publicado desde su origen público, el mismo del que lee la web: el Worker de R2. Un 404
 * es un fichero que no existe; un fallo de red o una respuesta que no es un 200 se reintentan tres
 * veces antes de fallar.
 */
export const leerPorHttp = (origen: string) =>
  Effect.map(HttpClient.HttpClient, (http): LeerPublicado => {
    const base = origen.replace(/\/$/u, "");
    return (fichero) =>
      Effect.gen(function* () {
        const respuesta = yield* http.get(`${base}/${fichero}`);
        if (respuesta.status === 404) return Option.none<string>();
        if (respuesta.status !== 200) {
          return yield* new AlmacenNoDisponible({
            motivo: `GET ${fichero}: ${respuesta.status}`,
          });
        }
        return Option.some(yield* respuesta.text);
      }).pipe(
        Effect.catchTag("HttpClientError", (error) =>
          Effect.fail(new AlmacenNoDisponible({ motivo: `GET ${fichero}: ${error.message}` })),
        ),
        Effect.retry({ schedule: Schedule.exponential("1 second"), times: REINTENTOS }),
      );
  });

// ── El aviso, en la ingesta ──────────────────────────────────────────────────────────────────────

/** La copia de reserva no ha contestado, o Vercel no ha aceptado el despliegue. */
export class ReservaNoDisponible extends Schema.TaggedError<ReservaNoDisponible>()(
  "ReservaNoDisponible",
  { motivo: Schema.String },
) {}

/** La copia de reserva, vista desde la ingesta. */
export class CopiaDeReserva extends Context.Service<
  CopiaDeReserva,
  {
    /**
     * El `vigente.json` que sirve la copia; `None` si no tiene, o si no se sabe dónde está la
     * copia. Entonces siempre se despliega.
     */
    readonly vigente: Effect.Effect<Option.Option<string>, ReservaNoDisponible>;
    /** Pide un despliegue nuevo, que vuelve a copiar la versión vigente de R2. */
    readonly desplegar: Effect.Effect<void, ReservaNoDisponible>;
  }
>()("@celda/publicacion/reserva/CopiaDeReserva") {}

/** Lo que ha pasado con la copia de reserva tras publicar. Nunca es un fallo de la noche. */
export const ResultadoReserva = Schema.Union([
  /** No hay deploy hook configurado. */
  Schema.Struct({ tipo: Schema.Literal("sin-reserva") }),
  /** El almacén no tiene `vigente.json`: no hay nada que copiar. */
  Schema.Struct({ tipo: Schema.Literal("sin-publicar") }),
  /** La copia ya sirve la versión vigente con su resumen. */
  Schema.Struct({ tipo: Schema.Literal("al-dia"), version: Schema.String }),
  /** Se ha pedido el despliegue de la copia. Vercel la construye después, por su cuenta. */
  Schema.Struct({ tipo: Schema.Literal("desplegada"), version: Schema.String }),
  Schema.Struct({ tipo: Schema.Literal("fallida"), motivo: Schema.String }),
]);
export type ResultadoReserva = typeof ResultadoReserva.Type;

/** Si dos `vigente.json` dicen lo mismo: la misma versión con el mismo resumen. */
const igual = (a: Vigente, b: string): boolean => {
  const otro = decodificarVigente(b);
  return (
    Result.isSuccess(otro) &&
    otro.success.version === a.version &&
    otro.success.resumen === a.resumen
  );
};

/**
 * Tras publicar, comprueba que la copia de reserva sirve lo que dice el `vigente.json` del
 * almacén y, si no, pide un despliegue. Si la copia no contesta, también. Repetirla con la copia
 * al día no hace nada, y una que falló una noche se repite la siguiente.
 */
export const actualizarReserva = Effect.gen(function* () {
  const almacen = yield* AlmacenDeFicheros;
  const reserva = yield* CopiaDeReserva;
  const publicado = yield* almacen.leer(FICHERO_VIGENTE);
  if (Option.isNone(publicado)) {
    const nada: ResultadoReserva = { tipo: "sin-publicar" };
    return nada;
  }
  const vigente = decodificarVigente(publicado.value);
  if (Result.isFailure(vigente)) {
    const fallida: ResultadoReserva = {
      tipo: "fallida",
      motivo: `vigente.json no se entiende: ${vigente.failure.message}`,
    };
    return fallida;
  }
  const version = vigente.success.version;
  const suyo = yield* reserva.vigente.pipe(
    Effect.catchTag("ReservaNoDisponible", (error) =>
      Effect.as(
        Effect.logWarning(`La copia de reserva no contesta: ${error.motivo}`),
        Option.none<string>(),
      ),
    ),
  );
  if (Option.isSome(suyo) && igual(vigente.success, suyo.value)) {
    const alDia: ResultadoReserva = { tipo: "al-dia", version };
    return alDia;
  }
  yield* reserva.desplegar;
  const desplegada: ResultadoReserva = { tipo: "desplegada", version };
  return desplegada;
}).pipe(
  Effect.catchTags({
    AlmacenNoDisponible: (error) =>
      Effect.succeed<ResultadoReserva>({
        tipo: "fallida",
        motivo: `el almacén no responde: ${error.motivo}`,
      }),
    ReservaNoDisponible: (error) =>
      Effect.succeed<ResultadoReserva>({ tipo: "fallida", motivo: error.motivo }),
  }),
  Effect.withSpan("Reserva.actualizar"),
);

export interface OpcionesVercel {
  /** El deploy hook del proyecto de Vercel: quien lo tiene puede lanzar despliegues. */
  readonly hook: Redacted.Redacted<string>;
  /**
   * La URL pública de la copia, `https://celda.elies.site/capas`. Sin ella no se puede comprobar
   * qué sirve, y cada publicación pide un despliegue.
   */
  readonly origen: Option.Option<string>;
}

/** Lo que se espera a Vercel antes de darlo por caído. */
const ESPERA = Duration.seconds(30);

/** La copia de reserva en Vercel: se lee por su URL pública y se despliega con el deploy hook. */
export const copiaEnVercel = (opciones: OpcionesVercel) =>
  Layer.effect(
    CopiaDeReserva,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const noDisponible = (motivo: string) => new ReservaNoDisponible({ motivo });

      const vigente = Option.match(opciones.origen, {
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: (origen) =>
          Effect.gen(function* () {
            const url = `${origen.replace(/\/$/u, "")}/${FICHERO_VIGENTE}`;
            // Sin caché: tiene que ser lo que sirve la copia ahora.
            const respuesta = yield* http.execute(
              HttpClientRequest.get(url).pipe(
                HttpClientRequest.setHeader("cache-control", "no-cache"),
              ),
            );
            if (respuesta.status === 404) return Option.none<string>();
            if (respuesta.status !== 200) {
              return yield* noDisponible(`GET ${url}: ${respuesta.status}`);
            }
            return Option.some(yield* respuesta.text);
          }),
      }).pipe(
        Effect.timeout(ESPERA),
        Effect.catchTags({
          HttpClientError: (error) => Effect.fail(noDisponible(error.message)),
          TimeoutError: () => Effect.fail(noDisponible("la copia no contesta")),
        }),
      );

      // La URL del hook es el secreto: no va en los mensajes.
      const desplegar = Effect.gen(function* () {
        const respuesta = yield* http.execute(
          HttpClientRequest.post(Redacted.value(opciones.hook)),
        );
        if (respuesta.status < 200 || respuesta.status >= 300) {
          return yield* noDisponible(`el deploy hook contesta ${respuesta.status}`);
        }
      }).pipe(
        Effect.timeout(ESPERA),
        Effect.catchTags({
          HttpClientError: (error) =>
            Effect.fail(noDisponible(`el deploy hook no contesta (${error.reason._tag})`)),
          TimeoutError: () => Effect.fail(noDisponible("el deploy hook no contesta")),
        }),
      );

      return CopiaDeReserva.of({ vigente, desplegar });
    }),
  );
