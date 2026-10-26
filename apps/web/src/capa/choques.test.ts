import type { Coordenada } from "@celda/dominio/area";
import { centroVisual } from "@celda/dominio/centroVisual";
import { assert, describe, it } from "@effect/vitest";

import type {
  Elemento,
  ElementoAgrupacion,
  ElementoBarrio,
  ElementoMunicipio,
  ElementoProvincia,
} from "./agrupacion.ts";
import {
  cajaDeMarcador,
  cajaDeRotulo,
  HOLGURA_DE_CINTA,
  huecosDe,
  resolverChoques,
  type RotuloEnElMapa,
  sePisan,
  tamanoDeNivel,
} from "./choques.ts";
import { nombreDeBarrio, nombreDeMunicipio } from "./marcadores.ts";

/** Una proyección de prueba: la longitud es la x en píxeles y la latitud, la y. */
const plana = (posicion: Coordenada) => ({ x: posicion.longitud, y: posicion.latitud });
const en = (x: number, y = 100): Coordenada => ({ longitud: x, latitud: y });

const barrio = (codigo: string, x: number, emplazamientos: number): ElementoBarrio => ({
  tipo: "barrio",
  clave: `b:${codigo}`,
  posicion: en(x),
  resumen: {
    barrio: { codigo, nombre: `Barrio ${codigo}`, etiqueta: en(x) },
    emplazamientos,
  },
});

const municipio = (
  codigo: string,
  nombre: string,
  posicion: Coordenada,
  habitantes: number,
): ElementoMunicipio => ({
  tipo: "municipio",
  clave: `m:${codigo}`,
  posicion,
  resumen: {
    municipio: {
      codigo,
      nombre,
      etiqueta: posicion,
      habitantes,
      areaKm2: 10,
      emplazamientos: 20,
      companias: [],
    },
    emplazamientos: 20,
    caja: undefined,
  },
});

const agrupacion = (clave: string, posicion: Coordenada): ElementoAgrupacion => ({
  tipo: "agrupacion",
  clave,
  posicion,
  cuantos: 12,
});

const provincia = (codigo: string, nombre: string, posicion: Coordenada): ElementoProvincia => ({
  tipo: "provincia",
  clave: `p:${codigo}`,
  posicion,
  provincia: {
    codigo,
    nombre,
    etiqueta: posicion,
    caja: undefined,
    emplazamientos: 100,
    companias: [],
    cubierta: true,
    barrido: null,
    fichero: undefined,
    combinaciones: new Map(),
  },
  carga: "resumen",
  cuantos: 100,
  deLaRed: 0,
});

const rotulo = (texto: string, posicion: Coordenada, habitantes: number): RotuloEnElMapa => ({
  clave: `lugares-grandes:${texto}`,
  texto,
  posicion,
  tamano: 13,
  habitantes,
});

const resolver = (
  elementos: ReadonlyArray<Elemento>,
  rotulos: ReadonlyArray<RotuloEnElMapa> = [],
  tamano = tamanoDeNivel(13),
) => resolverChoques({ elementos, rotulos, proyectar: plana, tamano });

describe("tamaño de los hexágonos por zoom", () => {
  it("0,62 por debajo del 9, 0,8 en el 9 y el 10, 0,88 en el 11 y el 12, y entero desde el 13", () => {
    assert.deepStrictEqual([5, 8, 9, 10, 11, 12, 13, 17].map(tamanoDeNivel), [
      "lejos",
      "lejos",
      "medio",
      "medio",
      "cerca",
      "cerca",
      "normal",
      "normal",
    ]);
  });

  it("las cajas encogen con el hexágono, pero la de un logo no", () => {
    const logo: Elemento = {
      tipo: "emplazamiento",
      clave: "e:1",
      posicion: en(0),
      emplazamiento: {
        clave: "1",
        posicion: en(0),
        estado: "verificado",
        companias: ["movistar"],
        barrio: null,
        lote: 0,
        provincia: "08",
        municipio: null,
      },
    };
    assert.deepStrictEqual(cajaDeMarcador(logo, "compacta", "lejos"), {
      izquierda: -22,
      arriba: -22,
      derecha: 22,
      abajo: 22,
    });
    const hexagono = cajaDeMarcador(agrupacion("a:1", en(0)), "compacta", "lejos");
    assert.closeTo(hexagono.derecha, 25 * 0.62, 1e-9);
    assert.closeTo(hexagono.abajo, 28 * 0.62, 1e-9);
  });
});

