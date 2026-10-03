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
  readonly direccion?: string;
}

const observacion = (datos: Datos): Observacion => {
  const fuente = datos.fuente ?? "registro-oficial";
  return {
    fuente,
    clave: `${datos.compania.toUpperCase()} - ${datos.codigo}`,
    compania: datos.compania,
    codigo: datos.codigo,
    posicion: datos.posicion ?? PIUS_XII,
    direccion: datos.direccion ?? "PZ PIUS XII, 4. BARCELONA, BARCELONA",
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
    // Con direcciones distintas, para que solo cuente la distancia.
    const vecina = (metros: number) =>
      observacion({
        compania: "movistar",
        codigo: "0800307",
        posicion: alEste(PIUS_XII, metros),
        direccion: "AV PEDRALBES, 1. BARCELONA, BARCELONA",
      });
    const dentro = fusionar([
      observacion({ compania: "orange", codigo: "CATR6158A" }),
      vecina(radio - 0.5),
    ]);
    const fuera = fusionar([
      observacion({ compania: "orange", codigo: "CATR6158A" }),
      vecina(radio + 0.5),
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

  it("junta la misma dirección hasta su radio: la azotea de Madrid con cada compañía en su esquina", () => {
    // CL COMANDANTE FORTEA, 3: Orange y Vodafone a 16,9 m en el listado del 28/09/2026.
    const radio = REGLA_FUSION.radioMismaDireccionMetros;
    const azotea = (metros: number, direccion: string) =>
      fusionar([
        observacion({
          compania: "orange",
          codigo: "MADR3818O",
          direccion: "CL COMANDANTE FORTEA, 3. MADRID, MADRID",
        }),
        observacion({
          compania: "vodafone",
          codigo: "058469",
          posicion: alEste(PIUS_XII, metros),
          direccion,
        }),
      ]).length;
    assert.strictEqual(azotea(radio - 0.5, "CL COMANDANTE FORTEA, 3. MADRID, MADRID"), 1);
    assert.strictEqual(azotea(radio - 0.5, "CL DE COMANDANTE FORTEA, 3. MADRID, MADRID"), 1);
    assert.strictEqual(azotea(radio + 0.5, "CL COMANDANTE FORTEA, 3. MADRID, MADRID"), 2);
    assert.strictEqual(azotea(radio - 0.5, "CL COMANDANTE FORTEA, 5. MADRID, MADRID"), 2);
    // Sin número no se sabe si es el mismo edificio.
    assert.strictEqual(azotea(radio - 0.5, "CL COMANDANTE FORTEA, S/N. MADRID, MADRID"), 2);
  });

  it("junta la misma estación base con otros ceros hasta su radio, aunque cambie la dirección", async () => {
    // Vodafone 017803 y 17803, CL ALBERTO AGUILERA, 3, a 15,4 m en el listado del 28/09/2026.
    // Aquí a 50 m y con otra dirección, para que solo cuente el código.
    const radio = REGLA_FUSION.radioMismoCodigoMetros;
    const estacion = (metros: number, compania: Compania = "vodafone") =>
      fusionar([
        observacion({ compania: "vodafone", codigo: "017803" }),
        observacion({
          compania,
          codigo: "17803",
          posicion: alEste(PIUS_XII, metros),
          direccion: "CL ALBERTO AGUILERA, 5. MADRID, MADRID",
        }),
      ]);
    const juntas = estacion(50);
    assert.deepStrictEqual(
      juntas.map((e) => e.estaciones.map((s) => [s.compania, s.codigos])),
      [[["vodafone", ["017803", "17803"]]]],
    );
    assert.deepStrictEqual(juntas[0]?.conflictos, []);
    assert.strictEqual(estacion(radio - 0.5).length, 1);
    assert.strictEqual(estacion(radio + 0.5).length, 2);
    // El mismo número de otra compañía es otra estación base.
    assert.strictEqual(estacion(50, "movistar").length, 2);
    await expect(json(juntas)).toMatchFileSnapshot(referencia("misma-estacion"));
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

  it("los registros de Vodafone en el mismo punto son una sola estación base con todos sus códigos", async () => {
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
    assert.deepStrictEqual(emplazamientos[0]?.estaciones[0]?.codigos, ["000647", "00647", "647"]);
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

  it("códigos que solo difieren en ceros pero están lejos son emplazamientos distintos sin conflicto", () => {
    // En la descarga real, Vodafone `3248` y `003248` están a 4 km.
    const emplazamientos = fusionar([
      observacion({ compania: "vodafone", codigo: "3248" }),
      observacion({ compania: "vodafone", codigo: "003248", posicion: alEste(PIUS_XII, 4000) }),
    ]);
    assert.deepStrictEqual(
      emplazamientos.map((e) => [e.clave, e.conflictos.length]),
      [
        ["vodafone-003248", 0],
        ["vodafone-3248", 0],
      ],
    );
  });

  it("el mismo código dos veces en el registro, lejos, da dos claves distintas y un conflicto en cada uno", () => {
    const emplazamientos = fusionar([
      observacion({ compania: "orange", codigo: "CATR6046A" }),
      observacion({ compania: "orange", codigo: "CATR6046A", posicion: alEste(PIUS_XII, 800) }),
    ]);
    assert.deepStrictEqual(
      emplazamientos.map((e) => [e.clave, e.estado, e.conflictos.map((c) => c.tipo)]),
      [
        ["orange-CATR6046A", "verificado", ["posicion-distinta"]],
        ["orange-CATR6046A-2", "verificado", ["posicion-distinta"]],
      ],
    );
  });

  it("une por código: la comunidad con el código del registro va a su emplazamiento aunque esté lejos", async () => {
    const emplazamientos = fusionar([
      observacion({ compania: "orange", codigo: "CATR6046A" }),
      observacion({
        fuente: "antenasmoviles",
        compania: "orange",
        codigo: "CATR6046A",
        posicion: alEste(PIUS_XII, 40),
      }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.strictEqual(emplazamientos[0]?.estado, "verificado");
    assert.strictEqual(emplazamientos[0]?.confianza, "baja");
    assert.deepStrictEqual(emplazamientos[0]?.conflictos, [
      { tipo: "posicion-distinta", compania: "orange", codigo: "CATR6046A", metros: 40 },
    ]);
    // La posición del emplazamiento es la del registro oficial.
    assert.deepStrictEqual(emplazamientos[0]?.posicion, PIUS_XII);
    await expect(json(emplazamientos)).toMatchFileSnapshot(referencia("union-por-codigo"));
  });

  it("une por código sin quitar ceros: `3248` de la comunidad no es `003248` del registro", () => {
    const emplazamientos = fusionar([
      observacion({ compania: "vodafone", codigo: "003248" }),
      observacion({
        fuente: "antenasmoviles",
        compania: "vodafone",
        codigo: "3248",
        posicion: alEste(PIUS_XII, 400),
      }),
    ]);
    assert.deepStrictEqual(
      emplazamientos.map((e) => [e.clave, e.estado]),
      [
        ["vodafone-003248", "verificado"],
        ["vodafone-3248", "nuevo"],
      ],
    );
  });

  it("una desmontada con el código del registro va con él aunque esté más allá del radio", () => {
    const emplazamientos = fusionar([
      observacion({ compania: "movistar", codigo: "0802314" }),
      observacion({
        fuente: "antenasmoviles",
        compania: "movistar",
        codigo: "0802314",
        afirma: "desmontada",
        posicion: alEste(PIUS_XII, 25),
      }),
    ]);
    assert.strictEqual(emplazamientos.length, 1);
    assert.strictEqual(emplazamientos[0]?.estado, "corregido");
    assert.deepStrictEqual(
      emplazamientos[0]?.conflictos.map((c) => c.tipo),
      ["desmontada", "posicion-distinta"],
    );
  });

  it("sin ficha en el registro: solo la compañía cuyas observaciones del registro lo están todas", () => {
    const sinFicha = (o: Observacion, fecha: number): Observacion => ({
      ...o,
      sinFichaEnRegistro: fecha,
    });
    const [emplazamiento] = fusionar([
      sinFicha(observacion({ compania: "vodafone", codigo: "061723" }), FECHA),
      sinFicha(observacion({ compania: "vodafone", codigo: "61723" }), FECHA + 1000),
      observacion({
        compania: "movistar",
        codigo: "0802532",
        bandas: [banda("movistar", "M", 800)],
      }),
      sinFicha(observacion({ compania: "orange", codigo: "CLMR6422A" }), FECHA),
      observacion({ compania: "orange", codigo: "CLMR6422B" }),
    ]);
    const estacion = (compania: Compania) =>
      emplazamiento?.estaciones.find((e) => e.compania === compania);
    // Vodafone: sus dos registros sin ficha, con la comprobación más reciente.
    assert.strictEqual(estacion("vodafone")?.sinFichaEnRegistro, FECHA + 1000);
    // Movistar tiene bandas, y de Orange queda una ficha por leer: ninguna está sin ficha.
    assert.notProperty(estacion("movistar"), "sinFichaEnRegistro");
    assert.notProperty(estacion("orange"), "sinFichaEnRegistro");
  });

  it("una estación base con bandas no está sin ficha aunque otra observación suya lo esté", () => {
    const [emplazamiento] = fusionar([
      { ...observacion({ compania: "vodafone", codigo: "061723" }), sinFichaEnRegistro: FECHA },
      observacion({
        compania: "vodafone",
        codigo: "61723",
        bandas: [banda("vodafone", "V", 1800)],
      }),
    ]);
    assert.notProperty(emplazamiento?.estaciones[0], "sinFichaEnRegistro");
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
