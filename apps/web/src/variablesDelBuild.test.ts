// @vitest-environment node
// La prueba del build construye la web en otro proceso y lee lo construido del disco, sin Effect
// ni navegador.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

import { avisoDeFugas, type Fuga, fugasDeVariables, LARGO_MINIMO } from "./variablesDelBuild.ts";

const fichero = (contenido: string): ReadonlyMap<string, string> =>
  new Map([["assets/index.js", contenido]]);

const fuga = (variable: string, por: Fuga["por"]): Fuga => ({
  fichero: "assets/index.js",
  variable,
  por,
});

describe("fugasDeVariables", () => {
  it("deja los nombres de la lista y los que usa Vite por dentro", () => {
    const contenido =
      'const v={VITE_CELDA_CONVEX_URL:void 0};f("VITE_BUSCADOR_URL","VITE_CAPAS_ORIGEN");' +
      "__VITE_PRELOAD__;e?.env??{BASE_URL:`/`,MODE:`production`}";
    assert.deepStrictEqual(fugasDeVariables(fichero(contenido), {}), []);
  });

  it("encuentra el nombre de una VITE_VERCEL_*, de otra VITE_* y de una CELDA_R2_*", () => {
    const contenido =
      "{VITE_VERCEL_GIT_COMMIT_SHA:`abc`,VITE_OTRA:`x`};" +
      'f("CELDA_R2_SECRETO");f("VITE_CAPAS_ORIGEN_LARGO")';
    assert.deepStrictEqual(fugasDeVariables(fichero(contenido), {}), [
      fuga("CELDA_R2_SECRETO", "nombre"),
      fuga("VITE_CAPAS_ORIGEN_LARGO", "nombre"),
      fuga("VITE_OTRA", "nombre"),
      fuga("VITE_VERCEL_GIT_COMMIT_SHA", "nombre"),
    ]);
  });

  it("encuentra el valor de una variable ajena aunque el minificador escape sus comillas", () => {
    const entorno = {
      CELDA_R2_SECRETO: 'secreto-de-prueba "entre comillas"',
      VITE_VERCEL_URL: "despliegue-de-prueba.vercel.app",
    };
    const contenido =
      'x="secreto-de-prueba \\"entre comillas\\"";y=`https://despliegue-de-prueba.vercel.app`';
    assert.deepStrictEqual(fugasDeVariables(fichero(contenido), entorno), [
      fuga("CELDA_R2_SECRETO", "valor"),
      fuga("VITE_VERCEL_URL", "valor"),
    ]);
  });

  it("no busca los valores cortos, los de la lista ni los de una variable de Vite", () => {
    const corto = "x".repeat(LARGO_MINIMO - 1);
    const entorno = {
      MODE: "production",
      VITE_VERCEL_ENV: "production",
      VITE_VERCEL_GIT_REPO_SLUG: corto,
      VITE_CELDA_CONVEX_URL: "https://buzon-de-prueba.convex.cloud",
    };
    const contenido = `{MODE:\`production\`};f("${corto}","https://buzon-de-prueba.convex.cloud")`;
    assert.deepStrictEqual(fugasDeVariables(fichero(contenido), entorno), []);
    assert.deepStrictEqual(
      fugasDeVariables(fichero(`f("${corto}x")`), { VITE_VERCEL_GIT_REPO_SLUG: `${corto}x` }),
      [fuga("VITE_VERCEL_GIT_REPO_SLUG", "valor")],
    );
  });

  it("el aviso nombra cada variable y no dice su valor", () => {
    const entorno = { CELDA_R2_SECRETO: "secreto-de-prueba" };
    const aviso = avisoDeFugas(fugasDeVariables(fichero('f("secreto-de-prueba")'), entorno));
    assert.include(aviso, "assets/index.js: el valor de CELDA_R2_SECRETO");
    assert.notInclude(aviso, "secreto-de-prueba");
  });
});

const WEB = NodeURL.fileURLToPath(new URL("..", import.meta.url));

/**
 * Lo que pone Vercel en el entorno de un build, con valores falsos que cambian de un despliegue a
 * otro, y las variables del proyecto de Vercel, con las credenciales del cubo y el buzón de Convex.
 */
const entornoDeVercel = (despliegue: string) => ({
  VITE_VERCEL_ENV: despliegue === "a" ? "production" : "preview",
  VITE_VERCEL_URL: `celda-${despliegue}-falso.vercel.app`,
  VITE_VERCEL_DEPLOYMENT_ID: `dpl_DespliegueFalso${despliegue}`,
  VITE_VERCEL_GIT_REPO_OWNER: `propietario-falso-${despliegue}`,
  VITE_VERCEL_GIT_REPO_SLUG: `repo-${despliegue}`,
  VITE_VERCEL_GIT_COMMIT_SHA: despliegue.repeat(40),
  VITE_VERCEL_GIT_COMMIT_MESSAGE: `Celda: un commit falso "${despliegue}"\ncon dos líneas`,
  VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME: `Autora Falsa ${despliegue}`,
  VITE_OTRA_DEL_PROYECTO: `otra-variable-falsa-${despliegue}`,
  CELDA_R2_CUENTA: `cuenta-falsa-${despliegue}`.padEnd(32, "0"),
  CELDA_R2_CUBO: `cubo-falso-${despliegue}`,
  VITE_CELDA_CONVEX_URL: "https://buzon-de-prueba.convex.cloud",
});

/** Del entorno de la prueba, `vp` solo recibe lo que necesita para arrancar. */
const ENTORNO_DEL_PROCESO = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR"].flatMap((variable) => {
    const valor = NodeProcess.env[variable];
    return valor === undefined ? [] : [[variable, valor]];
  }),
);

/** Construye la web en `salida` con el entorno del despliegue, como el build de Vercel. */
const construir = (despliegue: string, salida: string): void => {
  const resultado = NodeChildProcess.spawnSync(
    NodePath.join(WEB, "node_modules/.bin/vp"),
    ["build", "--outDir", salida, "--emptyOutDir", "--logLevel", "error"],
    { cwd: WEB, encoding: "utf8", env: { ...ENTORNO_DEL_PROCESO, ...entornoDeVercel(despliegue) } },
  );
  assert.strictEqual(resultado.status, 0, `el build ${despliegue} falla:\n${resultado.stderr}`);
};

/** Cada fichero de `carpeta`, por su ruta dentro de ella. */
const ficherosDe = (carpeta: string): ReadonlyMap<string, Buffer> =>
  new Map(
    NodeFS.readdirSync(carpeta, { recursive: true, withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => {
        const ruta = NodePath.join(entrada.parentPath, entrada.name);
        return [NodePath.relative(carpeta, ruta), NodeFS.readFileSync(ruta)] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );

describe("el build", () => {
  it(
    "pasa la comprobación con las variables de dos despliegues distintos, y da los mismos bytes",
    { timeout: 120_000 },
    () => {
      const carpeta = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "celda-variables-"));
      try {
        const a = NodePath.join(carpeta, "a");
        const b = NodePath.join(carpeta, "b");
        construir("a", a);
        construir("b", b);
        const deA = ficherosDe(a);
        const deB = ficherosDe(b);
        assert.isTrue(deA.has("index.html"));
        assert.deepStrictEqual([...deB.keys()], [...deA.keys()]);
        const distintos = [...deA].filter(([ruta, bytes]) => deB.get(ruta)?.equals(bytes) !== true);
        assert.deepStrictEqual(
          distintos.map(([ruta]) => ruta),
          [],
        );
      } finally {
        NodeFS.rmSync(carpeta, { recursive: true, force: true });
      }
    },
  );
});