describe("regla de choques", () => {
  it("1: las agrupaciones no ceden nunca: el rótulo que las pisa no sale, aunque sea Madrid", () => {
    const { rotulosOcultos } = resolver(
      [agrupacion("a:1", en(100))],
      [rotulo("Madrid", en(110), 3_400_000)],
    );
    assert.isTrue(rotulosOcultos.has("lugares-grandes:Madrid"));
  });

  it("1: ni ante un hexágono de zona: la zona que pisa una agrupación no se dibuja", () => {
    const { ocultos } = resolver([
      agrupacion("a:1", en(100)),
      municipio("08019", "Barcelona", en(120), 1_660_000),
    ]);
    assert.isTrue(ocultos.has("m:08019"));
  });

  it("2: entre un hexágono de zona y un rótulo, gana el de más habitantes", () => {
    const zona = municipio("08279", "Terrassa", en(100), 230_000);
    const grande = resolver([zona], [rotulo("Sabadell", en(110), 220_000)]);
    assert.isFalse(grande.ocultos.has("m:08279"));
    assert.isTrue(grande.rotulosOcultos.has("lugares-grandes:Sabadell"));
    const pequena = resolver([zona], [rotulo("Barcelona", en(110), 1_660_000)]);
    assert.isTrue(pequena.ocultos.has("m:08279"));
    assert.isFalse(pequena.rotulosOcultos.has("lugares-grandes:Barcelona"));
  });

  it("2: un rótulo que no casa con ningún municipio cuenta 0 y cede ante cualquier zona", () => {
    const { rotulosOcultos } = resolver(
      [municipio("17001", "Pueblo", en(100), 300)],
      [rotulo("Perpignan", en(105), 0)],
    );
    assert.isTrue(rotulosOcultos.has("lugares-grandes:Perpignan"));
  });

  it("3: la cinta gana a los rótulos con menos habitantes que su zona y los esconde", () => {
    // El rótulo cae 40 px debajo del hexágono, donde va la cinta, sin tocar el hexágono.
    const { formas, rotulosOcultos } = resolver(
      [municipio("08279", "Terrassa", en(100), 230_000)],
      [rotulo("Matadepera", en(100, 145), 9000)],
    );
    assert.strictEqual(formas.get("m:08279"), "completa");
    assert.isTrue(rotulosOcultos.has("lugares-grandes:Matadepera"));
  });

  it("3: ante un rótulo con más habitantes, la zona va compacta y el rótulo se queda", () => {
    const { formas, ocultos, rotulosOcultos } = resolver(
      [municipio("08184", "Rubí", en(100), 80_000)],
      [rotulo("Terrassa", en(100, 145), 230_000)],
    );
    assert.strictEqual(formas.get("m:08184"), "compacta");
    assert.isFalse(ocultos.has("m:08184"));
    assert.isFalse(rotulosOcultos.has("lugares-grandes:Terrassa"));
  });

  it("3: las cintas van al final y nunca esconden un hexágono: la zona va compacta", () => {
    // Badalona, con más habitantes, va primero; su cinta pisaría el hexágono de Montgat.
    const badalona = municipio("08015", "Badalona", en(100), 220_000);
    const montgat = municipio("08125", "Montgat", en(100, 160), 12_000);
    const { formas, ocultos } = resolver([badalona, montgat]);
    assert.isFalse(ocultos.has("m:08125"));
    assert.strictEqual(formas.get("m:08015"), "compacta");
    assert.strictEqual(formas.get("m:08125"), "completa");
  });

  it("nada se aparta de su sitio: las formas y lo que no sale no dependen del orden", () => {
    const elementos = [
      municipio("08015", "Badalona", en(100), 220_000),
      municipio("08125", "Montgat", en(100, 160), 12_000),
      agrupacion("a:1", en(300)),
    ];
    const rotulos = [rotulo("Barcelona", en(140, 60), 1_660_000)];
    assert.deepStrictEqual(resolver(elementos.toReversed(), rotulos), resolver(elementos, rotulos));
  });

  it("un rótulo que no cabe entero en la pantalla no sale: cortado no se lee", () => {
    const pantalla = { ancho: 390, alto: 844 };
    const palmas = rotulo("Las Palmas de Gran Canaria", en(330), 380_000);
    const { rotulosOcultos } = resolverChoques({
      elementos: [],
      rotulos: [palmas, rotulo("Telde", en(200), 100_000)],
      proyectar: plana,
      tamano: "lejos",
      pantalla,
    });
    assert.deepStrictEqual([...rotulosOcultos], ["lugares-grandes:Las Palmas de Gran Canaria"]);
  });
});

