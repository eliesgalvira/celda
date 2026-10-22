/**
 * La comprobación de que el build solo lleva las variables de entorno que lee la web (#83).
 *
 * Un fichero de `dist` no puede llevar el nombre de una variable `VITE_*` que no esté en
 * `VARIABLES_DE_LA_WEB` (`variables.ts`), ni el de una `CELDA_R2_*`, las credenciales del cubo.
 * Tampoco el valor que tiene en el entorno del build una de esas variables. En Vercel eso cubre las
 * `VITE_VERCEL_*`, que cambian en cada despliegue y dicen el commit, su autor y el repositorio.
 * `soloLasVariablesDeLaWeb` es el plugin de Vite que hace fallar el build en ese caso.
 */
import { loadEnv, type Plugin } from "vite";

import { VARIABLES_DE_LA_WEB } from "./variables.ts";

/** Una variable que un fichero de `dist` lleva sin deber, por su nombre o por su valor. */
export interface Fuga {
  readonly fichero: string;
  readonly variable: string;
  readonly por: "nombre" | "valor";
}

/** Las variables de entorno de un build, por su nombre. */
export type EntornoDelBuild = Readonly<Record<string, string | undefined>>;

const LISTA: ReadonlySet<string> = new Set(VARIABLES_DE_LA_WEB);

/**
 * Si la variable no puede salir en `dist`, por ser una `VITE_*` que la web no lee o una
 * `CELDA_R2_*`.
 */
const esAjena = (variable: string): boolean =>
  variable.startsWith("CELDA_R2_") || (variable.startsWith("VITE_") && !LISTA.has(variable));

/** Un nombre de variable `VITE_*` o `CELDA_R2_*` que no es parte de otro nombre más largo. */
const NOMBRE = /(?<![\w$])(?:VITE|CELDA_R2)_[A-Z0-9_]+/gu;

/**
 * Los caracteres que el minificador puede escribir de otra forma dentro de una cadena, que son las
 * comillas, las barras inversas, `$` y los saltos de línea.
 */
const ESCAPABLE = /["'`\\$\r\n\t]/u;

/**
 * Por debajo de este largo, un valor sale por casualidad en cualquier JavaScript minificado, como
 * el `HEAD` o el `1` de algunas `VITE_VERCEL_*`. Esos valores no se buscan.
 */
export const LARGO_MINIMO = 8;

/** El tramo más largo del valor que no tiene nada escapable, que es lo que se busca. */
const tramoBuscado = (valor: string): string =>
  valor
    .split(ESCAPABLE)
    .reduce((largo, tramo) => (tramo.length > largo.length ? tramo : largo), "");

/**
 * Las fugas de los ficheros de `dist` (ruta y contenido), una por cada variable ajena que sale en
 * un fichero por su nombre o por su valor. `entorno` son las variables del build, con las que Vite
 * pone siempre en `import.meta.env`, como `MODE`. Un valor ajeno se busca si su tramo sin nada
 * escapable tiene al menos `LARGO_MINIMO` caracteres y no es también el de una variable que el
 * build puede llevar. El `production` de `VITE_VERCEL_ENV` es el de `MODE`, y encontrarlo no dice
 * nada.
 */
export const fugasDeVariables = (
  ficheros: ReadonlyMap<string, string>,
  entorno: EntornoDelBuild,
): Array<Fuga> => {
  const variables = Object.entries(entorno).flatMap(([variable, valor]) =>
    valor === undefined ? [] : [{ variable, valor }],
  );
  const permitidos = new Set(
    variables.filter(({ variable }) => !esAjena(variable)).map(({ valor }) => valor),
  );
  const buscados = variables.flatMap(({ variable, valor }) => {
    const tramo = tramoBuscado(valor);
    return esAjena(variable) && tramo.length >= LARGO_MINIMO && !permitidos.has(valor)
      ? [{ variable, tramo }]
      : [];
  });
  return [...ficheros].flatMap(([fichero, contenido]) => [
    ...[...new Set(contenido.match(NOMBRE))]
      .filter(esAjena)
      .sort()
      .map((variable): Fuga => ({ fichero, variable, por: "nombre" })),
    ...buscados
      .filter(({ tramo }) => contenido.includes(tramo))
      .map(({ variable }): Fuga => ({ fichero, variable, por: "valor" })),
  ]);
};

/** El aviso con el que falla el build. Nombra cada variable, pero no dice su valor. */
export const avisoDeFugas = (fugas: ReadonlyArray<Fuga>): string =>
  [
    "dist lleva variables de entorno que la web no lee (#83). La web solo puede leer las de " +
      "VARIABLES_DE_LA_WEB (apps/web/src/variables.ts), cada una con su import.meta.env.VITE_… " +
      "escrito entero.",
    ...fugas.map((fuga) => `  ${fuga.fichero}: el ${fuga.por} de ${fuga.variable}`),
  ].join("\n");

const texto = new TextDecoder();

/**
 * El plugin de Vite que hace fallar el build si algún fichero que escribe tiene una fuga. Mira las
 * variables `VITE_*` y `CELDA_R2_*` del proceso y de los `.env` del modo, como hace Vite, y las de
 * `import.meta.env`.
 */
export const soloLasVariablesDeLaWeb = (): Plugin => ({
  name: "celda-variables-de-la-web",
  apply: "build",
  writeBundle(_opciones, salida) {
    const { mode, envDir, env } = this.environment.config;
    const entorno = {
      ...loadEnv(mode, envDir, ["VITE_", "CELDA_R2_"]),
      ...Object.fromEntries(
        Object.entries(env).map(([variable, valor]) => [variable, String(valor)]),
      ),
    };
    const ficheros = new Map(
      Object.values(salida).map((fichero) => [
        fichero.fileName,
        fichero.type === "chunk"
          ? fichero.code
          : fichero.source instanceof Uint8Array
            ? texto.decode(fichero.source)
            : fichero.source,
      ]),
    );
    const fugas = fugasDeVariables(ficheros, entorno);
    if (fugas.length > 0) this.error(avisoDeFugas(fugas));
  },
});
