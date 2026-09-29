// Saca de una publicación en carpeta la muestra de las pruebas del ejercicio en municipios
// (`packages/dominio/src/ejercicioMunicipios.test.ts`). De cada municipio guarda sus emplazamientos
// y, de las demás, solo los que pueden ser la vecina de alguno: los de la misma compañía que no
// quedan más lejos que su vecina de la propia provincia. Así el radio sale igual que con todas.
//
//   node docs/investigacion/muestras/ejercicio/extraer.ts <carpeta de la publicación> > muestra.json
//
// Se lanza desde la raíz de Celda, que es donde Node encuentra `effect`. La del repositorio sale de la primera pasada real de Cataluña (investigación 08, 28/09/2026).
import { readFileSync } from "node:fs";

import { distanciaMetros } from "../../../../packages/dominio/src/area.ts";
import { Compania } from "../../../../packages/dominio/src/compania.ts";
import type { EmplazamientoLeido } from "../../../../packages/dominio/src/capa.ts";
import {
  leerCapaDeProvincia,
  leerResumen,
} from "../../../../packages/dominio/src/provincias.ts";

/** Grande, pequeño, sin emplazamientos, junto al borde de Girona y junto a Castellón. */
const MUNICIPIOS = ["08019", "17043", "17025", "08284", "43004"];

const carpeta = process.argv[2] ?? ".";
const vigente = JSON.parse(readFileSync(`${carpeta}/vigente.json`, "utf8"));
const resumen = leerResumen(readFileSync(`${carpeta}/${vigente.resumen}`, "utf8"), vigente.version);
if (resumen._tag === "Failure") throw new Error(resumen.failure.message);
const capas = new Map(
  resumen.success.provincias.flatMap((p) => {
    if (p.fichero === undefined) return [];
    const capa = leerCapaDeProvincia(readFileSync(`${carpeta}/${p.fichero}`, "utf8"), p.codigo);
    if (capa._tag === "Failure") throw new Error(capa.failure.message);
    return [[p.codigo, capa.success] as const];
  }),
);
const todos = [...capas.values()].flatMap((c) => c.emplazamientos);

const elegidos = new Map<string, EmplazamientoLeido>();
const municipios = MUNICIPIOS.map((codigo) => {
  const provincia = codigo.slice(0, 2);
  const capa = capas.get(provincia);
  const municipio = capa?.municipios.find((m) => m.codigo === codigo);
  if (capa === undefined || municipio === undefined) throw new Error(`falta ${codigo}`);
  const enZona = capa.emplazamientos.filter((e) => e.municipio === codigo);
  for (const e of enZona) elegidos.set(e.clave, e);
  for (const compania of Compania.literals) {
    const suyas = todos.filter((e) => e.companias.includes(compania));
    const propiaProvincia = suyas.filter((e) => e.provincia === provincia);
    for (const estacion of enZona.filter((e) => e.companias.includes(compania))) {
      const distancias = (lista: ReadonlyArray<EmplazamientoLeido>) =>
        lista
          .filter((e) => e.clave !== estacion.clave)
          .map((e) => distanciaMetros(estacion.posicion, e.posicion));
      const propia = Math.min(...distancias(propiaProvincia));
      const alcance = Number.isFinite(propia) ? propia : Math.min(...distancias(suyas));
      for (const e of suyas) {
        if (distanciaMetros(estacion.posicion, e.posicion) <= alcance + 1) elegidos.set(e.clave, e);
      }
    }
  }
  return {
    codigo,
    nombre: municipio.nombre,
    habitantes: municipio.habitantes,
    areaKm2: municipio.areaKm2,
  };
});

const fila = (e: EmplazamientoLeido) =>
  JSON.stringify([
    e.clave,
    e.provincia,
    e.municipio,
    e.posicion.longitud,
    e.posicion.latitud,
    e.companias,
    Object.fromEntries((e.bandas ?? []).map((b) => [b.compania, b.mhz])),
  ]);

const lineas = [...elegidos.values()]
  .sort((a, b) => (a.clave < b.clave ? -1 : 1))
  .map(fila)
  .join(",\n");
const provincias = resumen.success.provincias.map((p) => ({
  codigo: p.codigo,
  nombre: p.nombre,
  caja:
    p.caja === undefined
      ? null
      : [p.caja.suroeste.longitud, p.caja.suroeste.latitud, p.caja.noreste.longitud, p.caja.noreste.latitud],
  companias: p.companias,
  cubierta: p.cubierta,
  conCapa: p.fichero !== undefined,
}));

process.stdout.write(
  `{"version":${JSON.stringify(resumen.success.version)},` +
    `"padron":${JSON.stringify(resumen.success.fuentes.padron)},\n` +
    `"provincias":[\n${provincias.map((p) => JSON.stringify(p)).join(",\n")}\n],\n` +
    `"municipios":[\n${municipios.map((m) => JSON.stringify(m)).join(",\n")}\n],\n` +
    `"emplazamientos":[\n${lineas}\n]}\n`,
);
