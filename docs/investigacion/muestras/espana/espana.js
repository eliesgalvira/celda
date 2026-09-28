// EXPLORACIÓN DESECHABLE (España). Índice en un Worker y capa por provincias con resumen nacional.
import Supercluster from "supercluster";
import KDBush from "kdbush";
import { AgrupadorCliente } from "./agrupar.js";
import IndiceWorker from "./indice-worker.js?worker";

const RADIO = 60, MAXZOOM = 16;
const opciones = () => ({ radius: RADIO, maxZoom: MAXZOOM, map: (p) => ({ m: p.m }), reduce: (a, b) => { a.m |= b.m; } });

let worker = null, siguiente = 0;
const pendientes = new Map();
/** Indexa la capa `c` (por columnas) en el Worker y rehidrata el índice aquí. */
export function indexarEnWorker(c) {
  worker ??= new IndiceWorker();
  worker.onmessage ??= null;
  if (!worker.__escuchando) {
    worker.__escuchando = true;
    worker.onmessage = (ev) => { const p = pendientes.get(ev.data.id); pendientes.delete(ev.data.id); p(ev.data); };
  }
  const id = siguiente++;
  const t0 = performance.now();
  const lon = Float64Array.from(c.lon), lat = Float64Array.from(c.lat), m = Int32Array.from(c.m), e = Int32Array.from(c.e);
  const msCopiar = performance.now() - t0;
  return new Promise((resolver) => {
    pendientes.set(id, (r) => {
      const t1 = performance.now();
      const sc = new Supercluster(opciones());
      sc.numPoints = r.numPoints;
      sc.stride = r.stride;
      sc.trees = r.arboles.map((a) => null);
      r.arboles.forEach((a, z) => {
        if (!a || a.mismo !== undefined) return;
        const t = KDBush.from(r.buferes[a.kd]);
        t.data = new Int32Array(r.buferes[a.datos], a.off, a.len);
        sc.trees[z] = t;
      });
      r.arboles.forEach((a, z) => { if (a && a.mismo !== undefined) sc.trees[z] = sc.trees[a.mismo]; });
      sc.coords = new Float64Array(r.buferes[r.coords]);
      sc.ids = new Int32Array(r.buferes[r.ids]);
      const masks = new Int32Array(r.buferes[r.props]);
      sc.clusterProps = Array.from(masks, (x) => ({ m: x }));
      const props = new Array(c.n);
      for (let i = 0; i < c.n; i++) props[i] = { m: c.m[i], e: c.e[i] };
      sc.props = props;
      const msRehidratar = performance.now() - t1;
      resolver({ sc, msWorker: r.msIndice, msSerializar: r.msSerializar, msCopiar, msRehidratar, msTotal: performance.now() - t0 });
    });
    worker.postMessage({ id, lon, lat, m, e, radius: RADIO, maxZoom: MAXZOOM }, [lon.buffer, lat.buffer, m.buffer, e.buffer]);
  });
}

/** Nivel por debajo del cual se enseña el resumen nacional (un hexágono por provincia). */
export const NIVEL_PROVINCIAS = 8;
const corta = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * Resumen nacional por provincias para los zooms bajos y, desde `NIVEL_PROVINCIAS`, las capas de las
 * provincias que se ven, cada una con su índice. Las claves llevan delante el código de provincia,
 * así la relación entre niveles se pide al índice de cada provincia.
 */