describe("el rótulo de una capital y la cinta de su provincia", () => {
  it("salen los dos aunque se llamen igual: «VALÈNCIA» en la cinta y «València» en la ciudad", () => {
    // El hexágono de la provincia va en su centro visual, a unos 40 km de la ciudad: a z8, más de
    // 150 px.
    const { formas, ocultos, rotulosOcultos } = resolver(
      [provincia("46", "València", en(100))],
      [rotulo("València", en(260, 110), 800_000)],
      tamanoDeNivel(8),
    );
    assert.strictEqual(formas.get("p:46"), "completa");
    assert.isFalse(ocultos.has("p:46"));
    assert.isFalse(rotulosOcultos.has("lugares-grandes:València"));
  });

  it("si se pisan, no hay regla aparte: la provincia tiene más habitantes y su cinta gana", () => {
    const { formas, rotulosOcultos } = resolver(
      [provincia("46", "València", en(100))],
      [rotulo("València", en(100, 132), 800_000)],
      tamanoDeNivel(8),
    );
    assert.strictEqual(formas.get("p:46"), "completa");
    assert.isTrue(rotulosOcultos.has("lugares-grandes:València"));
  });
});

describe("las provincias de la meseta a z5,5, en su centro visual", () => {
  /** La proyección del mapa a z5,5, con teselas de 512 px. */
  const mercator = ({ longitud, latitud }: Coordenada) => {
    const mundo = 512 * 2 ** 5.5;
    const seno = Math.sin((latitud * Math.PI) / 180);
    return {
      x: ((longitud + 180) / 360) * mundo,
      y: (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)) * mundo,
    };
  };
  const NOMBRES: ReadonlyArray<readonly [string, string]> = [
    ["05", "Ávila"],
    ["09", "Burgos"],
    ["16", "Cuenca"],
    ["19", "Guadalajara"],
    ["28", "Madrid"],
    ["34", "Palencia"],
    ["37", "Salamanca"],
    ["40", "Segovia"],
    ["42", "Soria"],
    ["45", "Toledo"],
    ["47", "Valladolid"],
    ["49", "Zamora"],
  ];
  const provincias = NOMBRES.map(([codigo, nombre]) =>
    provincia(codigo, nombre, centroVisual(codigo) ?? en(0)),
  );
  const choques = resolverChoques({
    elementos: provincias,
    rotulos: [],
    proyectar: mercator,
    tamano: tamanoDeNivel(5),
  });
  const caja = (codigo: string, forma: "completa" | "compacta") => {
    const elemento = provincias.find((p) => p.provincia.codigo === codigo);
    const { x, y } = mercator(elemento?.posicion ?? en(0));
    const relativa = cajaDeMarcador(
      elemento ?? provincias[0] ?? provincia("", "", en(0)),
      forma,
      "lejos",
    );
    return {
      izquierda: x + relativa.izquierda,
      arriba: y + relativa.arriba,
      derecha: x + relativa.derecha,
      abajo: y + relativa.abajo,
    };
  };

  it("la cinta de Valladolid no pisa el hexágono de Segovia", () => {
    assert.isFalse(choques.ocultos.has("p:40"));
    if (choques.formas.get("p:47") === "completa") {
      assert.isFalse(sePisan(caja("47", "completa"), caja("40", "compacta"), HOLGURA_DE_CINTA));
    }
  });

  it("Madrid conserva su cinta, con los 3 px de holgura", () => {
    assert.strictEqual(choques.formas.get("p:28"), "completa");
    assert.strictEqual(HOLGURA_DE_CINTA, 3);
  });

  it("ninguna provincia de la meseta se queda sin hexágono", () => {
    assert.strictEqual(choques.ocultos.size, 0);
  });
});

describe("huecos de los marcadores en el mapa base", () => {
  it("cada marcador que se dibuja deja su caja desde lo alto del hexágono; los que ceden, nada", () => {
    const zona = municipio("08279", "Terrassa", en(100), 230_000);
    const tapada = municipio("08184", "Rubí", en(105), 80_000);
    const choques = resolver([zona, tapada], [], "lejos");
    const huecos = huecosDe([zona, tapada], choques, "lejos");
    assert.lengthOf(huecos, 1);
    const [hueco] = huecos;
    assert.strictEqual(hueco?.escala, 0.62);
    const completa = cajaDeMarcador(zona, "completa", "lejos");
    assert.closeTo(hueco?.alto ?? 0, completa.abajo - completa.arriba, 1e-9);
  });
});

