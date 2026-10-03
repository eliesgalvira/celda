import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { Barrio } from "@celda/dominio/barrio";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import type { ResumenLeido } from "@celda/dominio/provincias";

import { crearAgrupador, type ElementoAbrible, nivelDeZoom } from "../capa/agrupacion.ts";
import { combinacionesDe } from "../capa/marcadores.ts";
import { crearAgrupadorNacional, type EstadoProvincia } from "../capa/nacional.ts";
import {
  BARCELONA,
  barcelonaConMunicipios,
  estados,
  GIRONA,
  espanaDePrueba,
  RESUMEN,
  resumenConBarcelona,
} from "../capa/pruebasNacional.ts";
import { NIVEL_DE_BARRIOS, NIVEL_DE_MUNICIPIOS } from "../capa/zonas.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";

const MUNDO: Rectangulo = {
  suroeste: { longitud: -180, latitud: -85 },
  noreste: { longitud: 180, latitud: 85 },
};

// A y B caen en el barrio de Sant Antoni; C, en el Poblenou. Digi solo está en C.
const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoLeido> = [
  {
    clave: "a",
    posicion: { longitud: 2.16, latitud: 41.39 },
    estado: "verificado",
    companias: ["movistar"],
    barrio: "10",
  },
  {
    clave: "b",
    posicion: { longitud: 2.16024, latitud: 41.39 },
    estado: "corregido",
    companias: ["vodafone", "orange"],
    barrio: "10",
  },
  {
    clave: "c",
    posicion: { longitud: 2.18, latitud: 41.39 },
    estado: "verificado",
    companias: ["digi"],
    barrio: "68",
  },
];

const BARRIOS: ReadonlyArray<Barrio> = [
  { codigo: "10", nombre: "Sant Antoni", etiqueta: { longitud: 2.161, latitud: 41.391 } },
  { codigo: "68", nombre: "el Poblenou", etiqueta: { longitud: 2.181, latitud: 41.391 } },
];

/** Una proyección lineal cualquiera: basta con que dé píxeles distintos a sitios distintos. */
const proyectar = (posicion: Coordenada) => ({
  x: (posicion.longitud - 2.15) * 10_000,
  y: (41.4 - posicion.latitud) * 10_000,
});

const montar = (reducido: boolean, seleccionada: string | null = null, barrios = false) => {
  const agrupador = crearAgrupador(EMPLAZAMIENTOS, barrios ? BARRIOS : []);
  const [nivel, setNivel] = createSignal(17);
  const elegidos: Array<string> = [];
  const abiertas: Array<ElementoAbrible> = [];
  const contenedor = document.createElement("div");
  document.body.append(contenedor);
  render(() => (
    <CapaAgrupada
      contenedor={contenedor}
      combinaciones={combinacionesDe(EMPLAZAMIENTOS)}
      escena={agrupador.escena(nivel(), MUNDO, seleccionada)}
      transicion={agrupador.transicion}
      proyectar={proyectar}
      seVe={() => true}
      fotograma={0}
      movimientoReducido={reducido}
      formas={new Map()}
      seleccionada={seleccionada}
      alSeleccionar={(clave) => elegidos.push(clave)}
      alAbrir={(agrupacion) => abiertas.push(agrupacion)}
    />
  ));
  flush();
  const lamina = within(contenedor);
  /** Los marcadores que se pueden pulsar: los que no se están yendo. */
  const pulsables = () =>
    lamina.queryAllByRole("button").filter((boton) => !boton.hasAttribute("inert"));
  return { setNivel, elegidos, abiertas, lamina, pulsables };
};

