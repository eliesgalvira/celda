import { assert, describe, expect, it } from "@effect/vitest";

import { type Coordenada, distanciaMetros } from "./area.ts";
import type { Banda } from "./banda.ts";
import type { Compania } from "./compania.ts";
import type { Emplazamiento } from "./emplazamiento.ts";
import { fusionar, REGLA_FUSION } from "./fusion.ts";
import type { Afirmacion, Fuente, Observacion } from "./observacion.ts";

const PIUS_XII: Coordenada = { longitud: 2.122967, latitud: 41.386032 };
const FECHA = Date.UTC(2026, 8, 26);

/** El punto que queda `metros` al este de `origen`. */
const alEste = (origen: Coordenada, metros: number): Coordenada => ({
  longitud:
    origen.longitud +
    metros / (6_371_008.8 * Math.cos((origen.latitud * Math.PI) / 180) * (Math.PI / 180)),
  latitud: origen.latitud,
});

const banda = (compania: Compania, referencia: string, mhz: Banda["mhz"]): Banda => ({
  referencia,
  compania,
  rangos: [],
  mhz,
  anio: 2024,
});

interface Datos {
  readonly fuente?: Fuente;
  readonly compania: Compania;
  readonly codigo: string;
  readonly posicion?: Coordenada;
  readonly afirma?: Afirmacion;
  readonly bandas?: ReadonlyArray<Banda>;
  readonly fecha?: number;
}

const observacion = (datos: Datos): Observacion => {
  const fuente = datos.fuente ?? "registro-oficial";
  return {
    fuente,
    clave: `${datos.compania.toUpperCase()} - ${datos.codigo}`,
    compania: datos.compania,
    codigo: datos.codigo,
    posicion: datos.posicion ?? PIUS_XII,
    direccion: "PZ PIUS XII, 4. BARCELONA, BARCELONA",
    municipio: "BARCELONA",
    bandas: datos.bandas ?? [],
    url: `https://${fuente}.example/${datos.codigo}`,
    fecha: datos.fecha ?? FECHA,
    afirma: datos.afirma ?? "presente",
  };
};

/** Los resultados de referencia son JSON legible, para revisarlos en cada cambio de la regla. */
const referencia = (nombre: string) => `./referencia/fusion-${nombre}.json`;
const json = (
  valor: ReadonlyArray<Emplazamiento> | Readonly<Record<string, ReadonlyArray<Emplazamiento>>>,
) => `${JSON.stringify(valor, null, 2)}\n`;

