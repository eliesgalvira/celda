import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { enumerar } from "@celda/dominio/enumerar";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";

import type { AlmacenDeFicheros } from "./almacen.ts";
import { sha256, sha256DeBytes } from "./almacenes/firma.ts";
import { leerDeVercel, planearCapas, type VercelNoDisponible } from "./vercel.ts";

/**
 * Cuándo se despliega Celda en Vercel (ADR 0018, «Cómo quedó el despliegue»). Un despliegue lleva
 * la web y unos 100 MB de capas, así que solo se lanza si hay una señal de cambio:
 *
 * - **La web.** La huella de lo que construye `pnpm run build` en `apps/web/dist`, con
 *   `vercel.json` y `scripts/vercel.sh`, no es la que sirve producción en `/despliegue.json`.
 * - **Los datos.** Producción no sirve el `vigente.json` de R2 y los manifiestos de la vigente y de
 *   las anteriores que montaría un build nuevo (`planearCapas`).
 *
 * El baremo de exposición que calcula el build (ADR 0030) no entra en ninguna: sale de los lotes que
 * listan esos manifiestos, y la web lo pide por un nombre con su formato, que sube si cambia el
 * cálculo y cambia así la web.
 *
 * Una señal que no se puede saber cuenta como un cambio. La huella es función pura del commit, así
 * que el flujo de despliegue de GitHub la calcula una vez por commit (orden `huella-web`) y la
 * guarda en su caché, y cada ejecución compara la que ya sabe con la de producción (orden
 * `despliegue`). Lo guardado nunca dice qué está desplegado, porque eso se lee siempre de
 * producción.
 */

/** El fichero de la raíz del sitio que dice de qué web es el despliegue. Lo escribe `vercel.sh`. */
export const FICHERO_DEL_DESPLIEGUE = "despliegue.json";

/** La carpeta de `dist` en la que el build de Vercel monta las capas, que no son de la web. */
const CARPETA_DE_CAPAS = "capas";

/**
 * Lo que entra en la huella además de `dist`, que dice cómo construye y sirve Vercel el despliegue
 * (la orden de build, las cabeceras y las reescrituras). Las rutas son desde la carpeta de la web.
 */
export const CONFIGURACION_DEL_DESPLIEGUE = ["vercel.json", "scripts/vercel.sh"] as const;

/**
 * Las carpetas, desde la de la web, con el código de la API (ADR 0032), que Vercel compila aparte
 * y no deja nada en `dist`. Sin ellas, un cambio solo en la API no se desplegaría. Las pruebas y
 * sus ayudas (`*.test.ts`, `pruebas.ts`) no cuentan. El dominio que importa la API no entra: son
 * los mismos lectores de capas que usa la web, y un cambio en ellos cambia lo construido.
 */
export const CODIGO_DE_LA_API = ["api", "src/api"] as const;

const esDeLaApi = (ruta: string): boolean =>
  !ruta.endsWith(".test.ts") && !ruta.endsWith("pruebas.ts");

/** En la carpeta de la web no hay nada construido. */
export class WebSinConstruir extends Schema.TaggedError<WebSinConstruir>()("WebSinConstruir", {
  carpeta: Schema.String,
}) {
  override get message() {
    return `${this.carpeta} no existe. Construye antes la web con pnpm run build.`;
  }
}

/**
 * La huella de la web de `carpeta` (`apps/web`) es el SHA-256, en hexadecimal, de la lista de cada
 * fichero de `dist` con el SHA-256 de su contenido, y lo mismo de `CONFIGURACION_DEL_DESPLIEGUE` y
 * del código de la API (`CODIGO_DE_LA_API`). No cuentan las capas montadas en `dist/capas` ni
 * `dist/despliegue.json`, ni nada más de fuera de `dist`, así que el resto del código, las pruebas
 * o la documentación solo cambian la huella si cambian lo construido.
 */
