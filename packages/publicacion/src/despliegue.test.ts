// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  codificarDespliegue,
  decidir,
  FICHERO_DEL_DESPLIEGUE,
  huellaDeLaWeb,
  Produccion,
  produccionEn,
  type Senal,
  salidaDelDespliegue,
  senalDeLaWeb,
} from "./despliegue.ts";
import { VercelNoDisponible } from "./vercel.ts";

/**
 * Una carpeta `apps/web` de mentira dentro de un monorepo de mentira: la web construida en `dist`,
 * con las capas montadas y el `despliegue.json` del build de Vercel, su código, sus pruebas, su
 * configuración de Vercel y, al lado, la documentación, la ingesta y Nix.
 */
const MONOREPO = {
  "apps/web/dist/index.html": "<!doctype html><script src=/assets/index-a1.js></script>",
  "apps/web/dist/assets/index-a1.js": "console.log('celda')",
  "apps/web/dist/assets/index-b2.css": "body{margin:0}",
  "apps/web/dist/iconos/favicon.svg": "<svg/>",
  "apps/web/dist/capas/vigente.json": '{"version":"sitios@2026-10-19T22:30:02Z"}',
  "apps/web/dist/capas/provincias/08/0123456789abcdef.json": "{}",
  [`apps/web/dist/${FICHERO_DEL_DESPLIEGUE}`]: '{"web":"0","commit":"a"}',
  "apps/web/vercel.json": '{"buildCommand":"./scripts/vercel.sh"}',
  "apps/web/scripts/vercel.sh": "pnpm run build",
  "apps/web/scripts/sitio.sh": "pnpm run build",
  "apps/web/src/entrada.tsx": "export {}",
  "apps/web/src/entrada.test.tsx": "export {}",
  "apps/web/package.json": "{}",
  "apps/web/.env.development": "VITE_CAPAS_ORIGEN=http://127.0.0.1:8852",
  "docs/adr/0018-capas-solo-desde-vercel.md": "# ADR",
  "apps/nocturna/src/programa.ts": "export {}",
  "nix/nocturna.nix": "{ }",
  "flake.lock": "{}",
} satisfies Readonly<Record<string, string>>;

/** El monorepo de mentira en una carpeta temporal, con `cambios` encima. */
const escribir = (cambios: Readonly<Record<string, string | undefined>> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "celda-despliegue-" });
    for (const [ruta, contenido] of Object.entries({ ...MONOREPO, ...cambios })) {
      if (contenido === undefined) continue;
      const fichero = path.join(raiz, ruta);
      yield* fs.makeDirectory(path.dirname(fichero), { recursive: true });
      yield* fs.writeFileString(fichero, contenido);
    }
    return path.join(raiz, "apps", "web");
  });

/** La huella de la web del monorepo de mentira con `cambios`. */
const huellaCon = (cambios: Readonly<Record<string, string | undefined>> = {}) =>
  Effect.flatMap(escribir(cambios), huellaDeLaWeb);

/** Producción de mentira, que sirve los ficheros de `servidos` y da 404 con el resto. */
const produccionCon = (servidos: Readonly<Record<string, string>>) =>
  Layer.succeed(
    Produccion,
    Produccion.of({ leer: (ruta) => Effect.succeed(Option.fromUndefinedOr(servidos[ruta])) }),
  );

const HUELLA = "a".repeat(64);
const OTRA = "b".repeat(64);

