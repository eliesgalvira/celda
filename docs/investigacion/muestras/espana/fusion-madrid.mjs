// Compara reglas de fusión con los listados grabados el 28/09/2026 (ticket 49).
// Uso: node fusion-madrid.mjs            tabla de reglas por ciudad
//      node fusion-madrid.mjs grupos      grupos de más de 15 m con la regla de 15 m, en Madrid
//      node fusion-madrid.mjs cambios <ciudad>   emplazamientos que cambian con la regla nueva
// La clave de dirección copia `claveDeDireccion` (packages/dominio/src/direccion.ts), sin reparar
// el texto mal codificado; la regla elegida da aquí las mismas cifras que `fusionar`.
import { readFileSync } from "node:fs";

const RADIO_TIERRA = 6_371_008.8;
const rad = Math.PI / 180;
const dist = (a, b) => {
  const x = (b.x - a.x) * rad * Math.cos(((a.y + b.y) / 2) * rad), y = (b.y - a.y) * rad;
  return Math.hypot(x, y) * RADIO_TIERRA;
};
const compania = (titular) =>
  /^TELEF/i.test(titular) ? "movistar" : /^VODAFONE/i.test(titular) ? "vodafone" : /^ORANGE/i.test(titular) ? "orange"
  : /^(DS MOBILE|DIGI)/i.test(titular) ? "digi" : /^XFERA/i.test(titular) ? "yoigo" : titular;

const TIPOS = new Set(["AV", "AVDA", "C", "CL", "CM", "CR", "CTRA", "GL", "GV", "PG", "PJ", "PL", "PS", "PZ", "RB", "RD", "TR", "UR", "VP"]);
const PARTICULAS = new Set(["D", "DE", "DEL", "DELS", "EL", "ELS", "L", "LA", "LAS", "LES", "LOS", "Y"]);
const palabras = (t) => t.split(/[^A-Z0-9]+/u).filter(Boolean);
const claveDeDireccion = (direccion) => {
  const texto = direccion.normalize("NFD").replaceAll(/\p{M}/gu, "").toUpperCase();
  const partes = texto.split(". ");
  const via = partes.length > 1 ? partes.slice(0, -1).join(". ") : texto;
  const municipio = partes.length > 1 ? palabras(partes.at(-1)).join(" ") : "";
  const coma = via.indexOf(",");
  if (coma < 0) return undefined;
  const nombre = palabras(via.slice(0, coma));
  while (nombre.length > 0 && TIPOS.has(nombre[0])) nombre.shift();
  const sin = nombre.filter((p) => !PARTICULAS.has(p)).join(" ");
  const numero = /\d+/u.exec(via.slice(coma + 1))?.[0];
  return sin === "" || numero === undefined ? undefined : `${sin}, ${Number(numero)}. ${municipio}`;
};
const sinCeros = (c) => (/^\d+$/.test(c.trim()) ? String(Number(c.trim())) : c.trim().toUpperCase());

