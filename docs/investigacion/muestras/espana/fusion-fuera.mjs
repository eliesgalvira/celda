// Repite el análisis del ADR 0012 con los registros muestreados fuera de Barcelona (28/09/2026).
import { readFileSync, readdirSync } from "node:fs";
const dir = "/tmp/celda-espana/red/registro/";
const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => { const x = (b.x - a.x) * rad * Math.cos(((a.y + b.y) / 2) * rad), y = (b.y - a.y) * rad; return Math.hypot(x, y) * R; };
const norm = (op) => op.startsWith("TELEF") ? "movistar" : op.startsWith("VODAFONE") ? "vodafone" : op.startsWith("ORANGE") ? "orange" : op.startsWith("DS MOBILE") ? "digi" : op.startsWith("XFERA") ? "yoigo" : op;
for (const f of readdirSync(dir).filter((f) => f !== "muestreo.json")) {
  const regs = JSON.parse(readFileSync(dir + f, "utf8")).map(([id, v]) => ({ id, ...v, c: norm(v.op) }));
  // rejilla para vecinos
  const celda = 0.002, g = new Map();
  const k = (x, y) => `${Math.floor(x / celda)},${Math.floor(y / celda)}`;
  regs.forEach((r, i) => { const kk = k(r.x, r.y); if (!g.has(kk)) g.set(kk, []); g.get(kk).push(i); });
  const vecinos = (r) => { const cx = Math.floor(r.x / celda), cy = Math.floor(r.y / celda), out = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(g.get(`${cx + dx},${cy + dy}`) ?? [])); return out; };
  const grupos = (radio) => {
    const p = regs.map((_, i) => i); const find = (i) => (p[i] === i ? i : (p[i] = find(p[i])));
    regs.forEach((r, i) => { for (const j of vecinos(r)) if (j > i && dist(r, regs[j]) <= radio) p[find(i)] = find(j); });
    const gs = new Map(); regs.forEach((_, i) => { const f = find(i); if (!gs.has(f)) gs.set(f, []); gs.get(f).push(i); });
    let diam = 0; for (const m of gs.values()) if (m.length > 1) for (const a of m) for (const b of m) diam = Math.max(diam, dist(regs[a], regs[b]));
    return { n: gs.size, diam: Math.round(diam) };
  };
  // distancia a la compañía distinta más cercana (sin coincidencia exacta)
  const tramos = { exacta: 0, "<=1": 0, "1-5": 0, "5-10": 0, "10-15": 0, "15-20": 0, "20-30": 0, ">30": 0 };
  for (const r of regs) {
    let d = Infinity;
    for (const j of vecinos(r)) { const o = regs[j]; if (o.c !== r.c) d = Math.min(d, dist(r, o)); }
    const t = d === 0 ? "exacta" : d <= 1 ? "<=1" : d <= 5 ? "1-5" : d <= 10 ? "5-10" : d <= 15 ? "10-15" : d <= 20 ? "15-20" : d <= 30 ? "20-30" : ">30";
    tramos[t]++;
  }
  const r05 = grupos(0.5), r15 = grupos(15), r20 = grupos(20), r60 = grupos(60);
  console.log(f.replace(".json", "").padEnd(26), `registros ${regs.length}`, `emplaz. 0,5 m ${r05.n} · 15 m ${r15.n} (diám. ${r15.diam} m) · 20 m ${r20.n} · 60 m ${r60.n} (diám. ${r60.diam} m)`, JSON.stringify(tramos));
}
