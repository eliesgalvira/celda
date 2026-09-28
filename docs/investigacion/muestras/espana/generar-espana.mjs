// Datos para medir la capa a escala España (exploración de la ampliación, desechable).
//   es-100k  sintético, el mismo que `sitiosEspana` de generar-datos.mjs (semilla 11)
//   es-real  las posiciones reales de los 42.855 marcadores de antenasmoviles.es (showf?er5, 28/09/2026)
// Salidas en data/capas/:
//   <ds>.json                 capa única por columnas (variante a)
//   <ds>-prov/<cpro>.json      una capa por provincia (variante b)
//   <ds>-resumen.json          resumen nacional: por provincia, etiqueta, número y compañías (variante b)
//   <ds>.geojsonl             entrada de tippecanoe (variante c)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

const aqui = (p) => new URL(`../${p}`, import.meta.url).pathname;
mkdirSync(aqui("data/capas"), { recursive: true });
const VERSION = "sitios@2026-09-28T02:15:00Z";

let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const bits = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
function opsMask() {
  const r = rnd();
  const n = r < 0.68 ? 1 : r < 0.9 ? 2 : r < 0.98 ? 3 : 4;
  const w = [0.34, 0.24, 0.3, 0.12];
  let m = 0;
  while (bits(m) < n) { let t = rnd(), k = 0; while (t > w[k] && k < 3) t -= w[k++]; m |= 1 << k; }
  return m;
}
const estado = () => { const r = rnd(); return r < 0.86 ? 0 : r < 0.94 ? 1 : 2; };
const CIUDADES = [[-3.70, 40.42, 14], [2.17, 41.39, 10], [-0.38, 39.47, 5], [-5.98, 37.39, 5], [-0.88, 41.65, 4], [-4.42, 36.72, 4], [-1.13, 37.99, 3], [2.65, 39.57, 3], [-15.43, 28.12, 3], [-2.93, 43.26, 4], [-4.72, 41.65, 2], [-8.72, 42.24, 3], [-5.66, 43.54, 2], [-8.41, 43.36, 2], [-3.60, 37.18, 2], [-0.48, 38.35, 3], [-6.97, 38.88, 1], [-1.64, 42.81, 2], [-3.81, 43.46, 2], [-2.45, 36.84, 2], [2.82, 41.98, 1], [1.25, 41.12, 2], [0.62, 41.62, 1], [-16.25, 28.46, 2], [-4.78, 37.88, 2], [-6.29, 36.53, 2], [-2.67, 42.85, 1], [-5.57, 42.60, 1], [-8.55, 42.88, 1], [-3.92, 38.99, 1], [-4.03, 39.86, 1], [-3.17, 41.84, 0.5], [-1.86, 38.99, 1], [-2.13, 40.07, 0.5], [-6.37, 39.47, 0.7], [-7.86, 42.34, 0.7], [-7.55, 43.01, 0.7], [-2.46, 42.47, 1], [-0.04, 39.99, 1.5], [2.01, 41.56, 2], [2.11, 41.54, 2], [2.1, 41.36, 3], [-3.72, 40.3, 3], [-3.88, 40.34, 2], [-3.36, 40.48, 2]];
function sitiosEspana(n) {
  const out = [];
  const total = CIUDADES.reduce((a, c) => a + c[2], 0) + 20;
  for (const [cx, cy, w] of CIUDADES) {
    const k = Math.round((n * w) / total);
    const s = 0.03 + 0.012 * w;
    for (let j = 0; j < k; j++) out.push({ x: cx + gauss() * s * 1.3, y: cy + gauss() * s, m: opsMask(), e: estado() });
  }
  while (out.length < n) out.push({ x: -9.2 + rnd() * 12.4, y: 36.1 + rnd() * 7.6, m: opsMask(), e: estado() });
  return out;
}

// Compañías de antenasmoviles: 7 Movistar (bit 0), 1 Vodafone (bit 1), 3 Orange (bit 2), 22 Digi (bit 3)
const BIT = { 7: 1, 1: 2, 3: 4, 22: 8 };
function sitiosReales() {
  const puntos = JSON.parse(readFileSync("/tmp/celda-espana/analisis/puntos.json", "utf8"));
  return puntos.map((p) => {
    let m = p.ops.reduce((a, o) => a | (BIT[o] ?? 0), 0);
    if (m === 0) m = 1;
    return { x: p.lon, y: p.lat, m, e: p.er5 ? 2 : 0 };
  });
}

