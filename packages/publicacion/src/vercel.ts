import { decodificarVigente, FICHERO_VIGENTE, type Vigente } from "@celda/dominio/capa";
import {
  decodificarManifiesto,
  ficheroDeManifiesto,
  LARGO_HUELLA,
  leerResumen,
  selloDeVersion,
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

import { AlmacenDeFicheros } from "./almacen.ts";
import { sha256 } from "./almacenes/firma.ts";
import { PREFIJOS_PRIVADOS } from "./almacenes/r2.ts";

/**
 * Las capas, solo desde Vercel (ADR 0018). La web lee las capas y las fichas de `/capas`, en su
 * mismo origen. El build de Vercel las monta en `dist/capas` desde el cubo privado de R2
 * (`montarCapas`), y la ingesta nocturna lanza ese build cuando Vercel aún no sirve la versión
 * vigente de R2 (`ponerAlDiaVercel`).
 */

// ── Las capas, en el build ───────────────────────────────────────────────────────────────────────

/** Las capas no se han podido montar enteras: el build no escribe `vigente.json`. */
export class CapasIncompletas extends Schema.TaggedError<CapasIncompletas>()("CapasIncompletas", {
  motivo: Schema.String,
}) {}

/**
 * Versiones anteriores a la vigente que monta el build. Una pestaña abierta con el `vigente.json`
 * de cualquiera de ellas sigue leyendo sus provincias y sus lotes sin 404. Una que lleva abierta
 * más publicaciones lee la vigente y lo dice (ADR 0004).
 */
export const ANTERIORES_EN_VERCEL = 2;

/** Ficheros que se leen y se escriben a la vez. */
const A_LA_VEZ = 8;

/** Reintentos de una lectura del almacén que falla por algo pasajero. */
const REINTENTOS = 3;

const bytesDe = (texto: string): number => new TextEncoder().encode(texto).length;

/**
 * La huella del nombre de un fichero nombrado por su contenido: `provincias/08/<huella>.json`,
 * `fichas/08/<huella>.json`, `claves/<huella>.json` o `resumen@<fecha>.<huella>.json`.
 */
const huellaDelNombre = (fichero: string): string | undefined =>
  new RegExp(`[/.]([0-9a-f]{${LARGO_HUELLA}})\\.json$`, "u").exec(fichero)?.[1];

/** El sello de un manifiesto, `2026-09-26T02:15:03Z` en `ficheros@2026-09-26T02:15:03Z.json`. */
const selloDelManifiesto = (fichero: string): string | undefined =>
  /^ficheros@(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\.json$/u.exec(fichero)?.[1];

type Origen = AlmacenDeFicheros["Service"];

/** Si un fichero del cubo es de un prefijo que nunca se publica, como `copias/` o `archivo/`. */
export const esPrivado = (fichero: string): boolean =>
  PREFIJOS_PRIVADOS.some((prefijo) => fichero.replace(/^\/+/u, "").startsWith(prefijo));

/**
 * Lee un fichero que tiene que estar, y comprueba su huella si la lleva en el nombre. Un fallo del
 * almacén se reintenta antes de dar el build por fallido.
 */
const leerEntero = (origen: Origen, fichero: string) =>
  Effect.gen(function* () {
    const contenido = yield* origen
      .leer(fichero)
      .pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: REINTENTOS }));
    if (Option.isNone(contenido)) {
      return yield* new CapasIncompletas({ motivo: `falta ${fichero}` });
    }
    const esperada = huellaDelNombre(fichero);
    if (esperada !== undefined) {
      const huella = yield* Effect.orDie(sha256(contenido.value));
      if (!huella.startsWith(esperada)) {
        return yield* new CapasIncompletas({ motivo: `${fichero} no coincide con su huella` });
      }
    }
    return contenido.value;
  });

/** Lee el manifiesto de una versión y comprueba que es suyo. */
const leerManifiesto = (origen: Origen, sello: string) =>
  Effect.gen(function* () {
    const fichero = ficheroDeManifiesto(sello);
    const contenido = yield* leerEntero(origen, fichero);
    const listados = decodificarManifiesto(contenido);
    if (Result.isFailure(listados) || selloDeVersion(listados.success.version) !== sello) {
      return yield* new CapasIncompletas({ motivo: `${fichero} no es de ${sello}` });
    }
    return { fichero, contenido, ficheros: listados.success.ficheros };
  });

/** Lo que ha montado `montarCapas`. */
export interface CapasMontadas {
  readonly version: string;
  /** Las versiones anteriores montadas, de la más reciente a la más vieja. */
  readonly anteriores: ReadonlyArray<string>;
  /** Ficheros copiados, contando los manifiestos, el resumen y `vigente.json`. */
  readonly ficheros: number;
  /** Suma de sus tamaños sin comprimir. */
  readonly bytes: number;
}