describe("capa agrupada", () => {
  it("cerca, cada emplazamiento es un botón con nombre que avisa al elegirlo", () => {
    const { lamina, pulsables, elegidos } = montar(false);
    assert.lengthOf(pulsables(), 3);

    fireEvent.click(
      lamina.getByRole("button", {
        name: "Emplazamiento compartido por Vodafone y Orange, corregido",
      }),
    );
    assert.deepStrictEqual(elegidos, ["b"]);
  });

  it("al alejar los recoge en un hexágono que se nombra por su número y acerca al pulsarlo", () => {
    const { setNivel, lamina, pulsables, abiertas } = montar(false);
    setNivel(8);
    flush();

    const hexagono = lamina.getByRole("button", { name: "3 emplazamientos, acercar" });
    assert.strictEqual(hexagono.textContent, "3");
    assert.deepStrictEqual(pulsables(), [hexagono]);
    // Los tres emplazamientos siguen en el DOM mientras se deslizan hacia el hexágono.
    assert.lengthOf(lamina.getAllByRole("button", { name: /^Emplazamiento/u }), 3);

    fireEvent.click(hexagono);
    assert.lengthOf(abiertas, 1);
    const abierta = abiertas[0];
    assert.strictEqual(abierta?.tipo === "agrupacion" ? abierta.cuantos : 0, 3);

    // Al acercar de nuevo vuelven a ser pulsables.
    setNivel(17);
    flush();
    assert.lengthOf(pulsables(), 3);
    assert.isTrue(
      pulsables().every((boton) =>
        (boton.getAttribute("aria-label") ?? "").startsWith("Emplazamiento"),
      ),
    );
  });

  it("el seleccionado sigue a la vista y marcado al quedar dentro de una agrupación", () => {
    const { setNivel, lamina, pulsables } = montar(false, "b");
    setNivel(8);
    flush();

    const seleccionado = lamina.getByRole("button", { current: true });
    assert.strictEqual(
      seleccionado.getAttribute("aria-label"),
      "Emplazamiento compartido por Vodafone y Orange, corregido",
    );
    assert.sameMembers(pulsables(), [
      seleccionado,
      lamina.getByRole("button", { name: "3 emplazamientos, acercar" }),
    ]);
  });

  it("con la preferencia de reducir movimiento el cambio es directo", () => {
    const { setNivel, lamina } = montar(true);
    setNivel(8);
    flush();

    assert.lengthOf(lamina.getAllByRole("button"), 1);
    lamina.getByRole("button", { name: "3 emplazamientos, acercar" });
  });

  it("en el nivel de barrios, cada barrio dice su nombre y su número, no qué compañías faltan", () => {
    const { setNivel, lamina, pulsables, abiertas } = montar(false, null, true);
    setNivel(NIVEL_DE_BARRIOS);
    flush();

    const santAntoni = lamina.getByRole("button", {
      name: "Sant Antoni, 2 emplazamientos, acercar",
    });
    const poblenou = lamina.getByRole("button", {
      name: "el Poblenou, 1 emplazamiento, acercar",
    });
    assert.sameMembers(pulsables(), [santAntoni, poblenou]);
    // Los emplazamientos siguen en el DOM mientras se deslizan hacia su barrio.
    assert.lengthOf(lamina.getAllByRole("button", { name: /^Emplazamiento/u }), 3);

    fireEvent.click(santAntoni);
    assert.strictEqual(abiertas[0]?.tipo, "barrio");

    // Al acercar, los emplazamientos salen de su barrio.
    setNivel(17);
    flush();
    assert.lengthOf(pulsables(), 3);
  });

  it("con la preferencia de reducir movimiento, los barrios aparecen de golpe", () => {
    const { setNivel, lamina } = montar(true, null, true);
    setNivel(NIVEL_DE_BARRIOS);
    flush();
    assert.lengthOf(lamina.getAllByRole("button"), 2);
    assert.isTrue(lamina.getAllByRole("button").every((b) => b.hasAttribute("data-forma")));
  });
});

