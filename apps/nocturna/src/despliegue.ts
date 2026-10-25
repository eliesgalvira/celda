import {
  comprobarDespliegue,
  esHuella,
  huellaDeLaWeb,
  type R2DelDespliegue,
  salidaDelDespliegue,
} from "@celda/publicacion/despliegue";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `despliegue` sin la huella o sin el commit, o con una huella que no lo es. */
export class UsoDelDespliegue extends Schema.TaggedError<UsoDelDespliegue>()(
  "UsoDelDespliegue",
  {},
) {
  override get message() {
    return "Uso: despliegue --huella <huella de la web> --commit <commit> [--a-mano] [--salida <fichero>]. La huella es la que escribe huella-web, 64 cifras hexadecimales.";
  }
}

/** `huella-web` sin la carpeta de la web o sin el fichero en el que escribir. */
export class UsoDeLaHuella extends Schema.TaggedError<UsoDeLaHuella>()("UsoDeLaHuella", {}) {
  override get message() {
    return "Uso: huella-web <carpeta de la web> <fichero>. La carpeta es apps/web, con la web ya construida por pnpm run build.";
  }
}

/** Los argumentos de la orden `despliegue`. */
export interface ArgumentosDelDespliegue {
  /** La huella de la web del commit (`huellaDeLaWeb`), calculada ahora o guardada de antes. */
  readonly huella: string;
  /** El commit de `main` del que sale la web. */
  readonly commit: string;
  /** Se ha pedido a mano: se despliega aunque nada cambie. */
  readonly aMano: boolean;
  /** Un fichero al que añadir el resultado para el flujo de GitHub, su `$GITHUB_OUTPUT`. */
  readonly salida: Option.Option<string>;
}

/** Lee `--huella <huella> --commit <commit> [--a-mano] [--salida <fichero>]`, en cualquier orden. */
export const argumentosDelDespliegue = (argumentos: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sueltos: Array<string> = [];
    let huella: string | undefined;
    let commit: string | undefined;
    let salida: string | undefined;
    let aMano = false;
    for (let i = 0; i < argumentos.length; i++) {
      const argumento = argumentos[i];
      if (argumento === "--a-mano") aMano = true;
      else if (argumento === "--huella") huella = argumentos[++i];
      else if (argumento === "--commit") commit = argumentos[++i];
      else if (argumento === "--salida") salida = argumentos[++i];
      else if (argumento !== undefined) sueltos.push(argumento);
    }
    if (
      sueltos.length > 0 ||
      huella === undefined ||
      !esHuella(huella) ||
      commit === undefined ||
      commit === ""
    ) {
      return yield* new UsoDelDespliegue();
    }
    const leidos: ArgumentosDelDespliegue = {
      huella,
      commit,
      aMano,
      salida: Option.fromUndefinedOr(salida),
    };
    return leidos;
  });

/**
 * La orden `despliegue` dice si hay que desplegar y por qué (`comprobarDespliegue`). Escribe en el
 * registro una frase por cada señal y la decisión, y con `--salida` añade a ese fichero
 * `desplegar`, `despliegue` y `motivo` para el flujo de GitHub. La lanza el flujo de despliegue
 * antes de llamar a Vercel, con la huella de la web ya sabida; ella no construye ni despliega nada.
 */
export const ordenDespliegue = Effect.fn("Nocturna.despliegue")(function* (
  argumentos: ArgumentosDelDespliegue,
  r2: R2DelDespliegue,
) {
  const comprobacion = yield* comprobarDespliegue({
    huella: argumentos.huella,
    commit: argumentos.commit,
    aMano: argumentos.aMano,
    r2,
  });
  yield* Console.log(comprobacion.web.detalle);
  yield* Console.log(comprobacion.datos.detalle);
  yield* Console.log(comprobacion.motivo);
  if (Option.isSome(argumentos.salida)) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(argumentos.salida.value, salidaDelDespliegue(comprobacion), {
      flag: "a",
    });
  }
  return comprobacion;
});

/**
 * La orden `huella-web <carpeta> <fichero>` escribe en `fichero` la huella de la web ya construida
 * en `carpeta` (`huellaDeLaWeb`). El flujo de despliegue la lanza una vez por commit, y guarda el
 * fichero en su caché con el commit en la clave.
 */
export const ordenHuellaWeb = Effect.fn("Nocturna.huellaWeb")(function* (
  carpeta: string,
  fichero: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const huella = yield* huellaDeLaWeb(carpeta);
  yield* fs.writeFileString(fichero, `${huella}\n`);
  yield* Console.log(`La web de ${carpeta} tiene la huella ${huella}.`);
  return huella;
});