export const huellaDeLaWeb = Effect.fn("Despliegue.huellaDeLaWeb")(function* (carpeta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dist = path.join(carpeta, "dist");
  if (!(yield* fs.exists(dist))) return yield* new WebSinConstruir({ carpeta: dist });
  const entradas = yield* fs.readDirectory(dist, { recursive: true });
  const deLaWeb = entradas
    .map((entrada) => entrada.split(path.sep).join("/"))
    .filter(
      (ruta) =>
        ruta !== FICHERO_DEL_DESPLIEGUE &&
        ruta !== CARPETA_DE_CAPAS &&
        !ruta.startsWith(`${CARPETA_DE_CAPAS}/`),
    );
  const ficheros = yield* Effect.filter(deLaWeb, (ruta) =>
    Effect.map(fs.stat(path.join(dist, ruta)), (info) => info.type === "File"),
  );
  const deLaApi = yield* Effect.forEach(CODIGO_DE_LA_API, (carpetaDeLaApi) =>
    Effect.gen(function* () {
      const raiz = path.join(carpeta, carpetaDeLaApi);
      if (!(yield* fs.exists(raiz))) return [];
      const rutas = (yield* fs.readDirectory(raiz, { recursive: true }))
        .map((entrada) => `${carpetaDeLaApi}/${entrada.split(path.sep).join("/")}`)
        .filter(esDeLaApi);
      return yield* Effect.filter(rutas, (ruta) =>
        Effect.map(fs.stat(path.join(carpeta, ruta)), (info) => info.type === "File"),
      );
    }),
  );
  const lineas = yield* Effect.forEach(
    [
      ...ficheros.map((ruta) => ({ nombre: `dist/${ruta}`, fichero: path.join(dist, ruta) })),
      ...deLaApi.flat().map((ruta) => ({ nombre: ruta, fichero: path.join(carpeta, ruta) })),
      ...CONFIGURACION_DEL_DESPLIEGUE.map((ruta) => ({
        nombre: ruta,
        fichero: path.join(carpeta, ruta),
      })),
    ],
    ({ nombre, fichero }) =>
      Effect.map(
        Effect.flatMap(fs.readFile(fichero), (bytes) =>
          Effect.orDie(sha256DeBytes(new Uint8Array(bytes))),
        ),
        (huella) => `${nombre}\t${huella}`,
      ),
    { concurrency: 8 },
  );
  return yield* Effect.orDie(sha256(lineas.toSorted().join("\n")));
});

/** Una huella de la web, como la da `huellaDeLaWeb`: 64 cifras hexadecimales. */
const FORMA_DE_HUELLA = /^[0-9a-f]{64}$/u;

/** Si `texto` tiene la forma de una huella de la web. */
export const esHuella = (texto: string): boolean => FORMA_DE_HUELLA.test(texto);

/** Lo que dice `/despliegue.json`, la huella de la web y el commit de `main` del que salió. */
export const Despliegue = Schema.Struct({
  web: Schema.String.pipe(Schema.check(Schema.isPattern(FORMA_DE_HUELLA))),
  commit: Schema.String,
});
export type Despliegue = typeof Despliegue.Type;

const DespliegueEnJson = Schema.fromJsonString(Despliegue);
const decodificarDespliegue = Schema.decodeUnknownResult(DespliegueEnJson);

/** El contenido de `/despliegue.json`. */
export const codificarDespliegue = Schema.encodeSync(DespliegueEnJson);

/** Lo que sirve producción, leído por su URL pública. */
export class Produccion extends Context.Service<
  Produccion,
  {
    /** Un fichero por su ruta desde la raíz del sitio, `capas/vigente.json`; `None` si da 404. */
    readonly leer: (ruta: string) => Effect.Effect<Option.Option<string>, VercelNoDisponible>;
  }
>()("@celda/publicacion/despliegue/Produccion") {}

/** Producción en `sitio`, `https://celda.elies.site`, leída sin caché. */
export const produccionEn = (sitio: string) =>
  Layer.effect(
    Produccion,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const raiz = sitio.replace(/\/$/u, "");
      return Produccion.of({ leer: (ruta) => leerDeVercel(http, `${raiz}/${ruta}`) });
    }),
  );

/** Una de las dos señales, con lo que se ha visto y por qué en una frase para el registro. */
export interface Senal {
  readonly tipo: "igual" | "cambia" | "no-se-sabe";
  readonly detalle: string;
}

const senal = (tipo: Senal["tipo"], detalle: string): Senal => ({ tipo, detalle });

const corta = (huella: string): string => huella.slice(0, 12);

