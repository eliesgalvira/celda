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
  LIMITES_DE_DETALLE,
  LIMITES_GENERALES,
  limitesDeComunidadesYProvincias,
  type NivelDeLimites,
  type TipoDeLimite,
  tiposDeLimite,
} from "./limites.ts";

/** Los límites del repositorio y los ficheros que escribe `pnpm run limites` para la web. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const LIMITES = "../../apps/web/src/mapa/limites.json";
const LIMITES_DETALLE = "../../apps/web/src/mapa/limites-detalle.json";

/**
 * Lo que puede pesar cada fichero. El general lo descarga la web en cada visita: el ADR 0023 lo
 * dejó en 20.569 bytes y 8.179 con gzip, y esto es un 10 % más. El de detalle, solo al acercarse:
 * pesaba 92.885 bytes y 36.661 con gzip el 05/10/2026, y esto también es un 10 % más.
 */
const PRESUPUESTO = { bytes: 22_600, gzip: 9_000 };
const PRESUPUESTO_DETALLE = { bytes: 102_000, gzip: 40_500 };

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarGuardados = Schema.decodeEffect(
  Schema.fromJsonString(LimitesDeComunidadesYProvincias),
);

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    limites: yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS)),
    guardado: yield* fs.readFileString(LIMITES),
    detalle: yield* fs.readFileString(LIMITES_DETALLE),
  };
}).pipe(Effect.provide(NodeServices.layer));

/** Lo que pesa un fichero, tal cual y con gzip. */
const pesoDe = (texto: string) =>
  Effect.promise(async () => {
    const bytes = new TextEncoder().encode(texto);
    const conGzip = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    return { bytes: bytes.length, gzip: conGzip.byteLength };
  });

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
  porGrado: number = LIMITES_GENERALES.unidadesPorGrado,
): number =>
  Math.min(
    ...lineas.flatMap((linea) => {
      const v = vertices(linea, porGrado);
      return v.slice(1).map((b, k) => distancia(punto, v[k] ?? b, b));
    }),
  );

/** El fichero que escribe la orden para un nivel. */
const esperado = (limites: LimitesDeMunicipios, nivel: NivelDeLimites) =>
  ficheroDeLimites(
    limitesDeComunidadesYProvincias(limites, nivel.toleranciaMetros, nivel.unidadesPorGrado),
  );

/**
 * Límites entre comunidades que siguen un río, donde la línea simplificada a 1 km cortaba los
 * meandros: el Cabriel entre Cuenca y València junto a Utiel, el Ebro entre La Rioja y Navarra y
 * el Tajo entre Madrid y Toledo en Aranjuez.
 */
const POR_UN_RIO: ReadonlyArray<readonly [string, string]> = [
  ["Minglanilla", "Venta del Moro"],
  ["Minglanilla", "Villargordo del Cabriel"],
  ["Alcanadre", "Mendavia"],
  ["Aranjuez", "Añover de Tajo"],
];

/** Cuántas veces usan los recintos cada arco: uno solo es el borde exterior, la costa o una frontera. */
const usosDeArcos = (limites: LimitesDeMunicipios): ReadonlyArray<number> => {
  const usos = limites.arcos.map(() => 0);
  for (const territorio of limites.territorios) {
    for (const referencia of territorio.poligonos.flat(2)) {
      const arco = arcoDe(referencia);
      usos[arco] = (usos[arco] ?? 0) + 1;
    }
  }
  return usos;
};

