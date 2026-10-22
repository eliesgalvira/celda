import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { type Consejos, consejos, type PuntoParaConsejos } from "./consejos.ts";

/** Un punto a 340 m del emplazamiento, que queda al noreste (48°). */
const punto = (extra: Partial<PuntoParaConsejos> = {}): PuntoParaConsejos => ({
  tipo: "gps",
  distancia: 340,
  rumbo: 48.3,
  ...extra,
});

/** Todos los textos de la sección, en orden de lectura. */
const todos = (resultado: Consejos) => [
  ...(resultado.tipo === "sin-punto" ? [] : [resultado.hacia]),
  ...resultado.consejos.map((c) => c.texto),
  ...(resultado.tipo === "sin-punto" ? [resultado.llamada] : []),
];

const consejo = (resultado: Consejos, clave: string): string | undefined => {
  const encontrado = resultado.consejos.find((c) => c.clave === clave);
  return encontrado === undefined ? undefined : textoPlano(encontrado.texto);
};

const conRumbo = (resultado: Consejos) =>
  resultado.tipo === "con-rumbo" ? resultado : assert.fail(`sin rumbo: ${resultado.tipo}`);

const alPie = (resultado: Consejos) =>
  resultado.tipo === "al-pie" ? resultado : assert.fail(`no está al pie: ${resultado.tipo}`);

describe("consejos para mejorar la señal", () => {
  it("sin punto de referencia da consejos generales y dice qué se ganaría con uno", () => {
    const resultado = consejos(undefined);
    assert.strictEqual(resultado.tipo, "sin-punto");
    assert.deepStrictEqual(
      resultado.consejos.map((c) => c.clave),
      ["router", "antena", "movil"],
    );
    assert.match(consejo(resultado, "router") ?? "", /Una pared puede quitar 10 dB o más\.$/u);
    if (resultado.tipo !== "sin-punto") return;
    assert.strictEqual(
      textoPlano(resultado.llamada),
      "Con un punto de referencia, Celda te dice hacia qué ventana poner el router y a qué rumbo apuntar la antena.",
    );
  });

  it("con punto dice hacia dónde queda, hacia qué ventana poner el router y a qué rumbo apuntar la antena", () => {
    const resultado = conRumbo(consejos(punto()));
    assert.strictEqual(
      textoPlano(resultado.hacia),
      "Desde donde estás, el emplazamiento queda hacia el noreste, con rumbo 48°, a 340 m.",
    );
    assert.strictEqual(
      consejo(resultado, "router"),
      "Pon el router 4G/5G junto a una ventana que dé al noreste. Una pared puede quitar 10 dB o más.",
    );
    assert.strictEqual(
      consejo(resultado, "antena"),
      "Si usas una antena exterior direccional, apúntala a 48°. La brújula de abajo sirve para alinearla.",
    );
    assert.strictEqual(resultado.rumbo, 48);
  });

  it("siempre dice que girar el móvil apenas cambia la señal y que taparlo sí, como un aparte", () => {
    for (const resultado of [consejos(undefined), consejos(punto())]) {
      const movil = resultado.consejos.at(-1);
      assert.strictEqual(movil?.clave, "movil");
      assert.strictEqual(movil?.tono, "secundario");
      assert.match(textoPlano(movil?.texto ?? []), /^Girar el móvil apenas cambia/u);
    }
  });

  it("cerca y lejos cambian el consejo de la distancia", () => {
    assert.strictEqual(
      consejo(consejos(punto({ distancia: 150 })), "distancia"),
      "A 150 m la señal suele llegar con fuerza.",
    );
    assert.isUndefined(consejo(consejos(punto()), "distancia"));
    assert.strictEqual(
      consejo(consejos(punto({ distancia: 1240 })), "distancia"),
      "A 1,2 km la señal llega más débil, y es donde más se nota una antena exterior.",
    );
  });

  it("al pie del emplazamiento no hay rumbo al que apuntar", () => {
    const resultado = alPie(consejos(punto({ distancia: 8 })));
    assert.notProperty(resultado, "rumbo");
    assert.strictEqual(textoPlano(resultado.hacia), "Estás al pie del emplazamiento, a 10 m.");
    assert.match(consejo(resultado, "router") ?? "", /^Desde tan cerca no hace falta orientar/u);
    // A 15 m ya hay hacia dónde apuntar: es el radio de la fusión.
    assert.strictEqual(conRumbo(consejos(punto({ distancia: 15 }))).rumbo, 48);
  });

  it("con un punto elegido habla del punto, nunca de ti", () => {
    for (const extra of [{}, { distancia: 1240 }, { distancia: 8 }]) {
      const todo = todos(consejos(punto({ tipo: "elegido", ...extra })))
        .map(textoPlano)
        .join(" ");
      assert.notMatch(todo, /\b(ti|te|tu|tú|estás|pierdes)\b/iu, todo);
      assert.match(todo, /\bpunto\b/u);
    }
    assert.match(
      textoPlano(conRumbo(consejos(punto({ tipo: "elegido" }))).hacia),
      /^Desde el punto, el emplazamiento queda/u,
    );
  });

  it("subraya cada término una vez en toda la sección, en orden de lectura", () => {
    for (const resultado of [consejos(undefined), consejos(punto({ distancia: 1240 }))]) {
      const terminos = terminosDe(todos(resultado));
      assert.deepStrictEqual(terminos, [...new Set(terminos)]);
      assert.includeMembers([...terminos], ["router-movil", "antena-exterior", "decibelio"]);
    }
  });
});
