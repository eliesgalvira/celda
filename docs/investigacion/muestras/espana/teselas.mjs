// Simula el teselado del listado del registro oficial con los puntos de showf como densidad.
// Peso de un punto = códigos distintos + 1 si lleva Digi (Digi repite los códigos de Movistar).
import { readFileSync } from "node:fs";
const puntos = JSON.parse(readFileSync("/tmp/celda-espana/analisis/puntos.json", "utf8"))
  .filter((p) => !p.er5)
  .map((p) => ({ x: p.lon, y: p.lat, w: p.codigos + (p.digi ? 1 : 0) }));
export const total = puntos.reduce((a, p) => a + p.w, 0);

const dentro = (ps, [w, s, e, n]) => ps.filter((p) => p.x >= w && p.x <= e && p.y >= s && p.y <= n);
const cuatro = ([w, s, e, n]) => {
  const x = (w + e) / 2, y = (s + n) / 2;
  return [[w, s, x, y], [x, s, e, y], [w, y, x, n], [x, y, e, n]];
};
/** Peticiones de un recorrido por división en cuatro desde `caja`. */
export const recorrer = (caja, tope = 1000, ps = puntos) => {
  const aqui = dentro(ps, caja);
  const n = aqui.reduce((a, p) => a + p.w, 0);
  if (n < tope) return { peticiones: 1, hojas: 1, n, profundidad: 0, vacias: n === 0 ? 1 : 0 };
  let r = { peticiones: 1, hojas: 0, n, profundidad: 0, vacias: 0 };
  for (const c of cuatro(caja)) {
    const h = recorrer(c, tope, aqui);
    r.peticiones += h.peticiones; r.hojas += h.hojas; r.vacias += h.vacias;
    r.profundidad = Math.max(r.profundidad, h.profundidad + 1);
  }
  return r;
};
/** Rejilla fija de `paso` grados sobre `caja`, saltando celdas sin ningún punto. */
export const rejilla = (caja, paso, tope = 1000) => {
  const [w, s, e, n] = caja;
  let r = { celdas: 0, celdasConDatos: 0, peticiones: 0, hojas: 0, profundidad: 0 };
  for (let x = w; x < e; x += paso) for (let y = s; y < n; y += paso) {
    const c = [x, y, Math.min(x + paso, e), Math.min(y + paso, n)];
    r.celdas++;
    const aqui = dentro(puntos, c);
    if (aqui.length === 0) continue;
    r.celdasConDatos++;
    const h = recorrer(c, tope, aqui);
    r.peticiones += h.peticiones; r.hojas += h.hojas; r.profundidad = Math.max(r.profundidad, h.profundidad);
  }
  return r;
};
export const peso = (caja) => dentro(puntos, caja).reduce((a, p) => a + p.w, 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  const PENINSULA = [-9.6, 35.8, 4.4, 43.9];
  const CANARIAS = [-18.2, 27.6, -13.3, 29.5];
  console.log("peso total (registros estimados):", total);
  for (const tope of [1000, 900]) {
    const p = recorrer(PENINSULA, tope), c = recorrer(CANARIAS, tope);
    console.log(`caja única, tope ${tope}:`, { peticiones: p.peticiones + c.peticiones, hojas: p.hojas + c.hojas, prof: Math.max(p.profundidad, c.profundidad), vacias: p.vacias + c.vacias });
  }
  for (const paso of [2, 1, 0.5, 0.25]) {
    const p = rejilla(PENINSULA, paso), c = rejilla(CANARIAS, paso);
    console.log(`rejilla ${paso}°:`, { celdas: p.celdas + c.celdas, conDatos: p.celdasConDatos + c.celdasConDatos, peticiones: p.peticiones + c.peticiones, hojas: p.hojas + c.hojas, prof: Math.max(p.profundidad, c.profundidad) });
  }
  const cajas = {
    "BCN (caja de la investigación)": [2.052, 41.317, 2.229, 41.468],
    "AMB": [1.92, 41.24, 2.30, 41.58],
    "Madrid municipio": [-3.89, 40.31, -3.52, 40.65],
    "Soria (provincia, caja)": [-3.55, 41.05, -1.77, 42.15],
    "Teruel (caja)": [-1.8, 39.85, 0.35, 41.25],
    "Valladolid (caja)": [-5.62, 41.08, -3.95, 42.35],
    "Lugo (caja)": [-7.95, 42.35, -6.83, 43.8],
    "Málaga (caja)": [-5.62, 36.28, -3.75, 37.3],
    "Tenerife": [-16.95, 27.98, -16.1, 28.6],
    "Navarra (caja)": [-2.5, 41.9, -0.72, 43.32],
    "Badajoz (caja)": [-7.6, 37.95, -4.65, 39.47],
    "Asturias (caja)": [-7.2, 42.87, -4.5, 43.68],
  };
  for (const [nombre, caja] of Object.entries(cajas)) {
    const r = recorrer(caja);
    console.log(nombre, { registros: r.n, peticiones: r.peticiones, hojas: r.hojas });
  }
}