/** Los tramos de un fichero en una rejilla de 0,02°, para buscar el más cercano a un punto. */
const REJILLA = 0.02;
const rejillaDe = (fichero: typeof LimitesDeComunidadesYProvincias.Type) => {
  const celdas = new Map<
    string,
    Array<readonly [readonly [number, number], readonly [number, number]]>
  >();
  for (const linea of [...fichero.comunidades, ...fichero.provincias]) {
    const v = vertices(linea, fichero.unidadesPorGrado);
    for (const [k, b] of v.slice(1).entries()) {
      const a = v[k] ?? b;
      for (
        let i = Math.floor(Math.min(a[0], b[0]) / REJILLA);
        i <= Math.floor(Math.max(a[0], b[0]) / REJILLA);
        i++
      ) {
        for (
          let j = Math.floor(Math.min(a[1], b[1]) / REJILLA);
          j <= Math.floor(Math.max(a[1], b[1]) / REJILLA);
          j++
        ) {
          const clave = `${i} ${j}`;
          celdas.set(clave, [...(celdas.get(clave) ?? []), [a, b]]);
        }
      }
    }
  }
  /** La distancia en metros al tramo más cercano, si hay alguno a menos de unos 2 km. */
  return (punto: readonly [number, number]): number => {
    const i = Math.floor(punto[0] / REJILLA);
    const j = Math.floor(punto[1] / REJILLA);
    let menor = Number.POSITIVE_INFINITY;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const [a, b] of celdas.get(`${i + di} ${j + dj}`) ?? []) {
          menor = Math.min(menor, distancia(punto, a, b));
        }
      }
    }
    return menor;
  };
};

/** Los vértices de un arco a más de `margen` metros, a lo largo del arco, de sus dos extremos. */
const lejosDeLosExtremos = (
  arco: ReadonlyArray<number>,
  porGrado: number,
  margen: number,
): ReadonlyArray<readonly [number, number]> => {
  const v = vertices(arco, porGrado);
  const recorrido = [0];
  for (const [k, b] of v.slice(1).entries()) {
    recorrido.push((recorrido[k] ?? 0) + distancia(b, v[k] ?? b, v[k] ?? b));
  }
  const largo = recorrido.at(-1) ?? 0;
  return v.filter((_, k) => (recorrido[k] ?? 0) >= margen && largo - (recorrido[k] ?? 0) >= margen);
};