// Provincias: capitales (INE); cada emplazamiento va a la más cercana. Es una partición aproximada,
// suficiente para medir cuánto pesa y cuánto cuesta cargar por provincias.
const CAPITALES = [["01", "Araba/Álava", -2.672, 42.847], ["02", "Albacete", -1.856, 38.994], ["03", "Alacant/Alicante", -0.481, 38.345], ["04", "Almería", -2.464, 36.834], ["05", "Ávila", -4.7, 40.656], ["06", "Badajoz", -6.97, 38.878], ["07", "Illes Balears", 2.65, 39.57], ["08", "Barcelona", 2.17, 41.387], ["09", "Burgos", -3.696, 42.344], ["10", "Cáceres", -6.372, 39.475], ["11", "Cádiz", -6.288, 36.527], ["12", "Castelló/Castellón", -0.049, 39.986], ["13", "Ciudad Real", -3.927, 38.985], ["14", "Córdoba", -4.779, 37.888], ["15", "A Coruña", -8.411, 43.362], ["16", "Cuenca", -2.134, 40.07], ["17", "Girona", 2.821, 41.979], ["18", "Granada", -3.599, 37.177], ["19", "Guadalajara", -3.167, 40.633], ["20", "Gipuzkoa", -1.981, 43.318], ["21", "Huelva", -6.944, 37.261], ["22", "Huesca", -0.408, 42.14], ["23", "Jaén", -3.79, 37.779], ["24", "León", -5.567, 42.598], ["25", "Lleida", 0.62, 41.617], ["26", "La Rioja", -2.445, 42.466], ["27", "Lugo", -7.556, 43.012], ["28", "Madrid", -3.703, 40.416], ["29", "Málaga", -4.421, 36.721], ["30", "Murcia", -1.13, 37.992], ["31", "Navarra", -1.644, 42.812], ["32", "Ourense", -7.864, 42.336], ["33", "Asturias", -5.849, 43.361], ["34", "Palencia", -4.528, 42.01], ["35", "Las Palmas", -15.414, 28.123], ["36", "Pontevedra", -8.644, 42.431], ["37", "Salamanca", -5.664, 40.97], ["38", "Santa Cruz de Tenerife", -16.254, 28.463], ["39", "Cantabria", -3.804, 43.462], ["40", "Segovia", -4.118, 40.948], ["41", "Sevilla", -5.984, 37.389], ["42", "Soria", -2.465, 41.764], ["43", "Tarragona", 1.245, 41.119], ["44", "Teruel", -1.106, 40.344], ["45", "Toledo", -4.027, 39.863], ["46", "València/Valencia", -0.376, 39.47], ["47", "Valladolid", -4.724, 41.652], ["48", "Bizkaia", -2.935, 43.263], ["49", "Zamora", -5.745, 41.503], ["50", "Zaragoza", -0.889, 41.649], ["51", "Ceuta", -5.316, 35.889], ["52", "Melilla", -2.938, 35.292]];
const provinciaDe = (x, y) => {
  let mejor = null, d = Infinity;
  for (const c of CAPITALES) { const dd = (c[2] - x) ** 2 * 0.56 + (c[3] - y) ** 2; if (dd < d) { d = dd; mejor = c; } }
  return mejor[0];
};

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const kb = (n) => (n / 1024).toFixed(1) + " KB";
function escribir(ds, sitios) {
  const col = (ss) => ({ version: VERSION, operadores: ["movistar", "vodafone", "orange", "digi"], estados: ["verificado", "corregido", "nuevo"], n: ss.length, lon: ss.map((s) => r5(s.x)), lat: ss.map((s) => r5(s.y)), m: ss.map((s) => s.m), e: ss.map((s) => s.e), b: ss.map(() => "") });
  const entero = JSON.stringify(col(sitios));
  writeFileSync(aqui(`data/capas/${ds}.json`), entero);
  const lineas = sitios.map((s, i) => JSON.stringify({ type: "Feature", id: i + 1, geometry: { type: "Point", coordinates: [r5(s.x), r5(s.y)] }, properties: { m: s.m, e: s.e, o0: s.m & 1, o1: (s.m >> 1) & 1, o2: (s.m >> 2) & 1, o3: (s.m >> 3) & 1 } }));
  writeFileSync(aqui(`data/capas/${ds}.geojsonl`), lineas.join("\n"));
  const porProv = new Map();
  for (const s of sitios) { const p = provinciaDe(s.x, s.y); if (!porProv.has(p)) porProv.set(p, []); porProv.get(p).push(s); }
  mkdirSync(aqui(`data/capas/${ds}-prov`), { recursive: true });
  const resumen = { version: VERSION, provincias: [] };
  const tam = [];
  for (const [cpro, ss] of [...porProv].sort()) {
    const t = JSON.stringify(col(ss));
    writeFileSync(aqui(`data/capas/${ds}-prov/${cpro}.json`), t);
    tam.push({ cpro, n: ss.length, bytes: t.length, gzip: gzipSync(t).length });
    const cap = CAPITALES.find((c) => c[0] === cpro);
    const xs = ss.map((s) => s.x), ys = ss.map((s) => s.y);
    resumen.provincias.push({ cpro, nombre: cap[1], lon: cap[2], lat: cap[3], n: ss.length, m: ss.reduce((a, s) => a | s.m, 0), caja: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r5) });
  }
  const res = JSON.stringify(resumen);
  writeFileSync(aqui(`data/capas/${ds}-resumen.json`), res);
  tam.sort((a, b) => b.n - a.n);
  const suma = tam.reduce((a, t) => a + t.gzip, 0);
  console.log(`${ds}: ${sitios.length} emplazamientos · capa única ${kb(entero.length)} (gzip ${kb(gzipSync(entero).length)}) · resumen ${kb(res.length)} (gzip ${kb(gzipSync(res).length)}) · ${tam.length} provincias, gzip total ${kb(suma)}, mayores ${tam.slice(0, 4).map((t) => `${t.cpro}:${t.n}/${kb(t.gzip)}`).join(" ")} · mediana ${tam[Math.floor(tam.length / 2)].n}/${kb(tam[Math.floor(tam.length / 2)].gzip)}`);
  writeFileSync(aqui(`data/capas/${ds}-prov/tamanos.json`), JSON.stringify(tam));
}

escribir("es-100k", sitiosEspana(100000));
if (existsSync("/tmp/celda-espana/analisis/puntos.json")) escribir("es-real", sitiosReales());