export class AgrupadorProvincias {
  constructor(resumen, base, { enWorker, alCargar, M }) {
    this.resumen = resumen; this.base = base; this.enWorker = enWorker; this.alCargar = alCargar; this.M = M;
    this.prov = new Map(); // cpro → { estado: 'cargando'|'lista', agr }
    M.provincias = [];
  }
  hexDe(p) { return { key: "r" + p.cpro, kind: "c", lon: p.lon, lat: p.lat, n: p.n, m: p.m, sin: 15 & ~p.m, cpro: p.cpro }; }
  pedir(p) {
    if (this.prov.has(p.cpro)) return;
    const e = { estado: "cargando", agr: null };
    this.prov.set(p.cpro, e);
    const t0 = performance.now();
    (async () => {
      const res = await fetch(`${this.base}/${p.cpro}.json`);
      const texto = await res.text();
      const t1 = performance.now();
      const c = JSON.parse(texto);
      const msParse = performance.now() - t1;
      let agr, msIndice, info = {};
      if (this.enWorker) {
        const r = await indexarEnWorker(c);
        agr = new AgrupadorCliente(c, false, r.sc);
        msIndice = r.msCopiar + r.msRehidratar; // lo que cuesta en el hilo principal
        info = { msWorker: r.msWorker, msRehidratar: r.msRehidratar, msCopiar: r.msCopiar, msTotal: r.msTotal };
      } else {
        agr = new AgrupadorCliente(c, false);
        msIndice = agr.msIndice;
      }
      e.agr = agr; e.estado = "lista";
      this.M.provincias.push({ cpro: p.cpro, n: c.n, msParse, msIndice, ...info, msHastaLista: performance.now() - t0 });
      this.alCargar();
    })();
  }
  vista(nivel, bb) {
    const out = new Map();
    const visibles = this.resumen.provincias.filter((p) => corta(p.caja, bb));
    if (nivel < NIVEL_PROVINCIAS) {
      for (const p of visibles) out.set("r" + p.cpro, this.hexDe(p));
      return out;
    }
    for (const p of visibles) {
      this.pedir(p);
      const e = this.prov.get(p.cpro);
      if (e.estado !== "lista") { out.set("r" + p.cpro, this.hexDe(p)); continue; }
      for (const [k, it] of e.agr.vista(nivel, bb)) out.set(`${p.cpro}:${k}`, { ...it, key: `${p.cpro}:${k}`, cpro: p.cpro });
    }
    return out;
  }
  relacion(nivelA, itemsA, nivelB, itemsB) {
    const destino = new Map(), origen = new Map();
    const cproDe = (k) => (k.startsWith("r") ? k.slice(1) : k.slice(0, k.indexOf(":")));
    // Lo que sale de o va a un hexágono de provincia (resumen o provincia aún sin cargar)
    for (const [k] of itemsA) if (!itemsB.has(k) && !k.startsWith("r") && itemsB.has("r" + cproDe(k))) destino.set(k, "r" + cproDe(k));
    for (const [k] of itemsB) if (!itemsA.has(k) && !k.startsWith("r") && itemsA.has("r" + cproDe(k))) origen.set(k, "r" + cproDe(k));
    if (nivelA === nivelB || nivelA < NIVEL_PROVINCIAS || nivelB < NIVEL_PROVINCIAS) return { destino, origen };
    // Entre niveles con detalle, la jerarquía de supercluster de cada provincia
    const porProv = (items) => { const g = new Map(); for (const [k, it] of items) { if (k.startsWith("r")) continue; const c = cproDe(k); if (!g.has(c)) g.set(c, new Map()); g.get(c).set(k.slice(c.length + 1), it); } return g; };
    const a = porProv(itemsA), b = porProv(itemsB);
    for (const [c, ia] of a) {
      const ib = b.get(c), e = this.prov.get(c);
      if (!ib || !e?.agr) continue;
      const r = e.agr.relacion(nivelA, ia, nivelB, ib);
      for (const [x, y] of r.destino) destino.set(`${c}:${x}`, `${c}:${y}`);
      for (const [x, y] of r.origen) origen.set(`${c}:${x}`, `${c}:${y}`);
    }
    return { destino, origen };
  }
  zoomExpansion(it) {
    if (it.key.startsWith("r")) return NIVEL_PROVINCIAS + 0.5;
    const e = this.prov.get(it.cpro);
    return e?.agr?.zoomExpansion({ ...it, key: it.key.slice(it.cpro.length + 1) }) ?? null;
  }
}