describe("forma de las zonas de barrio", () => {
  const formasDeBarrios = (barrios: ReadonlyArray<ElementoBarrio>) => resolver(barrios).formas;

  it("las que caben sin pisarse van completas", () => {
    const formas = formasDeBarrios([barrio("01", 0, 5), barrio("02", 400, 3)]);
    assert.deepStrictEqual(
      [...formas],
      [
        ["b:01", "completa"],
        ["b:02", "completa"],
      ],
    );
  });

  it("si dos se pisan, la del barrio con más emplazamientos va completa y la otra, compacta", () => {
    // A 80 px las cintas se pisan, pero ninguna llega al hexágono de al lado.
    const formas = formasDeBarrios([
      barrio("01", 0, 5),
      barrio("02", 80, 30),
      barrio("03", 160, 1),
    ]);
    assert.strictEqual(formas.get("b:02"), "completa");
    assert.strictEqual(formas.get("b:01"), "compacta");
    assert.strictEqual(formas.get("b:03"), "compacta");
  });

  it("ningún barrio se queda sin dibujar, aunque su forma compacta pise otra", () => {
    const encima = [barrio("01", 0, 5), barrio("02", 1, 5), barrio("03", 2, 5)];
    const { formas, ocultos } = resolver(encima);
    assert.strictEqual(formas.size, 3);
    assert.strictEqual(ocultos.size, 0);
    // A igualdad de emplazamientos, manda el código: la forma no baila de una vez a otra.
    assert.deepStrictEqual(formasDeBarrios(encima.toReversed()), formas);
  });

  it("el nombre no tapa una agrupación: si la pisaría, va compacta", () => {
    const { formas } = resolver([barrio("01", 0, 5), agrupacion("a:1", en(0, 160))]);
    assert.strictEqual(formas.get("b:01"), "compacta");
    assert.isFalse(formas.has("a:1"));
    const lejos = resolver([barrio("01", 0, 5), agrupacion("a:1", en(300))]);
    assert.strictEqual(lejos.formas.get("b:01"), "completa");
  });

  it("y cede ante un rótulo de ciudad: un barrio no tiene habitantes con que competir", () => {
    const rotulos = [rotulo("Barcelona", en(0, 150), 1_660_000)];
    assert.strictEqual(resolver([barrio("01", 0, 5)], rotulos).formas.get("b:01"), "compacta");
  });
});

describe("nombre accesible de una zona", () => {
  it("dice lo que se ve en la etiqueta y qué hace al pulsarla", () => {
    assert.strictEqual(
      nombreDeBarrio(barrio("07", 0, 94).resumen),
      "Barrio 07, 94 emplazamientos, acercar",
    );
    assert.strictEqual(
      nombreDeMunicipio(municipio("08279", "Terrassa", en(0), 230_000).resumen),
      "Terrassa, 20 emplazamientos, acercar",
    );
  });
});

describe("la caja de un rótulo", () => {
  it("crece con el texto y la letra, centrada en su punto", () => {
    const corto = cajaDeRotulo(rotulo("Vic", en(0), 0), { x: 100, y: 50 });
    const largo = cajaDeRotulo(rotulo("Las Palmas de Gran Canaria", en(0), 0), { x: 100, y: 50 });
    assert.strictEqual(corto.derecha - 100, 100 - corto.izquierda);
    assert.isAbove(largo.derecha - largo.izquierda, 8 * (corto.derecha - corto.izquierda) - 40);
    assert.closeTo(corto.abajo - corto.arriba, 13 * 1.15, 1e-9);
  });
});

describe("la red que usa una compañía del filtro (ADR 0026)", () => {
  const deLaRed = (clave: string, x: number): ElementoAgrupacion => ({
    ...agrupacion(clave, en(x)),
    redUsada: true,
  });

  it("cede ante todo lo demás: lo suyo, las zonas y los rótulos", () => {
    const { ocultos } = resolverChoques({
      elementos: [deLaRed("a:08r:1", 100), agrupacion("a:08:1", en(110)), deLaRed("a:08r:2", 400)],
      rotulos: [rotulo("Badalona", en(700), 220_000)],
      proyectar: plana,
      tamano: "normal",
    });
    assert.deepStrictEqual([...ocultos], ["a:08r:1"]);
    const conRotulo = resolverChoques({
      elementos: [deLaRed("a:08r:3", 700)],
      rotulos: [rotulo("Badalona", en(700), 220_000)],
      proyectar: plana,
      tamano: "normal",
    });
    assert.deepStrictEqual([...conRotulo.ocultos], ["a:08r:3"]);
    assert.deepStrictEqual([...conRotulo.rotulosOcultos], []);
  });

  it("el emplazamiento seleccionado no cede, aunque sea de la red usada", () => {
    const seleccionado: Elemento = {
      tipo: "emplazamiento",
      clave: "e:movistar-1",
      posicion: en(100),
      emplazamiento: {
        clave: "movistar-1",
        posicion: en(100),
        estado: "verificado",
        companias: ["movistar"],
        barrio: null,
        lote: 0,
        provincia: "08",
        municipio: null,
      },
      redUsada: true,
    };
    const { ocultos } = resolverChoques({
      elementos: [seleccionado, agrupacion("a:08:1", en(110))],
      rotulos: [],
      proyectar: plana,
      tamano: "normal",
      seleccionada: "movistar-1",
    });
    assert.deepStrictEqual([...ocultos], []);
  });
});
