// Graba el listado del registro oficial en tres ciudades para revisar la fusión (ticket 49).
// Pide directamente las hojas del teselado del 26/09 (Barcelona) y del 28/09 (Madrid): se sabe
// que la caja madre llega al tope, así que pedirla otra vez no aporta nada.
// Una petición cada 4 s como poco, User-Agent de Celda, tope duro de 10 listados.
// Uso: node muestra-fusion.mjs <carpeta de salida>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "Celda (investigación; contacto en celda.elies.site)";
const PAUSA = 4000;
const TOPE_LISTADOS = 10;
const ORIGEN = "https://geoportal.minetur.gob.es";
const url = (c) =>
  `${ORIGEN}/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=${c.map((g) => g.toFixed(6)).join(",")}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Las hojas, con los mismos números que dio la división en cuatro.
const CAJAS = {
  // Caja de Barcelona del ADR 0012: 2.052,41.317,2.229,41.468 partida en cuatro.
  barcelona: [
    [2.052, 41.317, 2.1405, 41.3925],
    [2.1405, 41.317, 2.229, 41.3925],
    [2.052, 41.3925, 2.1405, 41.468],
    [2.1405, 41.3925, 2.229, 41.468],
  ],
  // Centro de Madrid: las cinco hojas contiguas más densas del muestreo del 28/09, de Moncloa a
  // Ciudad Lineal y de Arganzuela a Chamartín (-3,7975..-3,6125, 40,395..40,48).
  madrid: [
    [-3.7975, 40.395, -3.705, 40.48],
    [-3.705, 40.395, -3.65875, 40.4375],
    [-3.65875, 40.395, -3.6125, 40.4375],
    [-3.705, 40.4375, -3.65875, 40.48],
    [-3.65875, 40.4375, -3.6125, 40.48],
  ],
  // Centro de Valencia, una sola caja que debería quedar por debajo del tope.
  valencia: [[-0.405, 39.445, -0.335, 39.495]],
};

const salida = process.argv[2];
if (salida === undefined) throw new Error("falta la carpeta de salida");
mkdirSync(salida, { recursive: true });

let listados = 0;
let ultima = 0;
const pedir = async (u) => {
  const falta = ultima + PAUSA - Date.now();
  if (falta > 0) await esperar(falta);
  const t0 = Date.now();
  const r = await fetch(u, { headers: { "user-agent": UA } });
  const bytes = new Uint8Array(await r.arrayBuffer());
  ultima = Date.now();
  return { estado: r.status, bytes, s: (ultima - t0) / 1000 };
};

const inicio = new Date().toISOString();
const robots = await pedir(`${ORIGEN}/robots.txt`);
process.stderr.write(`robots.txt: HTTP ${robots.estado}\n`);
const registro = [];
for (const [ciudad, cajas] of Object.entries(CAJAS)) {
  for (const [i, caja] of cajas.entries()) {
    if (listados >= TOPE_LISTADOS) throw new Error("tope de listados");
    listados++;
    const r = await pedir(url(caja));
    const fichero = `${ciudad}-${i}.iso-8859-1.json`;
    writeFileSync(join(salida, fichero), r.bytes);
    const texto = new TextDecoder("latin1").decode(r.bytes);
    const n = r.estado === 200 ? (JSON.parse(texto).features ?? []).length : -1;
    registro.push({ ciudad, caja, estado: r.estado, n, bytes: r.bytes.length, s: r.s, fichero });
    process.stderr.write(`${listados} ${ciudad} ${i} HTTP ${r.estado} n=${n} ${r.bytes.length} B ${r.s}s\n`);
  }
}
writeFileSync(
  join(salida, "registro.json"),
  JSON.stringify(
    { inicio, fin: new Date().toISOString(), userAgent: UA, pausaMs: PAUSA, robots: robots.estado, listados, registro },
    null,
    1,
  ),
);
