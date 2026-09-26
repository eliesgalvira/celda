import type { Celda } from "./tabla.ts";

/**
 * Un libro XLSX de una hoja, escrito a mano sin dependencias: cinco ficheros XML de Office Open
 * XML (ECMA-376) dentro de un ZIP sin comprimir. Los números van como números y los textos, en
 * línea. Es lo mínimo que abren Excel, LibreOffice y Google Sheets.
 */

const TABLA_CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** El CRC-32 del ZIP (polinomio 0xEDB88320). */
export const crc32 = (datos: Uint8Array): number => {
  let crc = 0xff_ff_ff_ff;
  for (const byte of datos) crc = (TABLA_CRC[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};

interface Entrada {
  readonly nombre: string;
  readonly datos: Uint8Array;
}

/** Un ZIP con las entradas guardadas tal cual (método 0), con fecha fija para que sea estable. */
export const zipSinComprimir = (entradas: ReadonlyArray<Entrada>): Uint8Array<ArrayBuffer> => {
  const codificador = new TextEncoder();
  const partes: Array<Uint8Array> = [];
  const centrales: Array<Uint8Array> = [];
  let desplazamiento = 0;
  // 1 de enero de 2026 a las 00:00 en formato MS-DOS.
  const hora = 0;
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const entrada of entradas) {
    const nombre = codificador.encode(entrada.nombre);
    const crc = crc32(entrada.datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04_03_4b_50, true);
    local.setUint16(4, 20, true);
    // Bit 11: el nombre va en UTF-8.
    local.setUint16(6, 0x08_00, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entrada.datos.length, true);
    local.setUint32(22, entrada.datos.length, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, entrada.datos);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02_01_4b_50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x08_00, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, fecha, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entrada.datos.length, true);
    central.setUint32(24, entrada.datos.length, true);
    central.setUint16(28, nombre.length, true);
    central.setUint32(42, desplazamiento, true);
    centrales.push(new Uint8Array(central.buffer), nombre);
    desplazamiento += 30 + nombre.length + entrada.datos.length;
  }
  const tamanoCentral = centrales.reduce((suma, parte) => suma + parte.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06_05_4b_50, true);
  fin.setUint16(8, entradas.length, true);
  fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, desplazamiento, true);
  const todo = [...partes, ...centrales, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((suma, parte) => suma + parte.length, 0));
  let posicion = 0;
  for (const parte of todo) {
    salida.set(parte, posicion);
    posicion += parte.length;
  }
  return salida;
};

const escaparXml = (texto: string): string =>
  texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** La letra de una columna: 0 es A, 25 es Z, 26 es AA. */
export const letraDeColumna = (indice: number): string => {
  let resto = indice + 1;
  let letras = "";
  while (resto > 0) {
    const m = (resto - 1) % 26;
    letras = String.fromCodePoint(65 + m) + letras;
    resto = Math.floor((resto - 1) / 26);
  }
  return letras;
};

const celdaXml = (celda: Celda, referencia: string): string => {
  if (celda.numero !== undefined) return `<c r="${referencia}"><v>${celda.numero}</v></c>`;
  if (celda.texto === "") return "";
  return `<c r="${referencia}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(celda.texto)}</t></is></c>`;
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const HOJA = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELACIONES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PAQUETE = "http://schemas.openxmlformats.org/package/2006/relationships";

/** El libro con una hoja llamada `nombreHoja` y estas filas. */
export const xlsxDeFilas = (
  nombreHoja: string,
  filas: ReadonlyArray<ReadonlyArray<Celda>>,
): Uint8Array<ArrayBuffer> => {
  const codificar = (texto: string) => new TextEncoder().encode(texto);
  const datos = filas
    .map(
      (fila, i) =>
        `<row r="${i + 1}">${fila.map((celda, j) => celdaXml(celda, `${letraDeColumna(j)}${i + 1}`)).join("")}</row>`,
    )
    .join("");
  // Excel no admite más de 31 caracteres ni algunos signos en el nombre de la hoja.
  const hoja = escaparXml(nombreHoja.replace(/[\\/?*[\]:]/gu, " ").slice(0, 31));
  return zipSinComprimir([
    {
      nombre: "[Content_Types].xml",
      datos: codificar(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      ),
    },
    {
      nombre: "_rels/.rels",
      datos: codificar(
        `${XML}<Relationships xmlns="${PAQUETE}">` +
          `<Relationship Id="rId1" Type="${RELACIONES}/officeDocument" Target="xl/workbook.xml"/>` +
          "</Relationships>",
      ),
    },
    {
      nombre: "xl/workbook.xml",
      datos: codificar(
        `${XML}<workbook xmlns="${HOJA}" xmlns:r="${RELACIONES}">` +
          `<sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      datos: codificar(
        `${XML}<Relationships xmlns="${PAQUETE}">` +
          `<Relationship Id="rId1" Type="${RELACIONES}/worksheet" Target="worksheets/sheet1.xml"/>` +
          "</Relationships>",
      ),
    },
    {
      nombre: "xl/worksheets/sheet1.xml",
      datos: codificar(
        `${XML}<worksheet xmlns="${HOJA}"><sheetData>${datos}</sheetData></worksheet>`,
      ),
    },
  ]);
};
