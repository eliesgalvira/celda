import {
  PARAMETROS_POR_DEFECTO,
  resolverEjercicio,
  type EntradaDelEjercicio,
} from "@celda/dominio/ejercicio";
import { assert, describe, it } from "@effect/vitest";

import { FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { csvDeTabla, filasExportadas, nombreDeFichero, tablaDelEjercicio } from "./tabla.ts";
import { crc32, letraDeColumna, xlsxDeFilas } from "./xlsx.ts";

const ENTRADA: EntradaDelEjercicio = {
  habitantes: 12_479,
  areaKm2: 2.6826,
  enZona: [
    { clave: "a", posicion: { longitud: 2.11, latitud: 41.39 }, companias: ["movistar"] },
    { clave: "b", posicion: { longitud: 2.12, latitud: 41.39 }, companias: ["movistar", "orange"] },
  ],
  todos: [],
  bandas: new Map([["a", { movistar: [800, 3500] }]]),
  parametros: PARAMETROS_POR_DEFECTO,
};

const CONTEXTO = {
  zona: "Pedralbes",
  poblacion: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/pad_mdbas",
    referencia: "2026-01-01",
    publicada: "2026-05-28",
  },
  limites: FUENTE_DE_BARRIOS,
  fechaCapa: Date.UTC(2026, 8, 25, 23, 44, 53),
  parametros: PARAMETROS_POR_DEFECTO,
  fechaBandas: Date.UTC(2026, 8, 26, 10),
};

const tabla = () => tablaDelEjercicio(resolverEjercicio(ENTRADA), CONTEXTO, PARAMETROS_POR_DEFECTO);

const fila = (magnitud: string) => {
  const encontrada = tabla()
    .secciones.flatMap((s) => s.filas)
    .find((f) => f.magnitud === magnitud);
  if (encontrada === undefined) throw new Error(`falta la fila ${magnitud}`);
  return encontrada;
};

describe("tabla del ejercicio", () => {
  it("cada fila dice de dónde sale y de qué fecha es", () => {
    for (const seccion of tabla().secciones) {
      for (const { magnitud, fuente, fecha } of seccion.filas) {
        assert.isNotEmpty(fuente, magnitud);
        assert.match(fecha, /^\d{4}-\d{2}-\d{2}$/u, magnitud);
      }
    }
    assert.match(fila("Habitantes").fuente, /Padrón municipal a 2026-01-01.*CC BY 4\.0/u);
    assert.strictEqual(fila("Habitantes").fecha, "2026-05-28");
    assert.match(fila("Penetración").fuente, /CNMC.*julio de 2026/u);
    assert.strictEqual(fila("Estaciones base en la zona").fecha, "2026-09-26");
  });

  it("con parámetros cambiados a mano no cita a la CNMC", () => {
    const propios = { ...PARAMETROS_POR_DEFECTO, penetracion: 110 };
    const cambiada = tablaDelEjercicio(
      resolverEjercicio({ ...ENTRADA, parametros: propios }),
      { ...CONTEXTO, parametros: propios },
      PARAMETROS_POR_DEFECTO,
    );
    const penetracion = cambiada.secciones[0]?.filas.find((f) => f.magnitud === "Penetración");
    assert.strictEqual(penetracion?.fuente, "Valor puesto a mano en el ejercicio");
  });

  it("las tecnologías y las bandas nunca se afirman sin fichas", () => {
    // Movistar: una ficha con bandas y otra sin leer. Orange: ninguna leída.
    assert.deepStrictEqual(
      fila("5G").valores.map((v) => v.texto),
      ["probable", "—", "no consta", "—", "—"],
    );
    assert.deepStrictEqual(
      fila("1800 MHz").valores.map((v) => v.texto),
      ["no consta", "—", "no consta", "—", "—"],
    );
    assert.strictEqual(fila("800 MHz").valores[0]?.texto, "sí");
  });

  it("el CSV se abre en una hoja de cálculo en castellano", () => {
    const csv = csvDeTabla(tabla());
    assert.isTrue(csv.startsWith("﻿Sección;Magnitud;Unidad;Movistar;Vodafone;Orange;Digi;Yoigo"));
    const lineas = csv.split("\r\n");
    assert.include(
      lineas,
      "Zona;Habitantes;;12479;;;;;Padrón municipal a 2026-01-01, Ajuntament de Barcelona (Open Data BCN, CC BY 4.0);2026-05-28",
    );
    assert.include(lineas, "Zona;Área;km²;2,68;;;;;Calculada con los límites de barrio;2024-11-12");
    assert.isTrue(csv.endsWith("\r\n"));
  });

  it("escapa en el CSV los textos con punto y coma o comillas", () => {
    const csv = csvDeTabla({
      titulo: "t",
      companias: ["movistar"],
      secciones: [
        {
          titulo: "S",
          filas: [
            { magnitud: 'a;"b"', valores: [{ texto: "x" }], fuente: "f", fecha: "2026-01-01" },
          ],
        },
      ],
    });
    assert.include(csv, 'S;"a;""b""";;x;f;2026-01-01');
  });

  it("el nombre del fichero no lleva tildes ni espacios", () => {
    assert.strictEqual(
      nombreDeFichero("Vallvidrera, el Tibidabo i les Planes"),
      "estaciones-base-vallvidrera-el-tibidabo-i-les-planes",
    );
    assert.strictEqual(
      nombreDeFichero("Sant Martí de Provençals"),
      "estaciones-base-sant-marti-de-provencals",
    );
  });
});