/**
 * Copia de `origen`, el cubo de R2, al almacén del contexto, la carpeta `dist/capas` del build, la
 * versión vigente y las `ANTERIORES_EN_VERCEL` anteriores:
 *
 * 1. Lee `vigente.json` una vez. Todo lo demás es de esa versión, aunque mientras tanto se publique
 *    otra.
 * 2. Lee el resumen y el manifiesto de la vigente, y comprueba que el resumen es de esa versión y
 *    que la capa de cada provincia está en el manifiesto.
 * 3. Lista el origen y lee los manifiestos de las versiones anteriores a la vigente, las más
 *    recientes. Una posterior a la vigente es otra publicación a medias y no se toca.
 * 4. Lee y guarda cada fichero de esos manifiestos, una vez aunque lo compartan varias versiones.
 *    Si falta alguno o su contenido no coincide con la huella de su nombre, falla sin escribir
 *    `vigente.json`.
 * 5. Guarda los manifiestos y el resumen y, al final, `vigente.json`.
 *
 * Así lo montado nunca anuncia algo que no tiene. Una versión del formato 4 no se monta: la web ya
 * no la lee.
 */
export const montarCapas = Effect.fn("Vercel.montarCapas")(function* (origen: Origen) {
  const destino = yield* AlmacenDeFicheros;
  const contenidoVigente = yield* origen
    .leer(FICHERO_VIGENTE)
    .pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: REINTENTOS }));
  if (Option.isNone(contenidoVigente)) {
    return yield* new CapasIncompletas({ motivo: "no hay vigente.json" });
  }
  const vigente = decodificarVigente(contenidoVigente.value);
  if (Result.isFailure(vigente)) {
    return yield* new CapasIncompletas({
      motivo: `vigente.json no se entiende: ${vigente.failure.message}`,
    });
  }
  const { version, resumen: ficheroResumen } = vigente.success;
  if (ficheroResumen === undefined) {
    return yield* new CapasIncompletas({ motivo: `${version} no es del formato 5` });
  }

  const resumen = yield* leerEntero(origen, ficheroResumen);
  const leido = leerResumen(resumen, version);
  if (Result.isFailure(leido)) {
    return yield* new CapasIncompletas({
      motivo: `${ficheroResumen} no se entiende: ${leido.failure.message}`,
    });
  }
  const sello = selloDeVersion(version);
  const suyo = yield* leerManifiesto(origen, sello);
  const enManifiesto = new Set(suyo.ficheros);
  const sinListar = leido.success.provincias.flatMap((p) =>
    p.fichero === undefined || enManifiesto.has(p.fichero) ? [] : [p.fichero],
  );
  if (sinListar.length > 0) {
    return yield* new CapasIncompletas({
      motivo: `el manifiesto no lista ${sinListar.join(", ")}`,
    });
  }

  const anteriores = (yield* origen.listar)
    .flatMap((fichero) => selloDelManifiesto(fichero) ?? [])
    .filter((otro) => otro < sello)
    .toSorted()
    .toReversed()
    .slice(0, ANTERIORES_EN_VERCEL);
  const manifiestos = [
    suyo,
    ...(yield* Effect.forEach(anteriores, (otro) => leerManifiesto(origen, otro), {
      concurrency: A_LA_VEZ,
    })),
  ];
  const ficheros = [...new Set(manifiestos.flatMap((m) => m.ficheros))];
  // Lo privado del cubo, las copias de la base y el archivo de páginas, nunca llega a la web,
  // aunque un manifiesto lo liste por un error (ADR 0027).
  const privados = ficheros.filter((fichero) => esPrivado(fichero));
  if (privados.length > 0) {
    return yield* new CapasIncompletas({
      motivo: `un manifiesto lista ficheros privados: ${privados.join(", ")}`,
    });
  }

  const bytes = yield* Effect.forEach(
    ficheros,
    (fichero) =>
      Effect.gen(function* () {
        const contenido = yield* leerEntero(origen, fichero);
        yield* destino.guardar(fichero, contenido);
        return bytesDe(contenido);
      }),
    { concurrency: A_LA_VEZ },
  );
  for (const manifiesto of manifiestos) {
    yield* destino.guardar(manifiesto.fichero, manifiesto.contenido);
  }
  yield* destino.guardar(ficheroResumen, resumen);
  yield* destino.cambiarVigente(contenidoVigente.value);

  const montadas: CapasMontadas = {
    version,
    anteriores: anteriores.map((otro) => `sitios@${otro}`),
    ficheros: ficheros.length + manifiestos.length + 2,
    bytes: [...manifiestos.map((m) => m.contenido), resumen, contenidoVigente.value].reduce(
      (suma, texto) => suma + bytesDe(texto),
      bytes.reduce((suma, n) => suma + n, 0),
    ),
  };
  return montadas;
});

// ── El build, desde la ingesta ───────────────────────────────────────────────────────────────────

/** Vercel no ha contestado, o no ha aceptado el build. */
export class VercelNoDisponible extends Schema.TaggedError<VercelNoDisponible>()(
  "VercelNoDisponible",
  { motivo: Schema.String },
) {}