describe("capa agrupada por provincias", () => {
  /** Cerca del borde entre Barcelona y Girona. */
  const BORDE: Rectangulo = {
    suroeste: { longitud: 2.3, latitud: 41.85 },
    noreste: { longitud: 2.7, latitud: 42 },
  };
  const todas = [...BARCELONA.capa.emplazamientos, ...GIRONA.capa.emplazamientos];

  const montarNacional = (
    inicial: ReadonlyMap<string, EstadoProvincia>,
    nivel: number,
    { resumen = RESUMEN, reducido = false }: { resumen?: ResumenLeido; reducido?: boolean } = {},
  ) => {
    const [provincias, setProvincias] = createSignal(inicial);
    const [nivelActual, setNivel] = createSignal(nivel);
    const agrupador = () => crearAgrupadorNacional(resumen, provincias());
    const contenedor = document.createElement("div");
    document.body.append(contenedor);
    const abiertas: Array<ElementoAbrible> = [];
    render(() => (
      <CapaAgrupada
        contenedor={contenedor}
        combinaciones={combinacionesDe(todas)}
        escena={agrupador().escena(nivelActual(), nivelActual() < 8 ? MUNDO : BORDE, null)}
        transicion={agrupador().transicion}
        proyectar={(posicion) => ({
          x: (posicion.longitud - 2.3) * 2000,
          y: (42 - posicion.latitud) * 2000,
        })}
        seVe={() => true}
        fotograma={0}
        movimientoReducido={reducido}
        formas={new Map()}
        seleccionada={null}
        alSeleccionar={() => undefined}
        alAbrir={(elemento) => abiertas.push(elemento)}
      />
    ));
    flush();
    const lamina = within(contenedor);
    const pulsables = () =>
      lamina.queryAllByRole("button").filter((boton) => !boton.hasAttribute("inert"));
    return { setProvincias, setNivel, lamina, pulsables, abiertas };
  };

  it("una provincia que llega mientras el mapa se mueve sale de su hexágono, sin hueco", () => {
    const { setProvincias, lamina, pulsables } = montarNacional(
      estados(["08", { tipo: "cargando" }], ["17", { tipo: "lista", provincia: GIRONA }]),
      10,
    );
    // Mientras llega, se ve su hexágono con su número y dice que se está cargando.
    const hexagono = lamina.getByRole("button", {
      name: "Barcelona, 40 emplazamientos, cargando, acercar",
    });
    assert.strictEqual(hexagono.getAttribute("aria-busy"), "true");
    assert.include(hexagono.textContent, "40");
    const deGirona = pulsables().length;

    setProvincias(
      estados(
        ["08", { tipo: "lista", provincia: BARCELONA }],
        ["17", { tipo: "lista", provincia: GIRONA }],
      ),
    );
    flush();
    // El hexágono ya no se puede pulsar, y lo de Barcelona sale de donde estaba.
    assert.isFalse(pulsables().includes(hexagono));
    const nuevos = pulsables().filter(
      (b) => !(b.getAttribute("aria-label") ?? "").startsWith("Barcelona"),
    );
    assert.isAbove(nuevos.length, deGirona);
    const entrando = nuevos.filter((b) =>
      (b.firstElementChild?.getAttribute("style") ?? "").includes("--desde-x"),
    );
    assert.isAbove(entrando.length, 0);
  });

  it("una provincia sin cubrir va sin número, dice que aún no está y acerca al pulsarla", () => {
    const { lamina, abiertas } = montarNacional(estados(), 6);
    const lleida = lamina.getByRole("button", {
      name: "Lleida, Celda aún no tiene sus emplazamientos, acercar",
    });
    assert.strictEqual(lleida.getAttribute("data-cobertura"), "ninguna");
    assert.include(lleida.textContent, "aún no está");
    assert.notMatch(lleida.textContent ?? "", /\d/u);
    fireEvent.click(lleida);
    assert.strictEqual(abiertas[0]?.tipo, "provincia");

    // Las cubiertas dicen su número, y no qué compañías faltan: a Barcelona le falta Vodafone.
    const barcelona = lamina.getByRole("button", { name: "Barcelona, 40 emplazamientos, acercar" });
    assert.notMatch(barcelona.textContent ?? "", /\bsin\b/u);
  });

  it("al acercar desde el resumen, cada provincia se abre desde su hexágono", () => {
    const { setNivel, pulsables } = montarNacional(
      estados(
        ["08", { tipo: "lista", provincia: BARCELONA }],
        ["17", { tipo: "lista", provincia: GIRONA }],
      ),
      6,
    );
    assert.lengthOf(pulsables(), 3);
    setNivel(12);
    flush();
    const entrando = pulsables().filter((b) =>
      (b.firstElementChild?.getAttribute("style") ?? "").includes("--desde-x"),
    );
    assert.strictEqual(entrando.length, pulsables().length);
  });

  describe("a escala de municipio", () => {
    const resumen = resumenConBarcelona(true);
    const conMunicipios = estados(
      ["08", { tipo: "lista", provincia: barcelonaConMunicipios(resumen) }],
      ["17", { tipo: "lista", provincia: GIRONA }],
    );

    it("cada zona es un hexágono con su número y su nombre, sin decir qué compañías faltan", () => {
      const { setNivel, lamina, abiertas } = montarNacional(
        conMunicipios,
        NIVEL_DE_MUNICIPIOS - 1,
        {
          resumen,
        },
      );
      setNivel(NIVEL_DE_MUNICIPIOS);
      flush();

      const oeste = lamina.getByRole("button", {
        name: "Oeste, 20 emplazamientos, acercar",
      });
      assert.strictEqual(oeste.getAttribute("data-zona"), "municipio");
      // Se ve el hexágono con su número y el nombre debajo. Le falta Vodafone, y no lo dice.
      assert.isNotNull(oeste.querySelector("svg polygon"));
      assert.include(oeste.textContent, "20");
      assert.include(oeste.textContent, "Oeste");
      assert.notMatch(oeste.textContent ?? "", /\bsin\b/u);
      // Pequeño, con 3, no llega al mínimo de una zona: sus emplazamientos van en hexágonos.
      assert.isNull(lamina.queryByRole("button", { name: /^Pequeño/u }));

      // Es un botón de verdad: se enfoca con el teclado y acerca al pulsarlo.
      oeste.focus();
      assert.strictEqual(document.activeElement, oeste);
      fireEvent.click(oeste);
      assert.strictEqual(abiertas[0]?.tipo, "municipio");
    });

    it("al acercar desde los hexágonos, los municipios salen de ellos", () => {
      const { setNivel, lamina } = montarNacional(conMunicipios, NIVEL_DE_MUNICIPIOS - 1, {
        resumen,
      });
      setNivel(NIVEL_DE_MUNICIPIOS);
      flush();
      const municipios = lamina
        .getAllByRole("button")
        .filter((b) => b.getAttribute("data-zona") === "municipio");
      assert.lengthOf(municipios, 2);
      assert.isTrue(
        municipios.every((b) =>
          (b.firstElementChild?.getAttribute("style") ?? "").includes("--desde-x"),
        ),
      );
    });

    it("con la preferencia de reducir movimiento, los municipios aparecen de golpe", () => {
      const { setNivel, lamina } = montarNacional(conMunicipios, NIVEL_DE_MUNICIPIOS - 1, {
        resumen,
        reducido: true,
      });
      setNivel(NIVEL_DE_MUNICIPIOS);
      flush();
      const botones = lamina.getAllByRole("button");
      assert.isTrue(botones.every((b) => !b.hasAttribute("inert")));
      assert.isTrue(
        botones.every(
          (b) => !(b.firstElementChild?.getAttribute("style") ?? "").includes("--desde-x"),
        ),
      );
      assert.lengthOf(
        botones.filter((b) => b.getAttribute("data-zona") === "municipio"),
        2,
      );
    });

    it("una provincia a medias no se parte en municipios: sigue en hexágonos", () => {
      const aMedias = resumenConBarcelona(false);
      const { lamina } = montarNacional(
        estados(
          ["08", { tipo: "lista", provincia: barcelonaConMunicipios(aMedias) }],
          ["17", { tipo: "lista", provincia: GIRONA }],
        ),
        NIVEL_DE_MUNICIPIOS,
        { resumen: aMedias },
      );
      assert.lengthOf(
        lamina.getAllByRole("button").filter((b) => b.getAttribute("data-zona") === "municipio"),
        0,
      );
      assert.isAbove(
        lamina.getAllByRole("button", { name: /emplazamientos, acercar$/u }).length,
        0,
      );
    });
  });
});

