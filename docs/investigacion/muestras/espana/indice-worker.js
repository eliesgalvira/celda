// EXPLORACIÓN DESECHABLE (España). Construye el índice de supercluster en un Worker y devuelve sus
// árboles como búferes transferibles, para rehidratarlo en el hilo principal sin perder la API síncrona.
import Supercluster from "supercluster";

self.onmessage = (ev) => {
  const { id, lon, lat, m, e, radius, maxZoom } = ev.data;
  const t0 = performance.now();
  const n = lon.length;
  const pts = new Array(n);
  for (let i = 0; i < n; i++) pts[i] = { type: "Feature", id: i, properties: { m: m[i], e: e[i] }, geometry: { type: "Point", coordinates: [lon[i], lat[i]] } };
  const sc = new Supercluster({ radius, maxZoom, map: (p) => ({ m: p.m }), reduce: (a, b) => { a.m |= b.m; } });
  sc.load(pts);
  const msIndice = performance.now() - t0;
  const t1 = performance.now();
  const buferes = [];
  const indiceDe = (buf) => { let k = buferes.indexOf(buf); if (k < 0) { buferes.push(buf); k = buferes.length - 1; } return k; };
  const vistos = new Map();
  const arboles = sc.trees.map((t, z) => {
    if (!t) return null;
    if (vistos.has(t)) return { mismo: vistos.get(t) };
    vistos.set(t, z);
    return { kd: indiceDe(t.ids.buffer), datos: indiceDe(t.data.buffer), off: t.data.byteOffset, len: t.data.length };
  });
  const props = new Int32Array(sc.clusterProps.length);
  sc.clusterProps.forEach((p, k) => { props[k] = p.m; });
  const ids = Int32Array.from(sc.ids);
  buferes.push(sc.coords.buffer, props.buffer, ids.buffer);
  const msSerializar = performance.now() - t1;
  self.postMessage({ id, numPoints: sc.numPoints, stride: sc.stride, arboles, buferes, coords: buferes.length - 3, props: buferes.length - 2, ids: buferes.length - 1, msIndice, msSerializar }, buferes);
};
