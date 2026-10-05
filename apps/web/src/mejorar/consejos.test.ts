import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { orientacionDe } from "../ficha/diagrama.ts";
import type { LecturaServicio } from "../servicio/servicio.ts";
import { type Consejos, consejos, type PuntoParaConsejos } from "./consejos.ts";

const SUPUESTA = orientacionDe([]);

/** Lo que dice el sector que da servicio de un punto a 340 m. */
const servicio = (
  sector: number | undefined,
  desviacion: number,
  extra: Partial<LecturaServicio> = {},
): LecturaServicio => ({
  sector,
  gananciaDb: -Math.min(12 * (desviacion / 65) ** 2, 30),
  desviacion,
  distancia: 340,
  rumbo: 228,
  enCelda: true,
  ...extra,
});

/** Un punto a 340 m del emplazamiento, que queda al noreste (48°). */
const punto = (extra: Partial<PuntoParaConsejos> = {}): PuntoParaConsejos => ({
  tipo: "gps",
  distancia: 340,
  rumbo: 48.3,
  servicio: servicio(2, -18),
  orientacion: SUPUESTA,
  ...extra,
});

const textos = (resultado: Consejos): ReadonlyArray<string> => [
  ...(resultado.tipo === "con-punto" ? [textoPlano(resultado.hacia)] : []),
  ...resultado.consejos.map((c) => textoPlano(c.texto)),
  textoPlano(resultado.tipo === "con-punto" ? resultado.nota : resultado.llamada),
];

const consejo = (resultado: Consejos, clave: string): string | undefined => {
  const encontrado = resultado.consejos.find((c) => c.clave === clave);
  return encontrado === undefined ? undefined : textoPlano(encontrado.texto);
};

const conPunto = (resultado: Consejos) => {
  assert.strictEqual(resultado.tipo, "con-punto");
  return resultado.tipo === "con-punto" ? resultado : assert.fail("sin punto");
};

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
    const resultado = conPunto(consejos(punto()));
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
    assert.strictEqual(resultado.objetivo, 48);
  });

  it("siempre dice que girar el móvil en la mano apenas cambia nada, como un aparte", () => {
    for (const resultado of [consejos(undefined), consejos(punto())]) {
      const movil = resultado.consejos.at(-1);
      assert.strictEqual(movil?.clave, "movil");
      assert.strictEqual(movil?.tono, "secundario");
      assert.match(textoPlano(movil?.texto ?? []), /^Girar el móvil en la mano apenas cambia/u);
    }
  });

  it("de frente a un sector y entre dos lo dice; algo fuera del eje no añade nada", () => {
    assert.strictEqual(
      consejo(consejos(punto()), "sector"),
      "Estás casi de frente al sector 3, así que una antena apuntada al emplazamiento queda también de cara a su haz.",
    );
    assert.match(
      consejo(consejos(punto({ servicio: servicio(1, 55) })), "sector") ?? "",
      /^Estás entre dos sectores, donde llega menos señal\. Aun así, conviene apuntar al emplazamiento/u,
    );
    assert.isUndefined(consejo(consejos(punto({ servicio: servicio(0, 30) })), "sector"));
    // Mientras el modelo calcula, los consejos que no dependen de él ya están.
    const calculando = consejos(punto({ servicio: undefined }));
    assert.isUndefined(consejo(calculando, "sector"));
    assert.isDefined(consejo(calculando, "antena"));
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
    const resultado = conPunto(
      consejos(punto({ distancia: 8, servicio: servicio(undefined, 0, { distancia: 8 }) })),
    );
    assert.isUndefined(resultado.objetivo);
    assert.strictEqual(textoPlano(resultado.hacia), "Estás al pie del emplazamiento, a 10 m.");
    assert.match(consejo(resultado, "router") ?? "", /^Desde tan cerca no hace falta orientar/u);
    // Sin el modelo, la distancia basta para saberlo.
    assert.isUndefined(conPunto(consejos(punto({ distancia: 8, servicio: undefined }))).objetivo);
  });

  it("fuera de la celda avisa de que hay otro emplazamiento más cerca", () => {
    assert.strictEqual(
      consejo(
        consejos(punto({ servicio: servicio(2, -18, { enCelda: false }) })),
        "otro-emplazamiento",
      ),
      "Hay otro emplazamiento más cerca de ti. Mira también su ficha antes de orientar nada, porque la señal puede llegar de allí.",
    );
    assert.isUndefined(consejo(consejos(punto()), "otro-emplazamiento"));
  });

  it("con un punto elegido habla del punto, nunca de ti", () => {
    for (const extra of [
      {},
      { servicio: servicio(1, 55, { enCelda: false }) },
      { distancia: 8, servicio: servicio(undefined, 0) },
    ]) {
      const todo = textos(consejos(punto({ tipo: "elegido", ...extra }))).join(" ");
      assert.notMatch(todo, /\b(ti|te|tu|tú|estás|pierdes)\b/iu, todo);
      assert.match(todo, /\bpunto\b/u);
    }
    assert.match(
      textoPlano(conPunto(consejos(punto({ tipo: "elegido" }))).hacia),
      /^Desde el punto, el emplazamiento queda/u,
    );
  });

  it("dice que la orientación de los sectores es supuesta y no promete precisión", () => {
    const nota = textoPlano(conPunto(consejos(punto())).nota);
    assert.match(nota, /^La orientación de los sectores es supuesta\./u);
    assert.match(nota, /Toma el rumbo como punto de partida/u);
    const estimada = textoPlano(
      conPunto(consejos(punto({ orientacion: orientacionDe([30, 150, 270]) }))).nota,
    );
    assert.match(estimada, /orientación de los sectores tiene ±15° de margen/u);
  });

  it("subraya cada término una vez en toda la sección, en orden de lectura", () => {
    for (const resultado of [
      consejos(undefined),
      consejos(punto({ distancia: 1240, servicio: servicio(1, 55, { enCelda: false }) })),
    ]) {
      const todos = [
        ...(resultado.tipo === "con-punto" ? [resultado.hacia] : []),
        ...resultado.consejos.map((c) => c.texto),
        resultado.tipo === "con-punto" ? resultado.nota : resultado.llamada,
      ];
      const terminos = terminosDe(todos);
      assert.deepStrictEqual(terminos, [...new Set(terminos)]);
      assert.includeMembers([...terminos], ["router-movil", "antena-exterior", "decibelio"]);
    }
  });
});
