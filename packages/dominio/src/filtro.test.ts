import { assert, describe, it } from "@effect/vitest";

import { mascaraDeCompanias } from "./capa.ts";
import type { Compania } from "./compania.ts";
import {
  claveDeFiltro,
  combinacionesDe,
  conmutarCompania,
  contarConFiltro,
  deLasCeldas,
  hayFiltro,
  mismoFiltro,
  nombresDelFiltro,
  normalizarFiltro,
  papelDe,
  redesUsadas,
  resaltadasDe,
  separarPorPapel,
  SIN_FILTRO,
  textoDeRedUsada,
} from "./filtro.ts";

const sitio = (clave: string, ...companias: ReadonlyArray<Compania>) => ({ clave, companias });

const SOLO_MOVISTAR = sitio("m", "movistar");
const SOLO_VODAFONE = sitio("v", "vodafone");
const SOLO_ORANGE = sitio("o", "orange");
const SOLO_DIGI = sitio("d", "digi");
const SOLO_YOIGO = sitio("y", "yoigo");
const MOVISTAR_Y_VODAFONE = sitio("mv", "movistar", "vodafone");
const ORANGE_Y_YOIGO = sitio("oy", "orange", "yoigo");
const MOVISTAR_Y_DIGI = sitio("md", "movistar", "digi");
const SIN_COMPANIAS = sitio("x");
const TODOS = [
  SOLO_MOVISTAR,
  SOLO_VODAFONE,
  SOLO_ORANGE,
  SOLO_DIGI,
  SOLO_YOIGO,
  MOVISTAR_Y_VODAFONE,
  ORANGE_Y_YOIGO,
  MOVISTAR_Y_DIGI,
  SIN_COMPANIAS,
];

const claves = (lista: ReadonlyArray<{ readonly clave: string }>) => lista.map((e) => e.clave);

