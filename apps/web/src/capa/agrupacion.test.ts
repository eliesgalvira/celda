import type { Rectangulo } from "@celda/dominio/area";
import type { Barrio } from "@celda/dominio/barrio";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { MunicipioDeCapa } from "@celda/dominio/provincias";
import { resumirMunicipios, UMBRAL_DE_AUSENCIAS } from "@celda/dominio/zona";
import { assert, describe, it } from "@effect/vitest";

import {
  type Agrupador,
  crearAgrupador,
  type Elemento,
  type ElementoAgrupacion,
  type ElementoBarrio,
  type ElementoMunicipio,
  type Escena,
  esNivelDeMunicipios,
  NIVEL_DE_BARRIOS,
  NIVEL_DE_MUNICIPIOS,
  nivelDeZoom,
} from "./agrupacion.ts";
import {
  type Indice,
  type IndiceSerializado,
  indexarCapa,
  indicesDeCapa,
  rehidratarIndice,
  serializarIndice,
} from "./indice.ts";

const MUNDO: Rectangulo = {
  suroeste: { longitud: -180, latitud: -85 },
  noreste: { longitud: 180, latitud: 85 },
};

const en = (clave: string, longitud: number, latitud: number): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
  barrio: null,
});

/** Generador pseudoaleatorio con semilla (mulberry32): las pruebas dan siempre lo mismo. */
const azar = (semilla: number) => {
  let a = semilla;
  return (): number => {
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * 600 emplazamientos sintéticos por Barcelona: la mitad repartidos por el área y la otra mitad en
 * tres núcleos densos, como el Eixample, donde hay agrupaciones a casi todos los niveles.
 */
const SINTETICOS: ReadonlyArray<EmplazamientoLeido> = (() => {
  const r = azar(13);
  const nucleos = [
    [2.165, 41.392],
    [2.13, 41.38],
    [2.19, 41.41],
  ] as const;
  return Array.from({ length: 600 }, (_, i) => {
    const [lon, lat] = nucleos[i % 3] ?? nucleos[0];
    return i < 300
      ? en(`s${i}`, 2.05 + r() * 0.2, 41.32 + r() * 0.15)
      : en(`s${i}`, lon + (r() - 0.5) * 0.01, lat + (r() - 0.5) * 0.008);
  });
})();

const claves = (agrupador: Agrupador, elemento: Elemento): ReadonlyArray<string> =>
  agrupador.emplazamientosDe(elemento).map((e) => e.clave);

/** Si todos los emplazamientos de `parte` están en `todo`. */
const contiene = (agrupador: Agrupador, todo: Elemento, parte: Elemento): boolean => {
  const deTodo = new Set(claves(agrupador, todo));
  return claves(agrupador, parte).every((clave) => deTodo.has(clave));
};

const elemento = (escena: Escena, clave: string): Elemento => {
  const encontrado = escena.elementos.get(clave);
  assert.isDefined(encontrado, `falta ${clave} en el nivel ${escena.nivel}`);
  // SAFETY: la aserción anterior descarta undefined.
  return encontrado as Elemento;
};

const agrupacionesDe = (escena: Escena): ReadonlyArray<ElementoAgrupacion> =>
  [...escena.elementos.values()].filter((e) => e.tipo === "agrupacion");

describe("agrupación por zoom", () => {
  const agrupador = crearAgrupador(SINTETICOS);

  it("a cada nivel, cada emplazamiento está en un solo elemento y cada número cuadra", () => {
    for (let nivel = 0; nivel <= 18; nivel++) {
      const escena = agrupador.escena(nivel, MUNDO);
      const vistos = new Set<string>();
      let suma = 0;
      for (const e of escena.elementos.values()) {
        const suyos = claves(agrupador, e);
        if (e.tipo === "agrupacion") {
          assert.strictEqual(e.cuantos, suyos.length, `número de ${e.clave} en el nivel ${nivel}`);
          assert.isAtLeast(e.cuantos, 2);
          suma += e.cuantos;
        } else {
          suma += 1;
        }
        for (const clave of suyos) {
          assert.isFalse(vistos.has(clave), `${clave} contado dos veces en el nivel ${nivel}`);
          vistos.add(clave);
        }
      }
      assert.strictEqual(suma, SINTETICOS.length, `suma de números en el nivel ${nivel}`);
      assert.strictEqual(vistos.size, SINTETICOS.length, `emplazamientos en el nivel ${nivel}`);
    }
  });

  it("cerca van todos sueltos y lejos se agrupan", () => {
    const cerca = agrupador.escena(nivelDeZoom(18.5), MUNDO);
    assert.strictEqual(cerca.elementos.size, SINTETICOS.length);
    assert.lengthOf(agrupacionesDe(cerca), 0);

    const lejos = agrupador.escena(nivelDeZoom(11.4), MUNDO);
    assert.isBelow(lejos.elementos.size, SINTETICOS.length / 4);
    assert.isAbove(agrupacionesDe(lejos).length, 0);
  });

  it("el nivel es la parte entera del zoom, hasta el primero sin agrupaciones", () => {
    assert.strictEqual(nivelDeZoom(13.99), 13);
    assert.strictEqual(nivelDeZoom(14), 14);
    assert.strictEqual(nivelDeZoom(18.5), 17);
  });

  /** Comprueba la transición entre dos niveles contra lo que recoge cada elemento. */
  const comprobarSalto = (fino: number, grueso: number) => {
    const escenaFina = agrupador.escena(fino, MUNDO);
    const escenaGruesa = agrupador.escena(grueso, MUNDO);

    // Al alejar, lo que desaparece va a la agrupación que lo recoge.
    const alejar = agrupador.transicion(escenaFina, escenaGruesa);
    assert.strictEqual(alejar.origen.size, 0);
    for (const e of escenaFina.elementos.values()) {
      const destino = alejar.destino.get(e.clave);
      if (escenaGruesa.elementos.has(e.clave)) {
        assert.isUndefined(destino, `${e.clave} sigue en el nivel ${grueso} y no se mueve`);
        continue;
      }
      assert.isDefined(destino, `${e.clave} desaparece de ${fino} a ${grueso} sin destino`);
      const grupo = elemento(escenaGruesa, destino ?? "");
      assert.strictEqual(grupo.tipo, "agrupacion");
      assert.isTrue(contiene(agrupador, grupo, e), `${e.clave} no está en ${grupo.clave}`);
    }

    // Al acercar, lo que aparece sale de la agrupación en que estaba.
    const acercar = agrupador.transicion(escenaGruesa, escenaFina);
    assert.strictEqual(acercar.destino.size, 0);
    assert.deepStrictEqual([...acercar.origen].toSorted(), [...alejar.destino].toSorted());
  };

  it("al alejar un nivel cada elemento va a su agrupación, y al acercar sale de ella", () => {
    for (let nivel = 17; nivel >= 1; nivel--) comprobarSalto(nivel, nivel - 1);
  });

  it("en un salto de varios niveles cada elemento va directo a su agrupación final", () => {
    comprobarSalto(17, 12);
    comprobarSalto(15, 10);
    comprobarSalto(16, 3);
  });

  it("al mismo nivel no hay transición", () => {
    const escena = agrupador.escena(13, MUNDO);
    const t = agrupador.transicion(escena, agrupador.escena(13, MUNDO));
    assert.strictEqual(t.destino.size + t.origen.size, 0);
  });

  it("entre escenas de dos capas distintas no hay transición", () => {
    const otra = crearAgrupador(SINTETICOS.slice(0, 200)).escena(12, MUNDO);
    const t = agrupador.transicion(otra, agrupador.escena(11, MUNDO));
    assert.strictEqual(t.destino.size + t.origen.size, 0);
  });
});

describe("una agrupación que ya existía en el nivel fino", () => {
  // A y B están a 20 m: se agrupan ya en el último nivel con agrupaciones. C está a 1,7 km y solo
  // se une a ellas mucho más lejos. Al saltar del nivel 16 al 8, la agrupación de A y B va entera
  // a la de los tres: no se abre en A y B, porque en el nivel 16 ya existía.
  const A = en("a", 2.16, 41.39);
  const B = en("b", 2.16024, 41.39);
  const C = en("c", 2.18, 41.39);
  const agrupador = crearAgrupador([A, B, C]);

  const unica = (escena: Escena, cuantos: number): ElementoAgrupacion => {
    const [grupo, ...resto] = agrupacionesDe(escena);
    assert.lengthOf(resto, 0);
    assert.isDefined(grupo);
    // SAFETY: la aserción anterior descarta undefined.
    const encontrado = grupo as ElementoAgrupacion;
    assert.strictEqual(encontrado.cuantos, cuantos);
    return encontrado;
  };

  it("se desliza entera hacia la agrupación nueva, y al acercar sale de ella", () => {
    const fina = agrupador.escena(16, MUNDO);
    const gruesa = agrupador.escena(8, MUNDO);
    const ab = unica(fina, 2);
    const abc = unica(gruesa, 3);
    assert.strictEqual(gruesa.elementos.size, 1);

    const alejar = agrupador.transicion(fina, gruesa);
    assert.deepStrictEqual(
      alejar.destino,
      new Map([
        [ab.clave, abc.clave],
        ["e:c", abc.clave],
      ]),
    );
    const acercar = agrupador.transicion(gruesa, fina);
    assert.deepStrictEqual(acercar.origen, alejar.destino);
  });

  it("pulsarla acerca justo hasta el zoom en que se abre", () => {
    const abc = unica(agrupador.escena(8, MUNDO), 3);
    const zoom = agrupador.zoomDeApertura(abc);
    assert.isTrue(agrupador.escena(zoom - 1, MUNDO).elementos.has(abc.clave));
    const abierta = agrupador.escena(zoom, MUNDO);
    assert.isFalse(abierta.elementos.has(abc.clave));
    assert.strictEqual(abierta.elementos.size, 2);
    assert.isTrue(abierta.elementos.has("e:c"));
  });

  it("el seleccionado se ve suelto aunque su agrupación lo siga contando", () => {
    const lejos = agrupador.escena(8, MUNDO, "a");
    const abc = unica(lejos, 3);
    assert.deepStrictEqual([...lejos.elementos.keys()].toSorted(), [abc.clave, "e:a"].toSorted());
    // Al acercar sigue en su sitio: no sale de ninguna agrupación.
    const cerca = agrupador.escena(17, MUNDO, "a");
    assert.isFalse(agrupador.transicion(lejos, cerca).origen.has("e:a"));
    // Sin selección, o si cae fuera de la caja, no se añade nada.
    assert.strictEqual(agrupador.escena(8, MUNDO, null).elementos.size, 1);
    const lejosDeA: Rectangulo = {
      suroeste: { longitud: 2.17, latitud: 41.38 },
      noreste: { longitud: 2.19, latitud: 41.4 },
    };
    assert.isFalse(agrupador.escena(17, lejosDeA, "a").elementos.has("e:a"));
  });

  it("solo dibuja lo que cae en la caja", () => {
    const caja: Rectangulo = {
      suroeste: { longitud: 2.17, latitud: 41.38 },
      noreste: { longitud: 2.19, latitud: 41.4 },
    };
    assert.deepStrictEqual([...agrupador.escena(17, caja).elementos.keys()], ["e:c"]);
  });
});

/**
 * Al alejar de `fino` a `grueso`, en un salto que entra o sale de un nivel de zonas, cada elemento
 * que desaparece va al que recoge más emplazamientos suyos; al acercar, sale de ese mismo. Una
 * zona sin emplazamientos se apaga en su sitio.
 */
const comprobarSaltoDeZonas = (agrupador: Agrupador, fino: number, grueso: number) => {
  /** Los emplazamientos de `parte` que también están en `todo`. */
  const enComun = (todo: Elemento, parte: Elemento): number => {
    const deTodo = new Set(claves(agrupador, todo));
    return claves(agrupador, parte).filter((clave) => deTodo.has(clave)).length;
  };
  const escenaFina = agrupador.escena(fino, MUNDO);
  const escenaGruesa = agrupador.escena(grueso, MUNDO);
  const alejar = agrupador.transicion(escenaFina, escenaGruesa);
  assert.strictEqual(alejar.origen.size, 0);
  for (const e of escenaFina.elementos.values()) {
    if (escenaGruesa.elementos.has(e.clave)) continue;
    const destino = alejar.destino.get(e.clave);
    if (claves(agrupador, e).length === 0) {
      assert.isUndefined(destino, `${e.clave} no tiene emplazamientos y se apaga en su sitio`);
      continue;
    }
    assert.isDefined(destino, `${e.clave} desaparece de ${fino} a ${grueso} sin destino`);
    const suyo = elemento(escenaGruesa, destino ?? "");
    for (const otro of escenaGruesa.elementos.values()) {
      assert.isAtLeast(enComun(suyo, e), enComun(otro, e), `${e.clave} va a ${suyo.clave}`);
    }
  }
  const acercar = agrupador.transicion(escenaGruesa, escenaFina);
  assert.strictEqual(acercar.destino.size, 0);
  assert.deepStrictEqual([...acercar.origen].toSorted(), [...alejar.destino].toSorted());
};

describe("nivel de barrios", () => {
  // Tres barrios por franjas de longitud, al norte de 41,36°, y un cuarto sin emplazamientos. Lo
  // que queda al sur es «fuera de Barcelona». Los emplazamientos pares son de Movistar y los
  // impares de Vodafone, salvo en el barrio 03, donde solo hay de Movistar.
  const barrioDe = (longitud: number, latitud: number): string | null => {
    if (latitud < 41.36) return null;
    if (longitud < 2.12) return "01";
    return longitud < 2.17 ? "02" : "03";
  };
  const CON_BARRIO: ReadonlyArray<EmplazamientoLeido> = SINTETICOS.map((e, i) => {
    const barrio = barrioDe(e.posicion.longitud, e.posicion.latitud);
    return {
      ...e,
      barrio,
      companias: barrio === "03" || i % 2 === 0 ? ["movistar"] : ["vodafone"],
    };
  });
  const BARRIOS: ReadonlyArray<Barrio> = [
    { codigo: "01", nombre: "Oeste", etiqueta: { longitud: 2.09, latitud: 41.4 } },
    { codigo: "02", nombre: "Centro", etiqueta: { longitud: 2.145, latitud: 41.4 } },
    { codigo: "03", nombre: "Este", etiqueta: { longitud: 2.2, latitud: 41.42 } },
    { codigo: "04", nombre: "Vacío", etiqueta: { longitud: 2.3, latitud: 41.45 } },
  ];
  const agrupador = crearAgrupador(CON_BARRIO, BARRIOS);
  const sinBarrios = crearAgrupador(CON_BARRIO);

  const barriosDe = (escena: Escena): ReadonlyArray<ElementoBarrio> =>
    [...escena.elementos.values()].filter((e) => e.tipo === "barrio");

  it("cada emplazamiento de Barcelona va en su barrio y los de fuera, en hexágonos", () => {
    const escena = agrupador.escena(NIVEL_DE_BARRIOS, MUNDO);
    const barrios = barriosDe(escena);
    assert.deepStrictEqual(
      barrios.map((b) => b.resumen.barrio.codigo),
      ["01", "02", "03", "04"],
    );
    let suma = 0;
    for (const e of escena.elementos.values()) {
      const suyos = agrupador.emplazamientosDe(e);
      if (e.tipo === "barrio") {
        assert.strictEqual(e.resumen.emplazamientos, suyos.length);
        assert.isTrue(suyos.every((s) => s.barrio === e.resumen.barrio.codigo));
        suma += e.resumen.emplazamientos;
      } else {
        assert.isTrue(
          suyos.every((s) => s.barrio === null),
          `${e.clave} mezcla barrios`,
        );
        suma += suyos.length;
      }
    }
    assert.strictEqual(suma, CON_BARRIO.length);
    assert.isAbove(escena.elementos.size, barrios.length, "hay emplazamientos fuera de Barcelona");
  });

  it("cada barrio dice sus ausencias, y el vacío las tiene todas", () => {
    const porCodigo = new Map(
      barriosDe(agrupador.escena(NIVEL_DE_BARRIOS, MUNDO)).map((b) => [
        b.resumen.barrio.codigo,
        b.resumen,
      ]),
    );
    assert.deepStrictEqual(porCodigo.get("02")?.ausentes, []);
    assert.deepStrictEqual(porCodigo.get("03")?.ausentes, ["vodafone"]);
    assert.strictEqual(porCodigo.get("04")?.emplazamientos, 0);
    assert.deepStrictEqual(porCodigo.get("04")?.ausentes, ["movistar", "vodafone"]);
  });

  it("fuera del nivel de barrios, la agrupación es la de siempre", () => {
    for (const nivel of [NIVEL_DE_BARRIOS - 1, NIVEL_DE_BARRIOS + 1]) {
      assert.deepStrictEqual(
        [...agrupador.escena(nivel, MUNDO).elementos.keys()],
        [...sinBarrios.escena(nivel, MUNDO).elementos.keys()],
      );
    }
    assert.lengthOf(barriosDe(sinBarrios.escena(NIVEL_DE_BARRIOS, MUNDO)), 0);
  });

  const comprobarSalto = (fino: number, grueso: number) =>
    comprobarSaltoDeZonas(agrupador, fino, grueso);

  it("al alejar hasta los barrios, cada hexágono va al barrio que recoge la mayoría de los suyos", () => {
    comprobarSalto(NIVEL_DE_BARRIOS + 1, NIVEL_DE_BARRIOS);
    comprobarSalto(17, NIVEL_DE_BARRIOS);
  });

  it("al alejar desde los barrios, cada barrio va al hexágono que recoge la mayoría de los suyos", () => {
    comprobarSalto(NIVEL_DE_BARRIOS, NIVEL_DE_BARRIOS - 1);
    comprobarSalto(NIVEL_DE_BARRIOS, 9);
  });

  it("pulsar un barrio acerca hasta el primer nivel sin barrios", () => {
    const centro = barriosDe(agrupador.escena(NIVEL_DE_BARRIOS, MUNDO)).find(
      (b) => b.resumen.barrio.codigo === "02",
    );
    assert.isDefined(centro);
    if (centro === undefined) return;
    const zoom = agrupador.zoomDeApertura(centro);
    assert.strictEqual(zoom, NIVEL_DE_BARRIOS + 1);
    assert.lengthOf(barriosDe(agrupador.escena(nivelDeZoom(zoom), MUNDO)), 0);
  });

  it("el seleccionado se ve suelto y su barrio lo sigue contando", () => {
    const seleccionado = CON_BARRIO.find((e) => e.barrio === "01");
    assert.isDefined(seleccionado);
    const clave = seleccionado?.clave ?? "";
    const escena = agrupador.escena(NIVEL_DE_BARRIOS, MUNDO, clave);
    assert.isTrue(escena.elementos.has(`e:${clave}`));
    const oeste = elemento(escena, "b:01");
    assert.include(claves(agrupador, oeste), clave);
  });

  it("solo dibuja los barrios cuya etiqueta cae en la caja", () => {
    const caja: Rectangulo = {
      suroeste: { longitud: 2.13, latitud: 41.39 },
      noreste: { longitud: 2.16, latitud: 41.41 },
    };
    assert.deepStrictEqual(
      barriosDe(agrupador.escena(NIVEL_DE_BARRIOS, caja)).map((b) => b.clave),
      ["b:02"],
    );
  });
});

describe("niveles de municipios", () => {
  // Tres municipios por franjas de longitud al norte de 41,33°: Oeste, Barcelona (con dos barrios
  // al norte de 41,36°) y Este, solo de Movistar. Al sur, los cinco primeros son de Pequeño, con
  // menos de 10, y el resto no tiene municipio, como en un territorio compartido. Vacío no tiene
  // ninguno.
  const municipioDe = (longitud: number, latitud: number, i: number): string | null => {
    if (latitud < 41.33) return i < 40 ? "08200" : null;
    if (longitud < 2.1) return "08101";
    return longitud < 2.2 ? "08019" : "08015";
  };
  const barrioDe = (longitud: number, latitud: number, municipio: string | null) =>
    municipio !== "08019" || latitud < 41.36 ? null : longitud < 2.15 ? "02" : "03";
  const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoLeido> = SINTETICOS.map((e, i) => {
    const { longitud, latitud } = e.posicion;
    const municipio = municipioDe(longitud, latitud, i);
    return {
      ...e,
      municipio,
      barrio: barrioDe(longitud, latitud, municipio),
      companias: municipio === "08015" || i % 2 === 0 ? ["movistar"] : ["vodafone"],
    };
  });
  const municipio = (codigo: string, nombre: string, longitud: number, latitud: number) =>
    ({
      codigo,
      nombre,
      etiqueta: { longitud, latitud },
      habitantes: 1000,
      areaKm2: 10,
      emplazamientos: 0,
      companias: [],
    }) satisfies MunicipioDeCapa;
  const MUNICIPIOS = [
    municipio("08101", "Oeste", 2.08, 41.38),
    municipio("08019", "Barcelona", 2.15, 41.4),
    municipio("08015", "Este", 2.22, 41.42),
    municipio("08200", "Pequeño", 2.1, 41.325),
    municipio("08300", "Vacío", 2.3, 41.5),
  ];
  const BARRIOS: ReadonlyArray<Barrio> = [
    { codigo: "02", nombre: "Centro", etiqueta: { longitud: 2.13, latitud: 41.4 } },
    { codigo: "03", nombre: "Este", etiqueta: { longitud: 2.18, latitud: 41.41 } },
  ];
  const resumenes = resumirMunicipios(
    MUNICIPIOS,
    EMPLAZAMIENTOS.map((e) => ({ ...e, municipio: e.municipio ?? null })),
    new Set(["movistar", "vodafone"]),
  );
  const agrupador = crearAgrupador(EMPLAZAMIENTOS, BARRIOS, { municipios: resumenes });
  const sinMunicipios = crearAgrupador(EMPLAZAMIENTOS, BARRIOS);

  const municipiosDe = (escena: Escena): ReadonlyArray<ElementoMunicipio> =>
    [...escena.elementos.values()].filter((e) => e.tipo === "municipio");

  it("los niveles de municipios van del 11 al 12, justo antes del de barrios", () => {
    assert.strictEqual(NIVEL_DE_MUNICIPIOS, 11);
    assert.deepStrictEqual(
      Array.from({ length: 18 }, (_, n) => n).filter(esNivelDeMunicipios),
      [11, 12],
    );
  });

  it("cada emplazamiento va en su municipio; los que no tienen ninguno van sueltos", () => {
    for (const nivel of [NIVEL_DE_MUNICIPIOS, NIVEL_DE_BARRIOS - 1]) {
      const escena = agrupador.escena(nivel, MUNDO);
      assert.deepStrictEqual(
        municipiosDe(escena).map((m) => m.clave),
        ["m:08101", "m:08019", "m:08015", "m:08200", "m:08300"],
      );
      let suma = 0;
      for (const e of escena.elementos.values()) {
        const suyos = agrupador.emplazamientosDe(e);
        if (e.tipo === "municipio") {
          assert.strictEqual(e.resumen.emplazamientos, suyos.length, e.clave);
          assert.isTrue(suyos.every((s) => s.municipio === e.resumen.municipio.codigo));
          suma += suyos.length;
        } else {
          assert.strictEqual(e.tipo, "emplazamiento", `${e.clave} no es ni municipio ni suelto`);
          assert.isTrue(suyos.every((s) => s.municipio === null));
          suma += 1;
        }
      }
      assert.strictEqual(suma, EMPLAZAMIENTOS.length);
    }
  });

  it("solo los municipios con 10 emplazamientos o más dicen sus ausencias", () => {
    const porCodigo = new Map(
      municipiosDe(agrupador.escena(NIVEL_DE_MUNICIPIOS, MUNDO)).map((m) => [
        m.resumen.municipio.codigo,
        m.resumen,
      ]),
    );
    assert.isAtLeast(porCodigo.get("08015")?.emplazamientos ?? 0, UMBRAL_DE_AUSENCIAS);
    assert.deepStrictEqual(porCodigo.get("08015")?.ausentes, ["vodafone"]);
    assert.deepStrictEqual(porCodigo.get("08019")?.ausentes, []);
    // Pequeño solo tiene de Movistar, pero con menos de 10 no se dice que falte Vodafone.
    assert.isBelow(porCodigo.get("08200")?.emplazamientos ?? 99, UMBRAL_DE_AUSENCIAS);
    assert.isAbove(porCodigo.get("08200")?.emplazamientos ?? 0, 0);
    assert.deepStrictEqual(porCodigo.get("08200")?.ausentes, []);
    assert.strictEqual(porCodigo.get("08300")?.emplazamientos, 0);
    assert.deepStrictEqual(porCodigo.get("08300")?.ausentes, []);
  });

  it("fuera de los niveles de municipios, la agrupación y los barrios son los de siempre", () => {
    for (const nivel of [NIVEL_DE_MUNICIPIOS - 1, NIVEL_DE_BARRIOS, NIVEL_DE_BARRIOS + 1]) {
      assert.deepStrictEqual(
        [...agrupador.escena(nivel, MUNDO).elementos.keys()],
        [...sinMunicipios.escena(nivel, MUNDO).elementos.keys()],
      );
    }
    assert.lengthOf(municipiosDe(sinMunicipios.escena(NIVEL_DE_MUNICIPIOS, MUNDO)), 0);
  });

  it("al alejar desde los barrios, cada barrio va a su municipio; al acercar, sale de él", () => {
    const barrios = agrupador.escena(NIVEL_DE_BARRIOS, MUNDO);
    const municipios = agrupador.escena(NIVEL_DE_BARRIOS - 1, MUNDO);
    const alejar = agrupador.transicion(barrios, municipios);
    assert.strictEqual(alejar.destino.get("b:02"), "m:08019");
    assert.strictEqual(alejar.destino.get("b:03"), "m:08019");
    comprobarSaltoDeZonas(agrupador, NIVEL_DE_BARRIOS, NIVEL_DE_BARRIOS - 1);
    comprobarSaltoDeZonas(agrupador, 17, NIVEL_DE_MUNICIPIOS);
  });

  it("al alejar desde los municipios, cada uno va al hexágono que recoge la mayoría de los suyos", () => {
    comprobarSaltoDeZonas(agrupador, NIVEL_DE_MUNICIPIOS, NIVEL_DE_MUNICIPIOS - 1);
    comprobarSaltoDeZonas(agrupador, NIVEL_DE_BARRIOS - 1, 8);
  });

  it("entre los dos niveles de municipios no se mueve nada", () => {
    const t = agrupador.transicion(
      agrupador.escena(NIVEL_DE_MUNICIPIOS, MUNDO),
      agrupador.escena(NIVEL_DE_MUNICIPIOS + 1, MUNDO),
    );
    assert.strictEqual(t.destino.size + t.origen.size, 0);
  });

  it("pulsar un municipio acerca hasta el nivel de barrios", () => {
    const barcelona = municipiosDe(agrupador.escena(NIVEL_DE_MUNICIPIOS, MUNDO)).find(
      (m) => m.resumen.municipio.codigo === "08019",
    );
    assert.isDefined(barcelona);
    if (barcelona === undefined) return;
    const zoom = agrupador.zoomDeApertura(barcelona);
    assert.strictEqual(zoom, NIVEL_DE_BARRIOS);
    assert.lengthOf(municipiosDe(agrupador.escena(nivelDeZoom(zoom), MUNDO)), 0);
  });

  it("un municipio con emplazamientos a la vista y la etiqueta fuera se ve dentro de lo que se ve", () => {
    // Un trozo de Este al sur de su etiqueta.
    const caja: Rectangulo = {
      suroeste: { longitud: 2.2, latitud: 41.32 },
      noreste: { longitud: 2.26, latitud: 41.4 },
    };
    const este = municipiosDe(agrupador.escena(NIVEL_DE_MUNICIPIOS, caja)).find(
      (m) => m.clave === "m:08015",
    );
    assert.isDefined(este);
    const { longitud, latitud } = este?.posicion ?? { longitud: 0, latitud: 0 };
    assert.isTrue(longitud >= 2.2 && longitud <= 2.26 && latitud >= 41.32 && latitud <= 41.4);
    // Vacío no tiene emplazamientos: solo se ve si su etiqueta cae en la caja.
    assert.isFalse(agrupador.escena(NIVEL_DE_MUNICIPIOS, caja).elementos.has("m:08300"));
  });
});

describe("índice construido en un Worker y rehidratado aquí", () => {
  // Los mismos emplazamientos con barrios que arriba: así pasa también por el índice de los de
  // fuera de Barcelona.
  const barrioDe = (longitud: number, latitud: number): string | null =>
    latitud < 41.36 ? null : longitud < 2.15 ? "01" : "02";
  const CON_BARRIO: ReadonlyArray<EmplazamientoLeido> = SINTETICOS.map((e, i) => ({
    ...e,
    barrio: barrioDe(e.posicion.longitud, e.posicion.latitud),
    companias: i % 2 === 0 ? ["movistar"] : ["vodafone"],
  }));
  const BARRIOS: ReadonlyArray<Barrio> = [
    { codigo: "01", nombre: "Oeste", etiqueta: { longitud: 2.1, latitud: 41.4 } },
    { codigo: "02", nombre: "Este", etiqueta: { longitud: 2.2, latitud: 41.4 } },
  ];

  /** Lo que haría `postMessage` con los búferes transferidos: los mueve a otro sitio. */
  const porElWorker = (indice: Indice): IndiceSerializado => {
    const { serializado, transferibles } = serializarIndice(indice);
    return structuredClone(serializado, { transfer: [...transferibles] });
  };

  const enHilo = crearAgrupador(CON_BARRIO, BARRIOS, { prefijo: "08:" });
  const construidos = indexarCapa(CON_BARRIO, true);
  const posiciones = indicesDeCapa(CON_BARRIO, true);
  const deFuera = construidos.fuera;
  assert.isDefined(deFuera);
  const rehidratado = crearAgrupador(CON_BARRIO, BARRIOS, {
    prefijo: "08:",
    indices: {
      todos: rehidratarIndice(porElWorker(construidos.todos), posiciones.todos),
      fuera:
        deFuera === undefined
          ? undefined
          : rehidratarIndice(porElWorker(deFuera), posiciones.fuera ?? []),
    },
  });

  it("los búferes del índice construido se van con el mensaje", () => {
    assert.strictEqual(construidos.todos.coords.byteLength, 0);
  });

  it("da las mismas escenas a todos los niveles, con lo mismo dentro de cada elemento", () => {
    for (let nivel = 0; nivel <= 18; nivel++) {
      const antes = enHilo.escena(nivel, MUNDO, "s7");
      const despues = rehidratado.escena(nivel, MUNDO, "s7");
      assert.deepStrictEqual(despues.elementos, antes.elementos, `nivel ${nivel}`);
      for (const e of antes.elementos.values()) {
        assert.deepStrictEqual(claves(rehidratado, e), claves(enHilo, e), e.clave);
        if (e.tipo === "agrupacion" || e.tipo === "barrio") {
          assert.strictEqual(rehidratado.zoomDeApertura(e), enHilo.zoomDeApertura(e), e.clave);
        }
      }
    }
  });

  it("da las mismas transiciones entre cualquier par de niveles", () => {
    for (let fino = 18; fino >= 1; fino--) {
      for (let grueso = fino - 1; grueso >= 0; grueso -= 3) {
        const alejar = enHilo.transicion(enHilo.escena(fino, MUNDO), enHilo.escena(grueso, MUNDO));
        const alejarRehidratado = rehidratado.transicion(
          rehidratado.escena(fino, MUNDO),
          rehidratado.escena(grueso, MUNDO),
        );
        assert.deepStrictEqual(alejarRehidratado, alejar, `de ${fino} a ${grueso}`);
        const acercar = rehidratado.transicion(
          rehidratado.escena(grueso, MUNDO),
          rehidratado.escena(fino, MUNDO),
        );
        assert.deepStrictEqual(
          acercar,
          enHilo.transicion(enHilo.escena(grueso, MUNDO), enHilo.escena(fino, MUNDO)),
          `de ${grueso} a ${fino}`,
        );
      }
    }
  });

  it("las claves llevan la provincia, para no chocar con las de otra en la misma escena", () => {
    const claves = [...rehidratado.escena(10, MUNDO).elementos.keys()];
    assert.isTrue(claves.some((clave) => clave.startsWith("a:08:")));
    assert.isTrue(claves.every((clave) => clave.startsWith("a:08:") || clave.startsWith("e:")));
    assert.isTrue(rehidratado.escena(NIVEL_DE_BARRIOS, MUNDO).elementos.has("b:08:01"));
  });
});
