import {
  comprobarDespliegue,
  type R2DelDespliegue,
  salidaDelDespliegue,
} from "@celda/publicacion/despliegue";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `despliegue` sin la carpeta de la web o sin el commit. */
export class UsoDelDespliegue extends Schema.TaggedError<UsoDelDespliegue>()(
  "UsoDelDespliegue",
  {},
) {
  override get message() {
    return "Uso: despliegue <carpeta de la web> --commit <commit> [--a-mano] [--salida <fichero>]. La carpeta es apps/web, con la web ya construida por pnpm run build.";
  }
}

/** Los argumentos de la orden `despliegue`. */
export interface ArgumentosDelDespliegue {
  /** `apps/web`, con `dist` ya construido. */
  readonly carpeta: string;
  /** El commit de `celda/v1` del que sale la web. */
  readonly commit: string;
  /** Se ha pedido a mano: se despliega aunque nada cambie. */
  readonly aMano: boolean;
  /** Un fichero al que añadir el resultado para el flujo de GitHub, su `$GITHUB_OUTPUT`. */
  readonly salida: Option.Option<string>;
}

/** Lee `<carpeta> --commit <commit> [--a-mano] [--salida <fichero>]`, en cualquier orden. */
export const argumentosDelDespliegue = (argumentos: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sueltos: Array<string> = [];
    let commit: string | undefined;
    let salida: string | undefined;
    let aMano = false;
    for (let i = 0; i < argumentos.length; i++) {
      const argumento = argumentos[i];
      if (argumento === "--a-mano") aMano = true;
      else if (argumento === "--commit") commit = argumentos[++i];
      else if (argumento === "--salida") salida = argumentos[++i];
      else if (argumento !== undefined) sueltos.push(argumento);
    }
    const [carpeta, ...demas] = sueltos;
    if (carpeta === undefined || demas.length > 0 || commit === undefined || commit === "") {
      return yield* new UsoDelDespliegue();
    }
    const leidos: ArgumentosDelDespliegue = {
      carpeta,
      commit,
      aMano,
      salida: Option.fromUndefinedOr(salida),
    };
    return leidos;
  });

/**
 * La orden `despliegue` dice si hay que desplegar la web de `carpeta` y por qué
 * (`comprobarDespliegue`). Escribe en el registro una frase por cada señal y la decisión, y con
 * `--salida` añade a ese fichero `desplegar`, `despliegue` y `motivo` para el flujo de GitHub. La
 * lanza el flujo de despliegue antes de llamar a Vercel; ella no despliega nada.
 */
export const ordenDespliegue = Effect.fn("Nocturna.despliegue")(function* (
  argumentos: ArgumentosDelDespliegue,
  r2: R2DelDespliegue,
) {
  const comprobacion = yield* comprobarDespliegue({
    carpeta: argumentos.carpeta,
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