describe("capa agrupada a todos los zooms", () => {
  const { resumen, provincias } = espanaDePrueba();
  const agrupador = crearAgrupadorNacional(resumen, provincias);
  const todos = [...provincias.values()].flatMap((estado) =>
    estado.tipo === "lista" ? estado.provincia.capa.emplazamientos : [],
  );
  /** Una proyección cualquiera de la península: basta con que separe lo que está separado. */
  const proyectarEspana = (posicion: Coordenada) => ({
    x: (posicion.longitud + 2) * 4000,
    y: (43 - posicion.latitud) * 4000,
  });

  const montarEspana = (nivel: number, reducido: boolean) => {
    const [actual, setNivel] = createSignal(nivel);
    const contenedor = document.createElement("div");
    document.body.append(contenedor);
    render(() => (
      <CapaAgrupada
        contenedor={contenedor}
        combinaciones={combinacionesDe(todos)}
        escena={agrupador.escena(actual(), MUNDO, null)}
        transicion={agrupador.transicion}
        proyectar={proyectarEspana}
        seVe={() => true}
        fotograma={0}
        movimientoReducido={reducido}
        formas={new Map()}
        seleccionada={null}
        alSeleccionar={() => undefined}
        alAbrir={() => undefined}
      />
    ));
    flush();
    const botones = () => within(contenedor).queryAllByRole("button");
    return { setNivel, botones };
  };

  /**
   * Cuántos emplazamientos enseña un marcador: 1 si es un logo, y si no el número de su hexágono.
   * Falla si no es ninguna de las dos cosas, como una zona que fuera solo un nombre.
   */
  const representados = (boton: HTMLElement): number => {
    const nombre = boton.getAttribute("aria-label") ?? "";
    if (boton.querySelector("svg use") !== null) return 1;
    assert.isNotNull(boton.querySelector("svg polygon"), `«${nombre}» no tiene hexágono ni logo`);
    if (boton.getAttribute("data-cobertura") === "ninguna") return 0;
    const numero = boton.querySelector("svg + span")?.textContent ?? "";
    assert.match(numero, /^\d+$/u, `«${nombre}» no enseña su número en el hexágono`);
    return Number(numero);
  };

  // Cada zoom en su prueba: montar la capa abre su latido, y el vigilante de recursos pide que
  // no se abra más de diez veces en un segundo.
  const zooms = Array.from({ length: 14 }, (_, i) => 5 + i);

  for (const zoom of zooms) {
    it(`a zoom ${zoom}, cada emplazamiento está en un hexágono con su número o en un logo`, () => {
      const { botones } = montarEspana(nivelDeZoom(zoom), true);
      const suma = botones().reduce((total, boton) => total + representados(boton), 0);
      assert.strictEqual(suma, todos.length, `zoom ${zoom}`);
    });
  }

  for (const zoom of zooms.slice(1)) {
    it(`al acercar al zoom ${zoom}, todo lo que aparece sale de algo que ya se veía`, () => {
      const { setNivel, botones } = montarEspana(nivelDeZoom(zoom - 1), false);
      setNivel(nivelDeZoom(zoom));
      flush();
      for (const boton of botones()) {
        if (boton.hasAttribute("inert")) continue;
        const estilo = boton.firstElementChild?.getAttribute("style") ?? "";
        // Sin origen, crece en su sitio con escala 0,55; desde otro, sale con 0,3.
        assert.notInclude(
          estilo,
          "--desde-escala: 0.55",
          `«${boton.getAttribute("aria-label") ?? ""}» aparece de la nada`,
        );
      }
    });

    it(`al alejar desde el zoom ${zoom}, todo lo que se va se desliza a algo que se queda`, () => {
      const { setNivel, botones } = montarEspana(nivelDeZoom(zoom), false);
      setNivel(nivelDeZoom(zoom - 1));
      flush();
      for (const boton of botones()) {
        if (!boton.hasAttribute("inert")) continue;
        const estilo = boton.firstElementChild?.getAttribute("style") ?? "";
        assert.notInclude(
          estilo,
          "scale(0.55)",
          `«${boton.getAttribute("aria-label") ?? ""}» se apaga sin destino`,
        );
      }
    });
  }
});
