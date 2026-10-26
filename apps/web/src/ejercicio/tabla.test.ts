import {
  PARAMETROS_POR_DEFECTO,
  resolverEjercicio,
  type EntradaDelEjercicio,
} from "@celda/dominio/ejercicio";
import { assert, describe, it } from "@effect/vitest";

import { FUENTE_DE_BARRIOS, FUENTES_DE_PRUEBA } from "../capa/pruebas.ts";
import { type ContextoDeTabla, csvDeTabla, nombreDeFichero, tablaDelEjercicio } from "./tabla.ts";

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

const CONTEXTO: ContextoDeTabla = {
  zona: "Pedralbes",
  origen: {
    tipo: "barrio",
    limites: FUENTE_DE_BARRIOS,
    poblacion: {
      atribucion: "Ajuntament de Barcelona",
      licencia: "CC BY 4.0",
      enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/pad_mdbas",
      referencia: "2026-01-01",
      publicada: "2026-05-28",
    },
  },
  fechaCapa: Date.UTC(2026, 8, 25, 23, 44, 53),
  parametros: PARAMETROS_POR_DEFECTO,
  bandas: { de: "fichas", fecha: Date.UTC(2026, 8, 26, 10) },
};

/** El mismo ejercicio en un municipio, con los límites del IGN y el padrón del INE. */
const EN_TORDERA: ContextoDeTabla = {
  ...CONTEXTO,
  zona: "Tordera (Barcelona)",
  origen: {
    tipo: "municipio",
    codigo: "08284",
    limites: FUENTES_DE_PRUEBA.municipios,
    poblacion: FUENTES_DE_PRUEBA.padron,
  },
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
    assert.match(fila("Habitantes").fuente, /Padrón a 2026-01-01.*CC BY 4\.0/u);
    assert.strictEqual(fila("Habitantes").fecha, "2026-05-28");
    assert.match(fila("Penetración").fuente, /CNMC.*julio de 2026/u);
    assert.strictEqual(fila("Estaciones base en la zona").fecha, "2026-09-26");
  });

  it("en un municipio cita al IGN y al INE como piden, con el código del municipio", () => {
    const filas = tablaDelEjercicio(
      resolverEjercicio(ENTRADA),
      EN_TORDERA,
      PARAMETROS_POR_DEFECTO,
    ).secciones.flatMap((s) => s.filas);
    const deMagnitud = (magnitud: string) => filas.find((f) => f.magnitud === magnitud);
    assert.strictEqual(
      deMagnitud("Zona")?.fuente,
      "Obra derivada de Base de Datos de Límites Jurisdiccionales de España 2026-08-10 CC-BY 4.0 ign.es",
    );
    assert.strictEqual(deMagnitud("Código INE")?.valores[0]?.texto, "08284");
    assert.strictEqual(
      deMagnitud("Habitantes")?.fuente,
      "Padrón a 2025-01-01, INE (CC BY 4.0). Elaboración propia con datos extraídos del sitio web del INE: www.ine.es",
    );
    assert.strictEqual(deMagnitud("Habitantes")?.fecha, "2025-12-11");
    assert.strictEqual(
      deMagnitud("Área")?.fuente,
      "Calculada con los límites del IGN sin simplificar",
    );
  });

  it("sin habitantes en el padrón, la tabla lo dice y deja en blanco lo que depende de ellos", () => {
    const filas = tablaDelEjercicio(
      resolverEjercicio({ ...ENTRADA, habitantes: null }),
      EN_TORDERA,
      PARAMETROS_POR_DEFECTO,
    ).secciones.flatMap((s) => s.filas);
    const deMagnitud = (magnitud: string) => filas.find((f) => f.magnitud === magnitud);
    assert.strictEqual(deMagnitud("Habitantes")?.valores[0]?.texto, "—");
    assert.match(deMagnitud("Habitantes")?.fuente ?? "", /El padrón aún no tiene esta zona$/u);
    assert.strictEqual(deMagnitud("Densidad")?.valores[0]?.texto, "—");
    assert.strictEqual(deMagnitud("Usuarios por estación base")?.valores[0]?.texto, "—");
    assert.strictEqual(deMagnitud("Estaciones base en la zona")?.valores[0]?.texto, "2");
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
      "Zona;Habitantes;;12479;;;;;Padrón a 2026-01-01, Ajuntament de Barcelona (CC BY 4.0);2026-05-28",
    );
    assert.include(lineas, "Zona;Área;km²;2,68;;;;;Calculada con los límites;2024-11-12");
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