describe("la huella de la web", () => {
  it.effect("no cambia al construir otra vez lo mismo, y cambia con un byte de dist", () =>
    Effect.gen(function* () {
      const una = yield* huellaCon();
      assert.match(una, /^[0-9a-f]{64}$/u);
      assert.strictEqual(yield* huellaCon(), una);
      assert.notStrictEqual(
        yield* huellaCon({ "apps/web/dist/assets/index-a1.js": "console.log('Celda')" }),
        una,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // Lo que entra en el build de Vercel y lo que no. La huella solo lee lo construido y cómo lo
  // construye y lo sirve Vercel, así que el resto solo cuenta si cambia lo construido.
  const cuentan: ReadonlyArray<readonly [string, Readonly<Record<string, string | undefined>>]> = [
    ["un fichero de la web construida", { "apps/web/dist/index.html": "<!doctype html>" }],
    ["un fichero nuevo en dist", { "apps/web/dist/assets/worker-c3.js": "onmessage=null" }],
    ["un fichero que ya no está en dist", { "apps/web/dist/iconos/favicon.svg": undefined }],
    [
      "un icono con el mismo nombre y otro contenido",
      { "apps/web/dist/iconos/favicon.svg": "<svg></svg>" },
    ],
    ["las cabeceras o las reescrituras de vercel.json", { "apps/web/vercel.json": "{}" }],
    ["el build de Vercel, scripts/vercel.sh", { "apps/web/scripts/vercel.sh": "pnpm build" }],
  ];
  const noCuentan: ReadonlyArray<readonly [string, Readonly<Record<string, string | undefined>>]> =
    [
      ["las capas montadas en dist/capas", { "apps/web/dist/capas/vigente.json": "{}" }],
      ["una capa más en dist/capas", { "apps/web/dist/capas/puntos/fedcba9876543210.json": "{}" }],
      ["el despliegue.json del build de Vercel", { "apps/web/dist/despliegue.json": "{}" }],
      ["el código de la web, si no cambia lo construido", { "apps/web/src/entrada.tsx": "//" }],
      ["una prueba de la web", { "apps/web/src/entrada.test.tsx": "it()" }],
      ["el package.json de la web, si no cambia lo construido", { "apps/web/package.json": "[]" }],
      ["la vista previa local, scripts/sitio.sh", { "apps/web/scripts/sitio.sh": "echo" }],
      ["las variables de desarrollo", { "apps/web/.env.development": "" }],
      ["la documentación", { "docs/adr/0018-capas-solo-desde-vercel.md": "# Otro" }],
      ["la ingesta", { "apps/nocturna/src/programa.ts": "export const a = 1" }],
      ["Nix", { "nix/nocturna.nix": "{ x = 1; }", "flake.lock": "[]" }],
    ];

  for (const [que, cambios] of cuentan) {
    it.effect(`cambia con ${que}`, () =>
      Effect.gen(function* () {
        assert.notStrictEqual(yield* huellaCon(cambios), yield* huellaCon());
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
  for (const [que, cambios] of noCuentan) {
    it.effect(`no cambia con ${que}`, () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* huellaCon(cambios), yield* huellaCon());
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("sin la web construida, la orden falla y dice qué hacer", () =>
    Effect.gen(function* () {
      const web = yield* escribir();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.remove(path.join(web, "dist"), { recursive: true });
      const fallo = yield* Effect.flip(huellaDeLaWeb(web));
      assert.strictEqual(fallo._tag, "WebSinConstruir");
      assert.include(fallo.message, "pnpm run build");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("la señal de la web", () => {
  const conProduccion = (servidos: Readonly<Record<string, string>>) =>
    senalDeLaWeb(HUELLA).pipe(Effect.provide(produccionCon(servidos)));

  it.effect("es igual si producción sirve la misma huella, y dice de qué commit", () =>
    Effect.gen(function* () {
      const senal = yield* conProduccion({
        [FICHERO_DEL_DESPLIEGUE]: codificarDespliegue({ web: HUELLA, commit: "0631fc3eb2352cd9" }),
      });
      assert.strictEqual(senal.tipo, "igual");
      assert.include(senal.detalle, "0631fc3");
    }),
  );

  it.effect("cambia si producción sirve otra huella", () =>
    Effect.gen(function* () {
      const senal = yield* conProduccion({
        [FICHERO_DEL_DESPLIEGUE]: codificarDespliegue({ web: OTRA, commit: "454e637" }),
      });
      assert.strictEqual(senal.tipo, "cambia");
      assert.include(senal.detalle, "bbbbbbbbbbbb");
      assert.include(senal.detalle, "aaaaaaaaaaaa");
    }),
  );

  it.effect("no se sabe si producción no tiene despliegue.json o sirve la página de la web", () =>
    Effect.gen(function* () {
      const sinFichero = yield* conProduccion({});
      assert.strictEqual(sinFichero.tipo, "no-se-sabe");
      const pagina = yield* conProduccion({ [FICHERO_DEL_DESPLIEGUE]: "<!doctype html>" });
      assert.strictEqual(pagina.tipo, "no-se-sabe");
      const otraForma = yield* conProduccion({ [FICHERO_DEL_DESPLIEGUE]: '{"web":"corta"}' });
      assert.strictEqual(otraForma.tipo, "no-se-sabe");
    }),
  );

  it.effect("no se sabe si producción no contesta", () =>
    Effect.gen(function* () {
      const senal = yield* senalDeLaWeb(HUELLA).pipe(
        Effect.provide(
          Layer.succeed(
            Produccion,
            Produccion.of({
              leer: () => Effect.fail(new VercelNoDisponible({ motivo: "Vercel no contesta" })),
            }),
          ),
        ),
      );
      assert.deepStrictEqual(senal, {
        tipo: "no-se-sabe",
        detalle: "Producción no contesta (Vercel no contesta).",
      });
    }),
  );
});

describe("la decisión", () => {
  const igual: Senal = { tipo: "igual", detalle: "" };
  const cambia: Senal = { tipo: "cambia", detalle: "" };
  const noSeSabe: Senal = { tipo: "no-se-sabe", detalle: "" };

  it("sin ninguna señal no se despliega, y dice por qué", () => {
    assert.deepStrictEqual(decidir({ aMano: false, web: igual, datos: igual }), {
      desplegar: false,
      motivo: "No se despliega porque producción ya sirve esta web y estos datos.",
    });
  });

  it("con cualquiera de las dos señales se despliega, y dice cuál", () => {
    const casos: ReadonlyArray<readonly [Senal, Senal, string]> = [
      [cambia, igual, "Se despliega porque ha cambiado la web."],
      [igual, cambia, "Se despliega porque han cambiado los datos."],
      [cambia, cambia, "Se despliega porque ha cambiado la web y han cambiado los datos."],
      [noSeSabe, igual, "Se despliega porque no se sabe qué web sirve producción."],
      [igual, noSeSabe, "Se despliega porque no se sabe si han cambiado los datos."],
    ];
    for (const [web, datos, motivo] of casos) {
      assert.deepStrictEqual(decidir({ aMano: false, web, datos }), { desplegar: true, motivo });
    }
  });

  it("a mano se despliega aunque nada cambie", () => {
    assert.deepStrictEqual(decidir({ aMano: true, web: igual, datos: igual }), {
      desplegar: true,
      motivo: "Se despliega porque se ha pedido a mano.",
    });
  });

  it("deja al flujo de GitHub una clave por línea, con el JSON de despliegue.json", () => {
    const salida = salidaDelDespliegue({
      desplegar: false,
      motivo: "No se despliega porque producción ya sirve esta web y estos datos.",
      web: igual,
      datos: igual,
      despliegue: { web: HUELLA, commit: "0631fc3" },
    });
    assert.strictEqual(
      salida,
      [
        "desplegar=no",
        `despliegue={"web":"${HUELLA}","commit":"0631fc3"}`,
        "motivo=No se despliega porque producción ya sirve esta web y estos datos.",
        "",
      ].join("\n"),
    );
  });
});

describe("producción por su URL pública", () => {
  it.effect(
    "lee cada fichero desde la raíz del sitio, sin caché, y un 404 es que no lo tiene",
    () =>
      Effect.gen(function* () {
        const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
        const cliente = HttpClient.make((request, url) =>
          Effect.gen(function* () {
            const cache = request.headers["cache-control"] ?? "con caché";
            yield* Ref.update(pedidas, (p) => [...p, `${url.href} ${cache}`]);
            const cuerpo = url.pathname === "/capas/vigente.json" ? '{"version":"a"}' : undefined;
            return HttpClientResponse.fromWeb(
              request,
              new Response(cuerpo ?? "no está", { status: cuerpo === undefined ? 404 : 200 }),
            );
          }),
        );
        const leidos = yield* Effect.flatMap(Produccion, (produccion) =>
          Effect.all([produccion.leer("capas/vigente.json"), produccion.leer("despliegue.json")]),
        ).pipe(
          Effect.provide(
            produccionEn("https://celda.prueba/").pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
            ),
          ),
        );
        assert.deepStrictEqual(leidos, [Option.some('{"version":"a"}'), Option.none()]);
        assert.deepStrictEqual(yield* Ref.get(pedidas), [
          "https://celda.prueba/capas/vigente.json no-cache",
          "https://celda.prueba/despliegue.json no-cache",
        ]);
      }),
  );
});
