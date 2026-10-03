// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import { arcoDe, LimitesDeMunicipios } from "@celda/dominio/municipio";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import {
  ficheroDeLimites,
  limitesDeComunidadesYProvincias,
  type TipoDeLimite,
  tiposDeLimite,
  TOLERANCIA_LIMITES_METROS,
  UNIDADES_LIMITES_POR_GRADO,
} from "./limites.ts";

/** Los límites del repositorio y el fichero que escribe `pnpm run limites` para la web. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const LIMITES = "../../apps/web/src/mapa/limites.json";

/**
 * Lo que puede pesar el fichero, que la web descarga en cada visita. El ADR 0023 lo dejó en
 * 20.569 bytes y 8.179 con gzip; esto es un 10 % más.
 */
const PRESUPUESTO = { bytes: 22_600, gzip: 9_000 };

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarGuardados = Schema.decodeEffect(
  Schema.fromJsonString(LimitesDeComunidadesYProvincias),
);

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    limites: yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS)),
    guardado: yield* fs.readFileString(LIMITES),
  };
}).pipe(Effect.provide(NodeServices.layer));

/**
 * Pares de municipios vecinos, por su nombre en el IGN, y lo que separa el arco que comparten:
 * una comunidad, una provincia de la misma comunidad o nada que el fichero tenga que llevar.
 */
const VECINOS: ReadonlyArray<readonly [string, string, TipoDeLimite | undefined]> = [
  ["Malgrat de Mar", "Blanes", "provincia"],
  ["Badajoz", "Cáceres", "provincia"],
  ["Dueñas", "Valoria la Buena", "provincia"],
  ["Alcanar", "Vinaròs", "comunidad"],
  ["Medinaceli", "Sigüenza", "comunidad"],
  ["Somosierra", "Santo Tomé del Puerto", "comunidad"],
  ["Irun", "Bera", "comunidad"],
  // El Condado de Treviño es de Burgos y está dentro de Álava.
  ["Condado de Treviño", "Vitoria-Gasteiz", "comunidad"],
  ["Barcelona", "L'Hospitalet de Llobregat", undefined],
  ["Medinaceli", "Arcos de Jalón", undefined],
  // Un territorio sin provincia: la frontera no es límite de nada que pinte el fichero.
  ["Irun", "Isla de los Faisanes", undefined],
];

/** Metros en un grado de latitud. */
const METROS_POR_GRADO = 111_195;

/** Distancia en metros de un punto a un segmento, en el plano local del punto. */
const distancia = (
  [px, py]: readonly [number, number],
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
): number => {
  const escalaX = METROS_POR_GRADO * Math.cos((py * Math.PI) / 180);
  const [x1, y1, x2, y2] = [
    (ax - px) * escalaX,
    (ay - py) * METROS_POR_GRADO,
    (bx - px) * escalaX,
    (by - py) * METROS_POR_GRADO,
  ];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const largo = dx * dx + dy * dy;
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / largo));
  return Math.hypot(x1 + t * dx, y1 + t * dy);
};

/** Los vértices de una línea en diferencias, en grados. */
const vertices = (linea: ReadonlyArray<number>, porGrado: number) => {
  const salida: Array<readonly [number, number]> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < linea.length; k += 2) {
    x += linea[k] ?? 0;
    y += linea[k + 1] ?? 0;
    salida.push([x / porGrado, y / porGrado]);
  }
  return salida;
};

/** Lo que hay entre la línea más cercana y el punto, en metros. */
const cerca = (
  lineas: ReadonlyArray<ReadonlyArray<number>>,
  punto: readonly [number, number],
): number =>
  Math.min(
    ...lineas.flatMap((linea) => {
      const v = vertices(linea, UNIDADES_LIMITES_POR_GRADO);
      return v.slice(1).map((b, k) => distancia(punto, v[k] ?? b, b));
    }),
  );

describe("límites de comunidades y provincias guardados en el repositorio", () => {
  it.effect("son los que salen de los límites de municipios", () =>
    Effect.gen(function* () {
      const { limites, guardado } = yield* leer;
      const esperados = ficheroDeLimites(
        limitesDeComunidadesYProvincias(
          limites,
          TOLERANCIA_LIMITES_METROS,
          UNIDADES_LIMITES_POR_GRADO,
        ),
      );
      assert.strictEqual(
        guardado,
        esperados,
        "los límites están desfasados: vuelve a escribirlos con `pnpm run limites`",
      );
    }),
  );

  it.effect("caben en su presupuesto", () =>
    Effect.gen(function* () {
      const { guardado } = yield* leer;
      const bytes = new TextEncoder().encode(guardado);
      const conGzip = yield* Effect.promise(() =>
        new Response(
          new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
        ).arrayBuffer(),
      );
      assert.isAtMost(bytes.length, PRESUPUESTO.bytes);
      assert.isAtMost(conGzip.byteLength, PRESUPUESTO.gzip);
    }),
  );

  it.effect("cada vecindad conocida sale con su tipo, a menos de 1,2 km de su arco", () =>
    Effect.gen(function* () {
      const { limites, guardado } = yield* leer;
      const tipos = tiposDeLimite(limites);
      const fichero = yield* decodificarGuardados(guardado);
      const arcosDe = (nombre: string) => {
        const territorio = limites.territorios.find((t) => t.nombre === nombre);
        assert.isDefined(territorio, nombre);
        return new Set(territorio?.poligonos.flat(2).map(arcoDe));
      };
      for (const [a, b, tipo] of VECINOS) {
        const deB = arcosDe(b);
        const comunes = [...arcosDe(a)].filter((arco) => deB.has(arco));
        assert.isNotEmpty(comunes, `${a} y ${b} no son vecinos`);
        for (const arco of comunes) {
          assert.strictEqual(tipos[arco], tipo, `${a} y ${b}`);
          // El vértice del medio del arco, en grados.
          const enGrados = vertices(limites.arcos[arco] ?? [], limites.unidadesPorGrado);
          const medio = enGrados[Math.floor(enGrados.length / 2)] ?? [0, 0];
          if (tipo === "comunidad") {
            assert.isAtMost(cerca(fichero.comunidades, medio), 1200, `${a} y ${b}`);
          }
          if (tipo === "provincia") {
            assert.isAtMost(cerca(fichero.provincias, medio), 1200, `${a} y ${b}`);
            assert.isAbove(cerca(fichero.comunidades, medio), 1200, `${a} y ${b}`);
          }
        }
      }
    }),
  );

  it.effect("ningún tramo sale dos veces", () =>
    Effect.gen(function* () {
      const { guardado } = yield* leer;
      const fichero = yield* decodificarGuardados(guardado);
      const vistos = new Set<string>();
      for (const linea of [...fichero.comunidades, ...fichero.provincias]) {
        const v = vertices(linea, 1);
        for (const [k, b] of v.slice(1).entries()) {
          const tramo = [String(v[k]), String(b)].toSorted().join(" ");
          assert.isFalse(vistos.has(tramo), `${tramo} sale dos veces`);
          vistos.add(tramo);
        }
      }
    }),
  );
});
