// Junta las respuestas de `muestra-fusion.mjs` de una ciudad en un listado compacto en UTF-8:
// solo los campos que lee el normalizador (`id`, coordenadas, `Gis_ID` y `Dirección`), un
// elemento por línea y sin repetir los que salen en el borde de dos cajas.
// Uso: node compactar-muestra.mjs <carpeta de respuestas> <ciudad> <fichero de salida>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [carpeta, ciudad, salida] = process.argv.slice(2);
if (salida === undefined) throw new Error("uso: compactar-muestra.mjs <carpeta> <ciudad> <salida>");
const registro = JSON.parse(readFileSync(join(carpeta, "registro.json"), "utf8"));
const peticiones = registro.registro.filter((r) => r.ciudad === ciudad);
const elementos = new Map();
for (const { fichero } of peticiones) {
  const json = JSON.parse(new TextDecoder("latin1").decode(readFileSync(join(carpeta, fichero))));
  for (const e of json.features ?? []) {
    elementos.set(e.id, {
      id: e.id,
      geometry: { coordinates: e.geometry.coordinates },
      properties: { Gis_ID: e.properties.Gis_ID, Dirección: e.properties["Dirección"] },
    });
  }
}
const ordenados = [...elementos.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const cabecera = {
  fuente: "https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do",
  consultado: registro.inicio.slice(0, 10),
  userAgent: registro.userAgent,
  cajas: peticiones.map(({ caja, n }) => ({ caja, elementos: n })),
};
const lineas = ordenados.map((e) => JSON.stringify(e));
writeFileSync(
  salida,
  `${JSON.stringify(cabecera).slice(0, -1)},"features":[\n${lineas.join(",\n")}\n]}\n`,
);
process.stderr.write(`${ciudad}: ${ordenados.length} elementos de ${peticiones.length} cajas\n`);