/** La señal de la web dice si la huella de la web de este commit es la que sirve producción. */
export const senalDeLaWeb = (huella: string) =>
  Effect.gen(function* () {
    const produccion = yield* Produccion;
    const servido = yield* produccion.leer(FICHERO_DEL_DESPLIEGUE);
    if (Option.isNone(servido)) {
      return senal(
        "no-se-sabe",
        `Producción no tiene /${FICHERO_DEL_DESPLIEGUE}, así que no se sabe qué web sirve.`,
      );
    }
    const despliegue = decodificarDespliegue(servido.value);
    if (Result.isFailure(despliegue)) {
      return senal(
        "no-se-sabe",
        `El /${FICHERO_DEL_DESPLIEGUE} de producción no se entiende, así que no se sabe qué web sirve.`,
      );
    }
    const { web, commit } = despliegue.success;
    if (web === huella) {
      return senal(
        "igual",
        `La web de este commit es la que sirve producción, desplegada desde ${commit.slice(0, 7)} (huella ${corta(huella)}).`,
      );
    }
    return senal(
      "cambia",
      `La web ha cambiado. Producción sirve la de ${commit.slice(0, 7)}, con la huella ${corta(web)}, y la de este commit da ${corta(huella)}.`,
    );
  }).pipe(
    Effect.catchTag("VercelNoDisponible", (error) =>
      Effect.succeed(senal("no-se-sabe", `Producción no contesta (${error.motivo}).`)),
    ),
  );

/**
 * De dónde lee R2 la señal de los datos. Es el cubo, con la clave de solo lectura del build de
 * Vercel, o nada si al flujo le faltan las variables de esa clave.
 */
export type R2DelDespliegue =
  | { readonly tipo: "cubo"; readonly origen: AlmacenDeFicheros["Service"] }
  | { readonly tipo: "sin-clave"; readonly faltan: ReadonlyArray<string> };

/** Lo que dice un `vigente.json` de sí mismo, para explicar en qué se diferencian dos. */
const versionDe = (contenido: string): { version: string; resumen: string } => {
  const vigente = decodificarVigente(contenido);
  return Result.isSuccess(vigente)
    ? { version: vigente.success.version, resumen: vigente.success.resumen ?? "" }
    : { version: "una versión que no se entiende", resumen: "" };
};

/**
 * La señal de los datos dice si producción sirve lo que montaría un build nuevo desde R2. Compara byte
 * a byte el `vigente.json` y cada manifiesto que montaría el build (`planearCapas`) con los que
 * sirve producción en `/capas`. Los manifiestos no cambian nunca y listan ficheros nombrados por su
 * contenido, así que si coinciden, producción tiene las mismas capas. También salta si el build
 * pasa a montar otra versión anterior.
 */
export const senalDeLosDatos = (r2: R2DelDespliegue) =>
  Effect.gen(function* () {
    if (r2.tipo === "sin-clave") {
      return senal(
        "no-se-sabe",
        `Sin la clave de R2 de solo lectura no se sabe qué versión tiene R2. Faltan ${enumerar(r2.faltan)}.`,
      );
    }
    const plan = yield* planearCapas(r2.origen);
    const produccion = yield* Produccion;
    const servido = yield* produccion.leer(`${CARPETA_DE_CAPAS}/${FICHERO_VIGENTE}`);
    if (Option.isNone(servido)) {
      return senal(
        "cambia",
        `R2 tiene ${plan.version} y producción no sirve /${CARPETA_DE_CAPAS}/${FICHERO_VIGENTE}.`,
      );
    }
    if (servido.value !== plan.vigente) {
      const enR2 = versionDe(plan.vigente);
      const enProduccion = versionDe(servido.value);
      return senal(
        "cambia",
        enR2.version !== enProduccion.version
          ? `R2 tiene ${enR2.version} y producción sirve ${enProduccion.version}.`
          : enR2.resumen !== enProduccion.resumen
            ? `R2 tiene ${enR2.version} con otro resumen nacional, ${enR2.resumen}, y producción sirve ${enProduccion.resumen}.`
            : `El ${FICHERO_VIGENTE} de R2 no es igual que el de producción, aunque los dos dicen ${enR2.version} con el mismo resumen.`,
      );
    }
    for (const manifiesto of plan.manifiestos) {
      const suyo = yield* produccion.leer(`${CARPETA_DE_CAPAS}/${manifiesto.fichero}`);
      if (Option.isNone(suyo)) {
        return senal(
          "cambia",
          `Producción no sirve ${manifiesto.fichero}, que el build montaría desde R2.`,
        );
      }
      if (suyo.value !== manifiesto.contenido) {
        return senal("cambia", `Producción sirve un ${manifiesto.fichero} distinto del de R2.`);
      }
    }
    const anteriores = plan.manifiestos.slice(1).map((m) => `sitios@${m.sello}`);
    return senal(
      "igual",
      anteriores.length === 0
        ? `Producción sirve ${plan.version}, la versión vigente de R2.`
        : `Producción sirve ${plan.version}, la versión vigente de R2, y las anteriores que montaría el build, ${enumerar(anteriores)}.`,
    );
  }).pipe(
    Effect.catchTags({
      AlmacenNoDisponible: (error) =>
        Effect.succeed(senal("no-se-sabe", `R2 no responde (${error.motivo}).`)),
      CapasIncompletas: (error) =>
        Effect.succeed(
          senal("no-se-sabe", `R2 no tiene entero lo que montaría el build (${error.motivo}).`),
        ),
      VercelNoDisponible: (error) =>
        Effect.succeed(senal("no-se-sabe", `Producción no contesta (${error.motivo}).`)),
    }),
  );

