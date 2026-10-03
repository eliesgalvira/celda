import { textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { textoConflicto, textosCorrecciones } from "./correcciones.ts";
import { FICHA_COMPANIA_ANADIDA, FICHA_CORREGIDA, FICHA_NUEVA } from "./fichasCorregidas.ts";
import { sinBandasDe, tituloDe } from "./textos.ts";

describe("correcciones en la ficha", () => {
  it("si todas las fuentes coinciden no hay nada que contar", () => {
    assert.isUndefined(
      textosCorrecciones({
        ...FICHA_CORREGIDA,
        estado: "verificado",
        conflictos: [],
        estaciones: FICHA_CORREGIDA.estaciones.slice(0, 1),
      }),
    );
  });

  it("corregido: el registro la tiene de alta y la comunidad la da por desmontada, cada uno con su fecha", () => {
    const textos = textosCorrecciones(FICHA_CORREGIDA);
    assert.strictEqual(
      textoPlano(textos?.resumen ?? []),
      "La comunidad corrige el registro oficial en este emplazamiento. Aquí están las dos versiones.",
    );
    assert.deepStrictEqual(
      textos?.resumen.flatMap((f) => (f.termino === undefined ? [] : [f.termino])),
      ["correccion", "registro-oficial", "emplazamiento"],
    );
    assert.deepStrictEqual(textos?.contrastes, [
      {
        tono: "corregido",
        compania: "vodafone",
        nombre: "Vodafone",
        oficial: {
          fuente: "Registro oficial",
          dice: "La tiene dada de alta",
          fecha: "desde el 26 sept 2026",
          enlace: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=086040",
          textoEnlace: "Ver en el registro oficial",
        },
        comunidad: {
          fuente: "Comunidad de Celda",
          dice: "La da por desmontada",
          fecha: "desde el 27 sept 2026",
          enlace: "https://comunidad.example/correccion/1",
          textoEnlace: "Ver la corrección",
        },
      },
    ]);
    // La desmontada ya la cuenta su contraste: no se repite como conflicto.
    assert.deepStrictEqual(textos?.conflictos, []);
  });

  it("nuevo: el registro no la tiene y la comunidad la ha añadido", () => {
    const [contraste] = textosCorrecciones(FICHA_NUEVA)?.contrastes ?? [];
    assert.strictEqual(contraste?.tono, "nuevo");
    assert.deepStrictEqual(contraste?.oficial, { fuente: "Registro oficial", dice: "No la tiene" });
    assert.strictEqual(contraste?.comunidad.dice, "La sitúa aquí");
    assert.strictEqual(
      textoPlano(textosCorrecciones(FICHA_NUEVA)?.resumen ?? []),
      "El registro oficial no tiene este emplazamiento: lo han añadido los usuarios de la comunidad.",
    );
  });

  it("corregido: la comunidad añade una compañía que el registro no tiene en ese emplazamiento", () => {
    const textos = textosCorrecciones(FICHA_COMPANIA_ANADIDA);
    assert.deepStrictEqual(
      textos?.contrastes.map((c) => [c.nombre, c.tono, c.oficial.dice, c.comunidad.dice]),
      [["Orange", "corregido", "No la tiene aquí", "La sitúa aquí"]],
    );
  });

  it("los conflictos se cuentan todos, también en un emplazamiento verificado", () => {
    const textos = textosCorrecciones({
      ...FICHA_CORREGIDA,
      estado: "verificado",
      estaciones: FICHA_CORREGIDA.estaciones.slice(0, 1),
      conflictos: [
        { tipo: "codigos-distintos", compania: "movistar", codigos: ["0800977", "MV-BCN-5"] },
        { tipo: "posicion-distinta", compania: "orange", codigo: "CATR6046A", metros: 40 },
      ],
    });
    assert.deepStrictEqual(textos?.conflictos, [
      "Movistar aparece con códigos distintos según la fuente: 0800977 y MV-BCN-5. Puede ser la misma estación base contada dos veces.",
      "Las fuentes sitúan el código CATR6046A de Orange en sitios a 40 m uno de otro.",
    ]);
    assert.isUndefined(
      textoConflicto({
        tipo: "desmontada",
        compania: "vodafone",
        procedencia: { fuente: "comunidad", clave: "x" },
        fecha: 0,
      }),
    );
  });

  it("la dirección de OpenStreetMap de una ER5 da la calle y el número como título", () => {
    assert.strictEqual(tituloDe(FICHA_NUEVA), "Carrer de Tarragona, 177");
    assert.strictEqual(
      tituloDe({ ...FICHA_NUEVA, direccion: "Pl. d'Urquinaona, L'Eixample, 08010 Barcelona" }),
      "Pl. d'Urquinaona",
    );
  });

  it("una estación que el registro no tiene no promete leer sus bandas allí", () => {
    const [er5] = FICHA_NUEVA.estaciones;
    const [oficial] = FICHA_CORREGIDA.estaciones;
    assert.match(er5 === undefined ? "" : sinBandasDe(er5), /^No está en el registro oficial/u);
    assert.match(oficial === undefined ? "" : sinBandasDe(oficial), /aún no ha leído/u);
  });
});