describe("filtro de compañías", () => {
  it("va en el orden de las compañías, sin repetir, y todas elegidas es sin filtro", () => {
    assert.deepStrictEqual(normalizarFiltro(["digi", "movistar", "digi"]), ["movistar", "digi"]);
    assert.deepStrictEqual(
      normalizarFiltro(["yoigo", "digi", "orange", "vodafone", "movistar"]),
      SIN_FILTRO,
    );
    assert.isFalse(hayFiltro(SIN_FILTRO));
    assert.isTrue(hayFiltro(["movistar"]));
    assert.strictEqual(claveDeFiltro(SIN_FILTRO), "todas");
    assert.strictEqual(claveDeFiltro(["movistar", "digi"]), "movistar+digi");
    assert.isTrue(mismoFiltro(normalizarFiltro(["digi", "movistar"]), ["movistar", "digi"]));
  });

  it("desde todas, tocar una deja solo esa; tocarla otra vez vuelve a todas", () => {
    const solo = conmutarCompania(SIN_FILTRO, "movistar");
    assert.deepStrictEqual(solo, ["movistar"]);
    const dos = conmutarCompania(solo, "digi");
    assert.deepStrictEqual(dos, ["movistar", "digi"]);
    assert.deepStrictEqual(conmutarCompania(dos, "movistar"), ["digi"]);
    assert.deepStrictEqual(conmutarCompania(solo, "movistar"), SIN_FILTRO);
    // Elegir la quinta es lo mismo que no filtrar.
    const cuatro = normalizarFiltro(["movistar", "vodafone", "orange", "digi"]);
    assert.deepStrictEqual(conmutarCompania(cuatro, "yoigo"), SIN_FILTRO);
  });

  it("sin filtro sale todo, también un emplazamiento sin compañías conocidas", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, SIN_FILTRO);
    assert.strictEqual(propios, TODOS);
    assert.deepStrictEqual(redUsada, []);
  });

  it("solo Movistar: los suyos, también los compartidos, y nada aparte", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, ["movistar"]);
    assert.deepStrictEqual(claves(propios), ["m", "mv", "md"]);
    assert.deepStrictEqual(redUsada, []);
    assert.deepStrictEqual(redesUsadas(["movistar"]), []);
  });

  it("solo Digi: los suyos y, aparte, los de Movistar sin Digi", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, ["digi"]);
    // El compartido de Movistar y Digi es de Digi: no sale dos veces.
    assert.deepStrictEqual(claves(propios), ["d", "md"]);
    assert.deepStrictEqual(claves(redUsada), ["m", "mv"]);
    assert.deepStrictEqual(redesUsadas(["digi"]), [{ compania: "digi", red: "movistar" }]);
    assert.strictEqual(papelDe(["vodafone"], ["digi"]), undefined);
    assert.strictEqual(papelDe(["movistar", "vodafone"], ["digi"]), "red-usada");
  });

  it("solo Yoigo: los suyos y, aparte, los de Orange", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, ["yoigo"]);
    assert.deepStrictEqual(claves(propios), ["y", "oy"]);
    assert.deepStrictEqual(claves(redUsada), ["o"]);
  });

  it("con Digi y Movistar elegidas, la red de Movistar no sale aparte: ya es del filtro", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, ["movistar", "digi"]);
    assert.deepStrictEqual(claves(propios), ["m", "d", "mv", "md"]);
    assert.deepStrictEqual(redUsada, []);
    assert.deepStrictEqual(redesUsadas(["movistar", "digi"]), []);
  });

  it("con Digi y Yoigo, aparte salen las dos redes", () => {
    const { propios, redUsada } = separarPorPapel(TODOS, ["digi", "yoigo"]);
    assert.deepStrictEqual(claves(propios), ["d", "y", "oy", "md"]);
    assert.deepStrictEqual(claves(redUsada), ["m", "o", "mv"]);
    assert.strictEqual(nombresDelFiltro(["digi", "yoigo"]), "Digi y Yoigo");
    assert.strictEqual(
      textoDeRedUsada({ compania: "digi", red: "movistar" }),
      "Digi usa aquí la red de Movistar",
    );
  });

  describe("los emplazamientos de las celdas", () => {
    const deCeldas = (filtro: ReadonlyArray<Compania>) => {
      const { emplazamientos, redUsada } = deLasCeldas(TODOS, filtro);
      return { claves: claves(emplazamientos), redUsada: [...redUsada] };
    };

    it("solo Digi: los suyos y los de Movistar que usa, en su orden, y estos más claros", () => {
      assert.deepStrictEqual(deCeldas(["digi"]), {
        claves: ["m", "d", "mv", "md"],
        redUsada: ["m", "mv"],
      });
    });

    it("solo Yoigo: los suyos y los de Orange", () => {
      assert.deepStrictEqual(deCeldas(["yoigo"]), {
        claves: ["o", "y", "oy"],
        redUsada: ["o"],
      });
    });

    it("Digi y Movistar: cada uno una vez y ninguno aparte, también el compartido", () => {
      const { claves: lista, redUsada } = deCeldas(["movistar", "digi"]);
      assert.deepStrictEqual(lista, ["m", "d", "mv", "md"]);
      assert.strictEqual(new Set(lista).size, lista.length);
      assert.deepStrictEqual(redUsada, []);
    });

    it("todas: la misma lista, sin ninguno aparte", () => {
      const { emplazamientos, redUsada } = deLasCeldas(TODOS, SIN_FILTRO);
      assert.strictEqual(emplazamientos, TODOS);
      assert.strictEqual(redUsada.size, 0);
    });

    it("solo Movistar: solo los suyos, como en el mapa", () => {
      assert.deepStrictEqual(deCeldas(["movistar"]), {
        claves: ["m", "mv", "md"],
        redUsada: [],
      });
    });
  });

  it("el marcador resalta las compañías del filtro y las redes que usan", () => {
    assert.deepStrictEqual(resaltadasDe(["movistar", "vodafone"], SIN_FILTRO), [
      "movistar",
      "vodafone",
    ]);
    assert.deepStrictEqual(resaltadasDe(["movistar", "vodafone"], ["vodafone"]), ["vodafone"]);
    assert.deepStrictEqual(resaltadasDe(["movistar", "vodafone"], ["digi"]), ["movistar"]);
    assert.deepStrictEqual(resaltadasDe(["movistar", "digi"], ["digi", "orange"]), [
      "movistar",
      "digi",
    ]);
  });

  it("las combinaciones cuentan lo mismo que los emplazamientos, con cualquier filtro", () => {
    const combinaciones = combinacionesDe(TODOS);
    assert.deepStrictEqual(
      [...combinaciones],
      [
        [0, 1],
        [mascaraDeCompanias(["movistar"]), 1],
        [mascaraDeCompanias(["vodafone"]), 1],
        [mascaraDeCompanias(["movistar", "vodafone"]), 1],
        [mascaraDeCompanias(["orange"]), 1],
        [mascaraDeCompanias(["digi"]), 1],
        [mascaraDeCompanias(["movistar", "digi"]), 1],
        [mascaraDeCompanias(["yoigo"]), 1],
        [mascaraDeCompanias(["orange", "yoigo"]), 1],
      ],
    );
    const filtros: ReadonlyArray<ReadonlyArray<Compania>> = [
      [],
      ["movistar"],
      ["digi"],
      ["yoigo"],
      ["movistar", "vodafone"],
      ["digi", "yoigo"],
      ["vodafone", "digi"],
    ];
    for (const filtro of filtros) {
      const { propios, redUsada } = separarPorPapel(TODOS, filtro);
      assert.deepStrictEqual(
        contarConFiltro(combinaciones, filtro),
        { propios: propios.length, redUsada: redUsada.length },
        claveDeFiltro(filtro),
      );
    }
  });
});
