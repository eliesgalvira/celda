import { assert, describe, it } from "@effect/vitest";

import {
  GLOSARIO,
  llano,
  marcado,
  primeraVezEn,
  termino,
  TERMINOS,
  terminosDe,
  textoPlano,
} from "./glosario.ts";

/** Las frases de un texto: cada una acaba en punto, cierre de exclamación o de interrogación. */
const frases = (texto: string): ReadonlyArray<string> =>
  texto.split(/(?<=[.!?]»?)\s+/u).filter((frase) => frase.trim() !== "");

describe("GLOSARIO", () => {
  it("tiene una entrada por término y ninguna de más", () => {
    assert.deepStrictEqual(Object.keys(GLOSARIO).toSorted(), [...TERMINOS].toSorted());
  });

  it("explica los términos que la interfaz y el ejercicio de clase necesitan", () => {
    const nombres = new Set(Object.values(GLOSARIO).map((entrada) => entrada.nombre));
    for (const nombre of [
      "Emplazamiento",
      "Estación base",
      "Sector",
      "Banda",
      "MHz",
      "4G",
      "5G",
      "Celda",
      "Azimut",
      "Cobertura",
      "Compañía",
      "Registro oficial",
      "Corrección",
      "Verificado",
      "Corregido",
      "Nuevo",
      "Actualizado después del mapa",
      "Versión de los datos",
      "Modo de información",
    ]) {
      assert.isTrue(nombres.has(nombre), `falta «${nombre}»`);
    }
  });

  it.each(TERMINOS)("«%s» se explica en llano en una a tres frases", (cual) => {
    const { explicacion, nombre, tecnico } = GLOSARIO[cual];
    assert.isNotEmpty(nombre);
    const numero = frases(explicacion).length;
    assert.isAtLeast(numero, 1);
    assert.isAtMost(numero, 3, explicacion);
    // Cabe en la explicación de un móvil sin tener que desplazarla.
    assert.isAtMost(explicacion.length, 240, explicacion);
    assert.match(explicacion, /^[A-ZÁÉÍÓÚÑ]/u);
    assert.match(explicacion, /\.$/u);
    // Nada de rayas: en un texto llano sobran.
    assert.notMatch(explicacion, /[—–]/u);
    // El término técnico va aparte, al final, y es corto para poder buscarlo.
    assert.isNotEmpty(tecnico);
    assert.isAtMost(tecnico.length, 60, tecnico);
  });

  it.each(TERMINOS)("los términos relacionados con «%s» existen y no se repiten", (cual) => {
    const { relacionados } = GLOSARIO[cual];
    assert.notInclude(relacionados, cual);
    assert.strictEqual(new Set(relacionados).size, relacionados.length);
    for (const otro of relacionados) assert.include(TERMINOS, otro);
  });

  it("cada nombre sale una sola vez", () => {
    const nombres = Object.values(GLOSARIO).map((entrada) => entrada.nombre.toLowerCase());
    assert.strictEqual(new Set(nombres).size, nombres.length);
  });
});

describe("textos marcados", () => {
  it("la plantilla intercala términos y texto llano, y junta lo llano seguido", () => {
    const quien = "Movistar";
    const texto = marcado`Aquí emite ${quien}. Por sus ${termino("banda", "bandas")}, da ${termino("5g", "5G")}.`;
    assert.deepStrictEqual(texto, [
      { texto: "Aquí emite Movistar. Por sus " },
      { texto: "bandas", termino: "banda" },
      { texto: ", da " },
      { texto: "5G", termino: "5g" },
      { texto: "." },
    ]);
    assert.strictEqual(textoPlano(texto), "Aquí emite Movistar. Por sus bandas, da 5G.");
    assert.deepStrictEqual(terminosDe([texto]), ["banda", "5g"]);
  });

  it("en un bloque, solo la primera aparición de cada término queda marcada", () => {
    const [primero, segundo] = primeraVezEn([
      marcado`Las ${termino("banda", "bandas")} bajas y las ${termino("banda", "bandas")} altas.`,
      marcado`${termino("banda", "Banda")} de ${termino("mhz", "700 MHz")}.`,
    ]);
    assert.deepStrictEqual(primero, [
      { texto: "Las " },
      { texto: "bandas", termino: "banda" },
      { texto: " bajas y las bandas altas." },
    ]);
    assert.deepStrictEqual(segundo, [
      { texto: "Banda de " },
      { texto: "700 MHz", termino: "mhz" },
      { texto: "." },
    ]);
  });

  it("un texto llano no marca nada", () => {
    assert.deepStrictEqual(terminosDe([llano("Cargando los emplazamientos…")]), []);
  });
});
