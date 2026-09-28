// Muestreo del listado del registro oficial (Infoantenas) en cajas de distinto tipo.
// Una petición cada 4 s como poco, User-Agent de Celda, tope duro de 78 peticiones.
import { writeFileSync, mkdirSync } from "node:fs";

const UA = "Celda (investigación; contacto en celda.elies.site)";
const PAUSA = 4000;
const TOPE_PETICIONES = 78;
const ORIGEN = "https://geoportal.minetur.gob.es";
const url = (c) => `${ORIGEN}/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=${c.map((g) => g.toFixed(6)).join(",")}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cuatro = ([w, s, e, n]) => { const x = (w + e) / 2, y = (s + n) / 2; return [[w, s, x, y], [x, s, e, y], [w, y, x, n], [x, y, e, n]]; };

let hechas = 0;
let ultima = 0;
const registro = [];
const pedir = async (u) => {
  if (hechas >= TOPE_PETICIONES) throw new Error("tope de peticiones");
  const falta = ultima + PAUSA - Date.now();
  if (falta > 0) await esperar(falta);
  hechas++;
  const t0 = Date.now();
  const r = await fetch(u, { headers: { "user-agent": UA } });
  const buf = new Uint8Array(await r.arrayBuffer());
  const s = (Date.now() - t0) / 1000;
  ultima = Date.now();
  const cabeceras = Object.fromEntries([...r.headers.entries()].filter(([k]) => /etag|last-modified|cache|encoding|type|length/i.test(k)));
  return { estado: r.status, texto: new TextDecoder("latin1").decode(buf), bytes: buf.length, s, cabeceras };
};

const caja = async (c, prof, ids, nombre) => {
  const u = url(c);
  const r = await pedir(u);
  if (r.estado !== 200) throw new Error(`HTTP ${r.estado} en ${u}`);
  const json = JSON.parse(r.texto);
  const feats = json.features ?? [];
  registro.push({ nombre, bbox: c, prof, n: feats.length, bytes: r.bytes, s: r.s, cabeceras: hechas === 1 ? r.cabeceras : undefined });
  process.stderr.write(`${hechas} ${nombre} prof ${prof} n=${feats.length} ${r.bytes} B ${r.s}s\n`);
  if (feats.length < 1000) {
    for (const f of feats) ids.set(f.id, { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], op: f.id.slice(0, f.id.lastIndexOf(" - ")), dir: f.properties["Dirección"] });
    return;
  }
  if (prof >= 7) throw new Error("demasiado profundo");
  for (const h of cuatro(c)) await caja(h, prof + 1, ids, nombre);
};

const CAJAS = [
  ["Soria (caja)", [-3.55, 41.05, -1.77, 42.15]],
  ["Lugo (caja)", [-7.95, 42.35, -6.83, 43.8]],
  ["Tenerife", [-16.95, 27.98, -16.1, 28.6]],
  ["Valladolid (caja)", [-5.62, 41.08, -3.95, 42.35]],
  ["Badajoz (caja)", [-7.6, 37.95, -4.65, 39.47]],
  ["Navarra (caja)", [-2.5, 41.9, -0.72, 43.32]],
  ["Málaga (caja)", [-5.62, 36.28, -3.75, 37.3]],
  ["Madrid municipio (caja)", [-3.89, 40.31, -3.52, 40.65]],
];

mkdirSync("/tmp/celda-espana/red/registro", { recursive: true });
const inicio = new Date().toISOString();
// robots.txt primero, como el extractor.
const robots = await pedir(`${ORIGEN}/robots.txt`);
process.stderr.write(`robots.txt: HTTP ${robots.estado}\n`);
const resultados = {};
for (const [nombre, c] of CAJAS) {
  const ids = new Map();
  try {
    await caja(c, 0, ids, nombre);
    resultados[nombre] = { bbox: c, registros: ids.size, completa: true };
  } catch (e) {
    resultados[nombre] = { bbox: c, registros: ids.size, completa: false, error: String(e) };
    process.stderr.write(`parada: ${e}\n`);
  }
  writeFileSync(`/tmp/celda-espana/red/registro/${nombre.replace(/[^a-z]/gi, "_")}.json`, JSON.stringify([...ids.entries()]));
  if (hechas >= TOPE_PETICIONES) break;
}
writeFileSync("/tmp/celda-espana/red/registro/muestreo.json", JSON.stringify({ inicio, fin: new Date().toISOString(), userAgent: UA, pausaMs: PAUSA, peticiones: hechas, robots: robots.estado, resultados, registro }, null, 1));
console.log(JSON.stringify({ peticiones: hechas, resultados }, null, 1));
