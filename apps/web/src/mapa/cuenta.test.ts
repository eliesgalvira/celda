import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { combinacionesDe } from "@celda/dominio/filtro";
import type { ProvinciaDelResumen, ResumenLeido } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";

import type { EstadoProvincia } from "../capa/nacional.ts";
import {
  FICHERO_DE_PUNTOS_DE_PRUEBA,
  FUENTE_DE_BARRIOS,
  FUENTES_DE_PRUEBA,
  provinciaDePrueba,
  puntosDePrueba,
} from "../capa/pruebas.ts";
import { cuentaDelSitio, textoDeCuenta } from "./cuenta.ts";

const emplazamiento = (
  clave: string,
  municipio: string,
  companias: EmplazamientoLeido["companias"],
): EmplazamientoLeido => ({
  clave,
  posicion: { longitud: 2 + clave.length / 1000, latitud: 41.4 },
  estado: "verificado",
  companias,
  barrio: null,
  lote: 0,
  provincia: municipio.slice(0, 2),
  municipio,
});

const EN_BARCELONA = [
  emplazamiento("m1", "08019", ["movistar"]),
  emplazamiento("mo2", "08019", ["movistar", "orange"]),
  emplazamiento("d33", "08019", ["digi"]),
  emplazamiento("v444", "08101", ["vodafone"]),
];

const provincia = (
  codigo: string,
  nombre: string,
  emplazamientos: ReadonlyArray<EmplazamientoLeido>,
  cubierta: boolean,
): ProvinciaDelResumen => ({
  codigo,
  nombre,
  etiqueta: { longitud: 2, latitud: 41.5 },
  caja: undefined,
  emplazamientos: emplazamientos.length,
  companias: [],
  cubierta,
  barrido: null,
  fichero: emplazamientos.length === 0 ? undefined : `provincias/${codigo}/prueba.json`,
  combinaciones: combinacionesDe(emplazamientos),
});

const RESUMEN: ResumenLeido = {
  version: "sitios@2026-10-08T02:00:00Z",
  fecha: Date.UTC(2026, 9, 8, 2),
  fuentes: FUENTES_DE_PRUEBA,
  cobertura: [],
  provincias: [
    provincia("08", "Barcelona", EN_BARCELONA, true),
    provincia("22", "Huesca", [emplazamiento("h", "22125", ["orange"])], false),
    provincia("42", "Soria", [], false),
  ],
  puntos: FICHERO_DE_PUNTOS_DE_PRUEBA,
};
const PUNTOS = puntosDePrueba([{ codigo: "08", emplazamientos: EN_BARCELONA }]).puntos;

const SIN_NADA = { resumen: RESUMEN, puntos: undefined, provincias: new Map(), filtro: [] };

describe("cuántos emplazamientos tiene el sitio que se mira", () => {
  it("España y una provincia salen del resumen, y siguen al filtro de compañías", () => {
    assert.deepStrictEqual(cuentaDelSitio({ tipo: "espana", nombre: "España" }, SIN_NADA), {
      cuantos: 5,
      parcial: true,
    });
    const barcelona = { tipo: "provincia", nombre: "Barcelona", codigo: "08" } as const;
    assert.deepStrictEqual(cuentaDelSitio(barcelona, SIN_NADA), { cuantos: 4, parcial: false });
    // Con Digi, los de Movistar salen por la red que usa, pero no cuentan, como en los hexágonos.
    assert.deepStrictEqual(cuentaDelSitio(barcelona, { ...SIN_NADA, filtro: ["digi"] }), {
      cuantos: 1,
      parcial: false,
    });
  });

  it("de una provincia a medias dice que es solo una parte, y de una sin nada no dice nada", () => {
    const huesca = { tipo: "provincia", nombre: "Huesca", codigo: "22" } as const;
    assert.strictEqual(
      textoDeCuenta(cuentaDelSitio(huesca, SIN_NADA) ?? assert.fail("sin cuenta")),
      "1 emplazamiento, solo una parte",
    );
    const soria = { tipo: "provincia", nombre: "Soria", codigo: "42" } as const;
    assert.isUndefined(cuentaDelSitio(soria, SIN_NADA));
  });

  it("un municipio sale de los puntos o, sin ellos, de la capa de su provincia si ha llegado", () => {
    const barcelona = { tipo: "municipio", nombre: "Barcelona", codigo: "08019" } as const;
    assert.isUndefined(cuentaDelSitio(barcelona, SIN_NADA));
    assert.deepStrictEqual(cuentaDelSitio(barcelona, { ...SIN_NADA, puntos: PUNTOS }), {
      cuantos: 3,
      parcial: false,
    });
    const lista: EstadoProvincia = {
      tipo: "lista",
      provincia: provinciaDePrueba({
        version: RESUMEN.version,
        fecha: RESUMEN.fecha,
        emplazamientos: EN_BARCELONA,
        barrios: [],
        fuenteDeBarrios: FUENTE_DE_BARRIOS,
      }),
    };
    const conCapa = {
      ...SIN_NADA,
      provincias: new Map([["08", lista]]),
      filtro: ["orange" as const],
    };
    assert.deepStrictEqual(cuentaDelSitio(barcelona, conCapa), { cuantos: 1, parcial: false });
  });

  it("se escribe con el punto de los miles también con cuatro cifras", () => {
    assert.strictEqual(textoDeCuenta({ cuantos: 2905, parcial: false }), "2.905 emplazamientos");
    assert.strictEqual(textoDeCuenta({ cuantos: 0, parcial: false }), "0 emplazamientos");
  });
});