describe("fusionar", () => {
  it("la distancia de prueba mide lo que dice", () => {
    assert.closeTo(distanciaMetros(PIUS_XII, alEste(PIUS_XII, 37)), 37, 0.001);
  });

  it("junta compañías distintas justo dentro del radio y las separa justo fuera", async () => {
    const radio = REGLA_FUSION.radioMetros;
    const dentro = fusionar([
      observacion({ compania: "orange", codigo: "CATR6158A" }),
      observacion({
        compania: "movistar",
        codigo: "0800307",
        posicion: alEste(PIUS_XII, radio - 0.5),
      }),
    ]);
    const fuera = fusionar([
      observacion({ compania: "orange", codigo: "CATR6158A" }),
      observacion({
        compania: "movistar",
        codigo: "0800307",
        posicion: alEste(PIUS_XII, radio + 0.5),
      }),
    ]);
    assert.strictEqual(dentro.length, 1);
    assert.strictEqual(fuera.length, 2);
    await expect(json({ dentro, fuera })).toMatchFileSnapshot(referencia("umbral"));
  });

  it("encadena la cercanía: A cerca de B y B cerca de C van juntas", () => {
    const paso = REGLA_FUSION.radioMetros - 1;
    const emplazamientos = fusionar([
      observacion({ compania: "orange", codigo: "CATR0001A" }),
      observacion({ compania: "movistar", codigo: "0800001", posicion: alEste(PIUS_XII, paso) }),
      observacion({ compania: "vodafone", codigo: "1", posicion: alEste(PIUS_XII, 2 * paso) }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.deepStrictEqual(
      emplazamientos[0]?.estaciones.map((e) => e.compania),
      ["movistar", "orange", "vodafone"],
    );
  });

  it("tres compañías en el mismo punto son un emplazamiento con tres estaciones base", async () => {
    const emplazamientos = fusionar([
      observacion({
        compania: "orange",
        codigo: "CATR6158A",
        bandas: [banda("orange", "B B -2403167", 2100)],
      }),
      observacion({
        compania: "movistar",
        codigo: "0800307",
        bandas: [banda("movistar", "B B -1901854", 1800)],
      }),
      observacion({
        compania: "vodafone",
        codigo: "028723",
        bandas: [banda("vodafone", "B B -0900936", 2100)],
      }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.strictEqual(emplazamientos[0]?.estado, "verificado");
    assert.strictEqual(emplazamientos[0]?.confianza, "media");
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("companias-distintas"));
  });

  it("los códigos de Vodafone con ceros a la izquierda son una sola estación base", async () => {
    const emplazamientos = fusionar(
      ["647", "00647", "000647"].map((codigo, indice) =>
        observacion({
          compania: "vodafone",
          codigo,
          bandas: [banda("vodafone", `B B -19000${indice}0`, 900)],
        }),
      ),
    );
    assert.strictEqual(emplazamientos.length, 1);
    assert.deepStrictEqual(emplazamientos[0]?.estaciones[0]?.codigos, ["647"]);
    assert.strictEqual(emplazamientos[0]?.estaciones[0]?.bandas.length, 3);
    assert.deepStrictEqual(emplazamientos[0]?.conflictos, []);
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("codigos-vodafone"));
  });

  it("verificado: el registro y la comunidad coinciden", async () => {
    const emplazamientos = fusionar([
      observacion({ compania: "movistar", codigo: "0802314" }),
      observacion({ fuente: "antenasmoviles", compania: "movistar", codigo: "0802314" }),
    ]);
    assert.strictEqual(emplazamientos[0]?.estado, "verificado");
    assert.strictEqual(emplazamientos[0]?.confianza, "alta");
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("verificado"));
  });

  it("corregido: la comunidad da por desmontada una estación base del registro", async () => {
    const emplazamientos = fusionar([
      observacion({ compania: "movistar", codigo: "0802314" }),
      observacion({ compania: "orange", codigo: "CATR0377Z" }),
      observacion({
        fuente: "antenasmoviles",
        compania: "movistar",
        codigo: "0802314",
        afirma: "desmontada",
        posicion: alEste(PIUS_XII, 3),
        fecha: FECHA + 86_400_000,
      }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.strictEqual(emplazamientos[0]?.estado, "corregido");
    assert.strictEqual(emplazamientos[0]?.confianza, "baja");
    assert.deepStrictEqual(
      emplazamientos[0]?.conflictos.map((c) => c.tipo),
      ["desmontada"],
    );
    assert.strictEqual(emplazamientos[0]?.datosDel, FECHA + 86_400_000);
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("corregido-desmontada"));
  });

  it("corregido: la comunidad añade una compañía que el registro no tiene en ese sitio", () => {
    const emplazamientos = fusionar([
      observacion({ compania: "movistar", codigo: "0802314" }),
      observacion({ fuente: "antenasmoviles", compania: "digi", codigo: "MV-BCN-1" }),
    ]);
    assert.strictEqual(emplazamientos[0]?.estado, "corregido");
    assert.deepStrictEqual(emplazamientos[0]?.conflictos, []);
  });

  it("nuevo: solo lo conoce una fuente de la comunidad", async () => {
    const emplazamientos = fusionar([
      observacion({ fuente: "antenasmoviles", compania: "movistar", codigo: "MV-BCN-82383" }),
    ]);
    assert.strictEqual(emplazamientos[0]?.estado, "nuevo");
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("nuevo"));
  });

  it("una desmontada sin estación base de su compañía cerca no crea nada", () => {
    const emplazamientos = fusionar([
      observacion({ compania: "orange", codigo: "CATR0377Z" }),
      observacion({
        fuente: "antenasmoviles",
        compania: "movistar",
        codigo: "0802314",
        afirma: "desmontada",
      }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.strictEqual(emplazamientos[0]?.estado, "verificado");
  });

  it("conflictos: códigos distintos entre fuentes y un código repetido lejos", async () => {
    const lejos = alEste(PIUS_XII, 500);
    const emplazamientos = fusionar([
      observacion({ compania: "movistar", codigo: "0800977" }),
      observacion({ fuente: "antenasmoviles", compania: "movistar", codigo: "MV-BCN-5" }),
      observacion({ compania: "orange", codigo: "CATR6046A" }),
      observacion({ compania: "orange", codigo: "CATR6046A", posicion: lejos }),
    ]);
    assert.strictEqual(emplazamientos.length, 2);
    assert.deepStrictEqual(
      emplazamientos.map((e) => e.conflictos.map((c) => c.tipo)),
      [["codigos-distintos", "posicion-distinta"], ["posicion-distinta"]],
    );
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("conflictos"));
  });

  it("no depende del orden de la entrada", () => {
    const entrada = [
      observacion({ compania: "orange", codigo: "CATR0228A" }),
      observacion({ compania: "movistar", codigo: "0802532" }),
      observacion({ compania: "vodafone", codigo: "86040" }),
      observacion({ compania: "vodafone", codigo: "086040" }),
      observacion({ compania: "orange", codigo: "CATR0508Z", posicion: alEste(PIUS_XII, 300) }),
    ];
    assert.deepStrictEqual(fusionar(entrada.toReversed()), fusionar(entrada));
  });
});