const cargar = (ciudad) => {
  const url = new URL(`listado-${ciudad}-2026-09-28.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")).features.map((e) => ({
    id: e.id,
    x: e.geometry.coordinates[0],
    y: e.geometry.coordinates[1],
    c: compania(e.id.slice(0, e.id.lastIndexOf(" - "))),
    cod: e.properties.Gis_ID.trim(),
    dir: e.properties["Dirección"],
    clave: claveDeDireccion(e.properties["Dirección"]),
  }));
};

/** Pares a `radio` m o menos, de menor a mayor distancia. */
const pares = (regs, radio) => {
  const lado = (radio / 111_320) * 1.5, celdas = new Map();
  const k = (x, y) => `${Math.floor(x / lado)},${Math.floor(y / lado)}`;
  regs.forEach((r, i) => celdas.set(k(r.x, r.y), [...(celdas.get(k(r.x, r.y)) ?? []), i]));
  const out = [];
  regs.forEach((r, i) => {
    const cx = Math.floor(r.x / lado), cy = Math.floor(r.y / lado);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const j of celdas.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = j > i ? dist(r, regs[j]) : Infinity;
        if (d <= radio) out.push([i, j, d]);
      }
  });
  return out.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
};

const mismaEstacion = (a, b) => a.c === b.c && sinCeros(a.cod) === sinCeros(b.cod);
const mismaDireccion = (a, b) => a.clave !== undefined && a.clave === b.clave;

/**
 * Agrupa con una regla: `radio` para cualquier par, `dir` para la misma dirección, `cod` para la
 * misma estación y `diam` como diámetro máximo del grupo al encadenar (en orden de distancia).
 */
const agrupar = (regs, { radio, dir = 0, cod = 0, diam = Infinity }) => {
  const padre = regs.map((_, i) => i), miembros = new Map(regs.map((_, i) => [i, [i]]));
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  for (const [a, b, d] of pares(regs, Math.max(radio, dir, cod))) {
    const [ra, rb] = [raiz(a), raiz(b)];
    if (ra === rb) continue;
    const ok = d <= radio || (d <= cod && mismaEstacion(regs[a], regs[b])) || (d <= dir && mismaDireccion(regs[a], regs[b]));
    if (!ok) continue;
    if (diam !== Infinity) {
      let m = 0;
      for (const x of miembros.get(ra)) for (const y of miembros.get(rb)) m = Math.max(m, dist(regs[x], regs[y]));
      if (m > diam) continue;
    }
    const [r, o] = ra < rb ? [ra, rb] : [rb, ra];
    padre[o] = r;
    miembros.set(r, [...miembros.get(r), ...miembros.get(o)]);
    miembros.delete(o);
  }
  return [...miembros.values()];
};
const diametro = (regs, g) => Math.max(0, ...g.flatMap((a) => g.map((b) => dist(regs[a], regs[b]))));

/**
 * Señales de error de un agrupamiento:
 * - estación partida: dos grupos con la misma compañía y el mismo código salvo ceros a <= 60 m;
 * - azotea partida: dos grupos con compañías distintas en la misma dirección a <= 30 m;
 * - dos estaciones: un grupo con dos códigos de una compañía (distintos aun sin ceros) en
 *   direcciones distintas, que puede ser la unión de dos emplazamientos.
 */
const medir = (regs, grupos, base) => {
  const g = new Map();
  grupos.forEach((m, n) => m.forEach((i) => g.set(i, n)));
  const estacion = new Set(), azotea = new Set();
  for (const [a, b, d] of pares(regs, 60)) {
    if (g.get(a) === g.get(b)) continue;
    const par = [g.get(a), g.get(b)].sort((x, y) => x - y).join("-");
    if (mismaEstacion(regs[a], regs[b])) estacion.add(par);
    if (regs[a].c !== regs[b].c && d <= 30 && mismaDireccion(regs[a], regs[b])) azotea.add(par);
  }
  const dosEstaciones = grupos.filter((m) => m.some((a) => m.some((b) =>
    regs[a].c === regs[b].c && sinCeros(regs[a].cod) !== sinCeros(regs[b].cod) &&
    regs[a].clave !== undefined && regs[b].clave !== undefined && regs[a].clave !== regs[b].clave))).length;
  const firma = (m) => m.map((i) => regs[i].id).sort().join("|");
  const antes = new Set(base.map(firma));
  const ds = grupos.map((m) => diametro(regs, m));
  return {
    emplazamientos: grupos.length,
    cambian: grupos.filter((m) => !antes.has(firma(m))).length,
    diametro: Math.round(Math.max(...ds)),
    mas40: ds.filter((d) => d > 40).length,
    estacion: estacion.size,
    azotea: azotea.size,
    dosEstaciones,
  };
};

const REGLAS = [
  ["15 m (antes)", { radio: 15 }],
  ["10 m", { radio: 10 }],
  ["20 m", { radio: 20 }],
  ["25 m", { radio: 25 }],
  ["30 m", { radio: 30 }],
  ["15 m, diámetro ≤ 20 m", { radio: 15, diam: 20 }],
  ["25 m, diámetro ≤ 30 m", { radio: 25, diam: 30 }],
  ["15 m + dirección ≤ 30 m", { radio: 15, dir: 30 }],
  ["15 m + dirección ≤ 40 m", { radio: 15, dir: 40 }],
  ["15 m + estación ≤ 60 m", { radio: 15, cod: 60 }],
  ["15 m + estación ≤ 60 m + dirección ≤ 30 m (elegida)", { radio: 15, cod: 60, dir: 30 }],
  ["15 m + estación ≤ 60 m + dirección ≤ 40 m", { radio: 15, cod: 60, dir: 40 }],
];
const ELEGIDA = { radio: 15, cod: 60, dir: 30 };

const [orden = "tabla", ciudadPedida = "madrid-centro"] = process.argv.slice(2);
if (orden === "tabla") {
  for (const ciudad of ["madrid-centro", "barcelona", "valencia-centro"]) {
    const regs = cargar(ciudad), base = agrupar(regs, { radio: 15 });
    console.log(`\n${ciudad}, ${regs.length} registros`);
    console.log("| Regla | Emplazamientos | Cambian | Diámetro máx. | Grupos > 40 m | Estación partida | Azotea partida | Dos estaciones |");
    for (const [nombre, regla] of REGLAS) {
      const m = medir(regs, agrupar(regs, regla), base);
      console.log(`| ${nombre} | ${m.emplazamientos} | ${m.cambian} | ${m.diametro} | ${m.mas40} | ${m.estacion} | ${m.azotea} | ${m.dosEstaciones} |`);
    }
  }
} else {
  const regs = cargar(ciudadPedida);
  const base = agrupar(regs, { radio: 15 });
  const firma = (m) => m.map((i) => regs[i].id).sort().join("|");
  const antes = new Set(base.map(firma));
  const lista = orden === "grupos"
    ? base.filter((g) => diametro(regs, g) > 15)
    : agrupar(regs, ELEGIDA).filter((g) => !antes.has(firma(g)));
  lista.sort((a, b) => diametro(regs, b) - diametro(regs, a));
  for (const [n, g] of lista.entries()) {
    console.log(`\n#${n + 1} diámetro ${diametro(regs, g).toFixed(1)} m`);
    const o = regs[g[0]];
    for (const i of g) {
      const r = regs[i];
      const dx = (r.x - o.x) * 111_320 * Math.cos(r.y * rad), dy = (r.y - o.y) * 111_320;
      console.log(`   ${r.c.padEnd(8)} ${r.cod.padEnd(12)} (${dx.toFixed(0)}, ${dy.toFixed(0)}) ${r.dir.split(". ")[0]}`);
    }
  }
  console.log(`\n${lista.length} grupos`);
}