describe("límites de comunidades y provincias guardados en el repositorio", () => {
  it.effect("son los que salen de los límites de municipios, el general y el de detalle", () =>
    Effect.gen(function* () {
      const { limites, guardado, detalle } = yield* leer;
      const desfasados =
        "los límites están desfasados: vuelve a escribirlos con `pnpm run limites`";
      assert.strictEqual(guardado, esperado(limites, LIMITES_GENERALES), desfasados);
      assert.strictEqual(detalle, esperado(limites, LIMITES_DE_DETALLE), desfasados);
    }),
  );

  it.effect("caben en su presupuesto", () =>
    Effect.gen(function* () {
      const { guardado, detalle } = yield* leer;
      const general = yield* pesoDe(guardado);
      assert.isAtMost(general.bytes, PRESUPUESTO.bytes);
      assert.isAtMost(general.gzip, PRESUPUESTO.gzip);
      const deDetalle = yield* pesoDe(detalle);
      assert.isAtMost(deDetalle.bytes, PRESUPUESTO_DETALLE.bytes);
      assert.isAtMost(deDetalle.gzip, PRESUPUESTO_DETALLE.gzip);
    }),
  );

  it.effect("el de detalle va sobre la línea del IGN donde un río hace de límite", () =>
    Effect.gen(function* () {
      const { limites, detalle } = yield* leer;
      const fichero = yield* decodificarGuardados(detalle);
      const arcosDe = (nombre: string) => {
        const territorio = limites.territorios.find((t) => t.nombre === nombre);
        assert.isDefined(territorio, nombre);
        return new Set(territorio?.poligonos.flat(2).map(arcoDe));
      };
      for (const [a, b] of POR_UN_RIO) {
        const deB = arcosDe(b);
        const comunes = [...arcosDe(a)].filter((arco) => deB.has(arco));
        assert.isNotEmpty(comunes, `${a} y ${b} no son vecinos`);
        // Cada vértice del IGN queda a menos de la tolerancia, con 20 m de margen por el redondeo.
        for (const arco of comunes) {
          for (const punto of vertices(limites.arcos[arco] ?? [], limites.unidadesPorGrado)) {
            assert.isAtMost(
              cerca(fichero.comunidades, punto, LIMITES_DE_DETALLE.unidadesPorGrado),
              LIMITES_DE_DETALLE.toleranciaMetros + 20,
              `${a} y ${b}, ${String(punto)}`,
            );
          }
        }
      }
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

  it.effect("ningún tramo sale dos veces, ni en el general ni en el de detalle", () =>
    Effect.gen(function* () {
      const { guardado, detalle } = yield* leer;
      for (const texto of [guardado, detalle]) {
        const fichero = yield* decodificarGuardados(texto);
        const vistos = new Set<string>();
        for (const linea of [...fichero.comunidades, ...fichero.provincias]) {
          const v = vertices(linea, 1);
          for (const [k, b] of v.slice(1).entries()) {
            const tramo = [String(v[k]), String(b)].toSorted().join(" ");
            assert.isFalse(vistos.has(tramo), `${tramo} sale dos veces`);
            vistos.add(tramo);
          }
        }
      }
    }),
  );
  it.effect("ningún arco del borde de España es límite: ni la costa ni las fronteras", () =>
    Effect.gen(function* () {
      const { limites } = yield* leer;
      const tipos = tiposDeLimite(limites);
      const usos = usosDeArcos(limites);
      const exteriores = usos.flatMap((n, arco) => (n === 1 ? [arco] : []));
      assert.isAbove(exteriores.length, 1000);
      for (const arco of exteriores) assert.isUndefined(tipos[arco], `arco ${arco}`);
    }),
  );

  it.effect("ninguna línea de los dos ficheros va por el borde de España", () =>
    Effect.gen(function* () {
      const { limites, guardado, detalle } = yield* leer;
      const usos = usosDeArcos(limites);
      for (const texto of [guardado, detalle]) {
        const cerca = rejillaDe(yield* decodificarGuardados(texto));
        // Lejos de donde un límite llega a la costa o a la frontera, ninguna línea pasa a menos
        // de 400 m del borde: la más cercana, junto a Ondarroa, queda a unos 540 m.
        for (const [arco, n] of usos.entries()) {
          if (n !== 1) continue;
          for (const punto of lejosDeLosExtremos(
            limites.arcos[arco] ?? [],
            limites.unidadesPorGrado,
            2000,
          )) {
            assert.isAtLeast(cerca(punto), 400, `arco ${arco}, ${String(punto)}`);
          }
        }
      }
    }),
  );

  it.effect("ni en el Guadiana de Badajoz, ni en Irun, ni en Ceuta", () =>
    Effect.gen(function* () {
      const { limites, guardado, detalle } = yield* leer;
      const usos = usosDeArcos(limites);
      const exterioresDe = (nombre: string) => {
        const territorio = limites.territorios.find((t) => t.nombre === nombre);
        assert.isDefined(territorio, nombre);
        return [...new Set(territorio?.poligonos.flat(2).map(arcoDe))].filter(
          (arco) => usos[arco] === 1,
        );
      };
      for (const texto of [guardado, detalle]) {
        const fichero = yield* decodificarGuardados(texto);
        const lineas = [...fichero.comunidades, ...fichero.provincias];
        for (const [nombre, minimo] of [
          ["Badajoz", 20_000],
          ["Irun", 1_500],
          ["Ceuta", 30_000],
        ] as const) {
          const arcos = exterioresDe(nombre);
          assert.isNotEmpty(arcos, nombre);
          for (const arco of arcos) {
            // Donde un límite de provincia llega a la frontera, como el de Navarra junto a Irun,
            // la línea la toca: se mira a más de 2 km de los extremos de cada arco.
            const lejos = lejosDeLosExtremos(
              limites.arcos[arco] ?? [],
              limites.unidadesPorGrado,
              2000,
            );
            for (const punto of lejos) {
              assert.isAtLeast(
                cerca(lineas, punto, fichero.unidadesPorGrado),
                minimo,
                `${nombre}, ${String(punto)}`,
              );
            }
          }
        }
      }
    }),
  );
});
