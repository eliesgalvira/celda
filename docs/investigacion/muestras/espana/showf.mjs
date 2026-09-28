import { readFileSync, writeFileSync } from "node:fs";
const filas = JSON.parse(readFileSync("/tmp/celda-espana/red/showf-er5.json", "utf8"));
const ops = (s) => {
  const out = [];
  let t = String(s).trim().replace(/^er5_?/, "");
  while (t.length) {
    if (t.startsWith("22")) { out.push("22"); t = t.slice(2); } else { out.push(t[0]); t = t.slice(1); }
  }
  return out;
};
let er5 = 0, er5SinOp = 0, codigos = 0, filasReg = 0, opsReg = 0;
const porOps = new Map();
const puntos = [];
for (const f of filas) {
  const [lat, lon, cods, op, bandas] = f;
  const es = String(op).trim().startsWith("er5");
  const u = [...new Set(cods.map((c) => c.trim()).filter(Boolean))];
  const o = ops(op);
  if (es) { er5++; if (o.length === 0) er5SinOp++; }
  else { filasReg++; codigos += u.length; opsReg += o.length; porOps.set(o.length, (porOps.get(o.length) ?? 0) + 1); }
  const prov = u.map((c) => /^(\d{2})\d{5}$/.exec(c)?.[1]).find(Boolean) ?? null;
  puntos.push({ lat, lon, er5: es, codigos: u.length, ops: o, prov, digi: !es && o.includes("22"),
    bandas: bandas && typeof bandas === "object" ? Object.values(bandas).reduce((a, v) => a + v.length, 0) : 0 });
}
console.log({ filas: filas.length, er5, er5SinOp, filasReg, codigos, opsReg, conDigi: puntos.filter((p) => p.digi).length, porOps: Object.fromEntries(porOps) });
const bcn = [2.052, 41.317, 2.229, 41.468];
const en = (p, [w, s, e, n]) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
const pb = puntos.filter((p) => en(p, bcn));
const reg = pb.filter((p) => !p.er5);
console.log("caja BCN", { filas: pb.length, er5: pb.length - reg.length, codigos: reg.reduce((a, p) => a + p.codigos, 0), ops: reg.reduce((a, p) => a + p.ops.length, 0), digi: reg.filter((p) => p.digi).length });
console.log("con código de provincia", puntos.filter((p) => p.prov).length);
const lat = puntos.map((p) => p.lat), lon = puntos.map((p) => p.lon);
console.log("extensión", Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat));
writeFileSync("/tmp/celda-espana/analisis/puntos.json", JSON.stringify(puntos));