/** Si se despliega, y por qué, en una frase. */
export interface Decision {
  readonly desplegar: boolean;
  readonly motivo: string;
}

/**
 * Se despliega si se ha pedido a mano, o si alguna de las dos señales ha cambiado o no se puede
 * saber. Si las dos dicen que producción ya lo sirve todo, no se despliega.
 */
export const decidir = (entrada: {
  readonly aMano: boolean;
  readonly web: Senal;
  readonly datos: Senal;
}): Decision => {
  if (entrada.aMano) {
    return { desplegar: true, motivo: "Se despliega porque se ha pedido a mano." };
  }
  const porque: Array<string> = [];
  if (entrada.web.tipo === "cambia") porque.push("ha cambiado la web");
  if (entrada.web.tipo === "no-se-sabe") porque.push("no se sabe qué web sirve producción");
  if (entrada.datos.tipo === "cambia") porque.push("han cambiado los datos");
  if (entrada.datos.tipo === "no-se-sabe") porque.push("no se sabe si han cambiado los datos");
  if (porque.length === 0) {
    return {
      desplegar: false,
      motivo: "No se despliega porque producción ya sirve esta web y estos datos.",
    };
  }
  return { desplegar: true, motivo: `Se despliega porque ${enumerar(porque)}.` };
};

/** Lo que ha visto `comprobarDespliegue`. */
export interface ComprobacionDelDespliegue extends Decision {
  readonly web: Senal;
  readonly datos: Senal;
  /** Lo que tiene que servir el despliegue en `/despliegue.json` si se lanza. */
  readonly despliegue: Despliegue;
}

/**
 * Mira las dos señales del despliegue del commit `commit`, cuya web tiene la huella `huella`
 * (`huellaDeLaWeb`), y decide si se despliega. No construye nada.
 */
export const comprobarDespliegue = Effect.fn("Despliegue.comprobar")(function* (opciones: {
  readonly huella: string;
  readonly commit: string;
  readonly aMano: boolean;
  readonly r2: R2DelDespliegue;
}) {
  const [web, datos] = yield* Effect.all(
    [senalDeLaWeb(opciones.huella), senalDeLosDatos(opciones.r2)],
    { concurrency: 2 },
  );
  const comprobacion: ComprobacionDelDespliegue = {
    ...decidir({ aMano: opciones.aMano, web, datos }),
    web,
    datos,
    despliegue: { web: opciones.huella, commit: opciones.commit },
  };
  return comprobacion;
});

/**
 * Lo que la orden deja para el flujo de despliegue, una `clave=valor` por línea, en el formato de
 * `$GITHUB_OUTPUT`. Son `desplegar` (`si` o `no`), `despliegue`, con el JSON de `/despliegue.json`,
 * y `motivo`.
 */
export const salidaDelDespliegue = (comprobacion: ComprobacionDelDespliegue): string =>
  [
    `desplegar=${comprobacion.desplegar ? "si" : "no"}`,
    `despliegue=${codificarDespliegue(comprobacion.despliegue)}`,
    `motivo=${comprobacion.motivo}`,
    "",
  ].join("\n");