/** La web en Vercel, vista desde la ingesta. */
export class SitioEnVercel extends Context.Service<
  SitioEnVercel,
  {
    /**
     * El `vigente.json` que sirve Vercel en `/capas`; `None` si no tiene, o si no se sabe su URL.
     * Entonces siempre se lanza el build.
     */
    readonly vigente: Effect.Effect<Option.Option<string>, VercelNoDisponible>;
    /** Lanza un build, que vuelve a montar las capas desde R2. */
    readonly desplegar: Effect.Effect<void, VercelNoDisponible>;
  }
>()("@celda/publicacion/vercel/SitioEnVercel") {}

/** Lo que ha pasado con Vercel tras publicar. Nunca es un fallo de la noche. */
export const ResultadoVercel = Schema.Union([
  /** No hay deploy hook configurado. */
  Schema.Struct({ tipo: Schema.Literal("sin-hook") }),
  /** El almacén no tiene `vigente.json`: no hay nada que montar. */
  Schema.Struct({ tipo: Schema.Literal("sin-publicar") }),
  /** Vercel ya sirve la versión vigente con su resumen. */
  Schema.Struct({ tipo: Schema.Literal("al-dia"), version: Schema.String }),
  /** Se ha lanzado el build. Vercel lo construye después, por su cuenta. */
  Schema.Struct({ tipo: Schema.Literal("desplegada"), version: Schema.String }),
  Schema.Struct({ tipo: Schema.Literal("fallida"), motivo: Schema.String }),
]);
export type ResultadoVercel = typeof ResultadoVercel.Type;

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
 * Tras publicar, comprueba que Vercel sirve lo que dice el `vigente.json` del almacén, leído por
 * la API S3, y si no, lanza el build. Si Vercel no contesta, también. Repetirla con Vercel al día
 * no hace nada, y una que falló una noche se repite la siguiente.
 */
export const ponerAlDiaVercel = Effect.gen(function* () {
  const almacen = yield* AlmacenDeFicheros;
  const sitio = yield* SitioEnVercel;
  const publicado = yield* almacen.leer(FICHERO_VIGENTE);
  if (Option.isNone(publicado)) {
    const nada: ResultadoVercel = { tipo: "sin-publicar" };
    return nada;
  }
  const vigente = decodificarVigente(publicado.value);
  if (Result.isFailure(vigente)) {
    const fallida: ResultadoVercel = {
      tipo: "fallida",
      motivo: `vigente.json no se entiende: ${vigente.failure.message}`,
    };
    return fallida;
  }
  const version = vigente.success.version;
  const servido = yield* sitio.vigente.pipe(
    Effect.catchTag("VercelNoDisponible", (error) =>
      Effect.as(Effect.logWarning(`Vercel no contesta: ${error.motivo}`), Option.none<string>()),
    ),
  );
  if (Option.isSome(servido) && igual(vigente.success, servido.value)) {
    const alDia: ResultadoVercel = { tipo: "al-dia", version };
    return alDia;
  }
  yield* sitio.desplegar;
  const desplegada: ResultadoVercel = { tipo: "desplegada", version };
  return desplegada;
}).pipe(
  Effect.catchTags({
    AlmacenNoDisponible: (error) =>
      Effect.succeed<ResultadoVercel>({
        tipo: "fallida",
        motivo: `el almacén no responde: ${error.motivo}`,
      }),
    VercelNoDisponible: (error) =>
      Effect.succeed<ResultadoVercel>({ tipo: "fallida", motivo: error.motivo }),
  }),
  Effect.withSpan("Vercel.ponerAlDia"),
);

export interface OpcionesVercel {
  /** El deploy hook del proyecto de Vercel: quien lo tiene puede lanzar builds. */
  readonly hook: Redacted.Redacted<string>;
  /**
   * La URL pública de las capas, `https://celda.elies.site/capas`. Sin ella no se puede comprobar
   * qué sirve Vercel, y cada publicación lanza el build.
   */
  readonly origen: Option.Option<string>;
}

/** Lo que se espera a Vercel antes de darlo por caído. */
const ESPERA = Duration.seconds(30);

/** La web en Vercel: se lee por su URL pública y se despliega con el deploy hook. */
export const sitioEnVercel = (opciones: OpcionesVercel) =>
  Layer.effect(
    SitioEnVercel,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const noDisponible = (motivo: string) => new VercelNoDisponible({ motivo });

      const vigente = Option.match(opciones.origen, {
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: (origen) =>
          Effect.gen(function* () {
            const url = `${origen.replace(/\/$/u, "")}/${FICHERO_VIGENTE}`;
            // Sin caché: tiene que ser lo que sirve Vercel ahora.
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
          TimeoutError: () => Effect.fail(noDisponible("Vercel no contesta")),
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

      return SitioEnVercel.of({ vigente, desplegar });
    }),
  );
