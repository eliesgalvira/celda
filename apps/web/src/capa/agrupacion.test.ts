import type { Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";

import {
  type Agrupador,
  crearAgrupador,
  type Elemento,
  type ElementoAgrupacion,
  type Escena,
  nivelDeZoom,
} from "./agrupacion.ts";

const MUNDO: Rectangulo = {
  suroeste: { longitud: -180, latitud: -85 },
  noreste: { longitud: 180, latitud: 85 },
};

const en = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
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
const SINTETICOS: ReadonlyArray<EmplazamientoDeCapa> = (() => {
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

  it("solo dibuja lo que cae en la caja", () => {
    const caja: Rectangulo = {
      suroeste: { longitud: 2.17, latitud: 41.38 },
      noreste: { longitud: 2.19, latitud: 41.4 },
    };
    assert.deepStrictEqual([...agrupador.escena(17, caja).elementos.keys()], ["e:c"]);
  });
});