/** Las entradas de un ZIP sin comprimir, leyendo sus cabeceras locales en orden. */
const leerZip = (zip: Uint8Array): ReadonlyMap<string, string> => {
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decodificar = new TextDecoder();
  const entradas = new Map<string, string>();
  let i = 0;
  while (vista.getUint32(i, true) === 0x04_03_4b_50) {
    const tamano = vista.getUint32(i + 18, true);
    const largoNombre = vista.getUint16(i + 26, true);
    const nombre = decodificar.decode(zip.subarray(i + 30, i + 30 + largoNombre));
    const datos = zip.subarray(i + 30 + largoNombre, i + 30 + largoNombre + tamano);
    assert.strictEqual(vista.getUint32(i + 14, true), crc32(datos), `CRC de ${nombre}`);
    entradas.set(nombre, decodificar.decode(datos));
    i += 30 + largoNombre + tamano;
  }
  return entradas;
};

describe("XLSX", () => {
  it("calcula el CRC-32 del ZIP", () => {
    assert.strictEqual(crc32(new TextEncoder().encode("123456789")), 0xcb_f4_39_26);
  });

  it("nombra las columnas como una hoja de cálculo", () => {
    assert.deepStrictEqual([0, 25, 26, 27, 701].map(letraDeColumna), ["A", "Z", "AA", "AB", "ZZ"]);
  });

  it("guarda la tabla en una hoja, con los números como números y los textos escapados", () => {
    const zip = xlsxDeFilas("Pedralbes", filasExportadas(tabla()));
    const entradas = leerZip(zip);
    assert.deepStrictEqual(
      [...entradas.keys()],
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
      ],
    );
    assert.include(entradas.get("xl/workbook.xml"), '<sheet name="Pedralbes"');
    const hoja = entradas.get("xl/worksheets/sheet1.xml") ?? "";
    assert.include(hoja, '<c r="D4"><v>12479</v></c>');
    assert.include(hoja, '<t xml:space="preserve">Radio de cobertura</t>');
    assert.include(
      leerZip(xlsxDeFilas("x", [[{ texto: "a < b & c" }]])).get("xl/worksheets/sheet1.xml"),
      "a &lt; b &amp; c",
    );
  });
});
