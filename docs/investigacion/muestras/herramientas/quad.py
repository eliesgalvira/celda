#!/usr/bin/env python3
"""Descarga por teselas (quadtree) del endpoint GeoJSON de Infoantenas.
Divide cada bbox en 4 mientras la respuesta llegue al tope de 1000 elementos.
uso: quad.py lon0 lat0 lon1 lat1 salida.json [max_peticiones]"""
import json, sys, time, urllib.request

UA = "Celda (investigación; contacto en celda.elies.site)"
BASE = "https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox={:.6f},{:.6f},{:.6f},{:.6f}"
TOPE = 1000
PAUSA = 3.0

lon0, lat0, lon1, lat1 = map(float, sys.argv[1:5])
salida = sys.argv[5]
maxp = int(sys.argv[6]) if len(sys.argv) > 6 else 60

feats = {}
pend = [(lon0, lat0, lon1, lat1)]
n = 0
log = []
while pend:
    if n >= maxp:
        print("tope de peticiones alcanzado; quedan", len(pend), file=sys.stderr)
        break
    b = pend.pop(0)
    url = BASE.format(*b)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    dt = time.time() - t
    n += 1
    d = json.loads(body.decode("latin-1"))
    d.setdefault("features", []); k = len(d["features"])
    log.append({"bbox": b, "n": k, "bytes": len(body), "s": round(dt, 2)})
    print(f"{n:3d} {b} -> {k} ({len(body)} B, {dt:.1f}s)", file=sys.stderr)
    if k >= TOPE:
        x0, y0, x1, y1 = b
        xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
        pend += [(x0, y0, xm, ym), (xm, y0, x1, ym), (x0, ym, xm, y1), (xm, ym, x1, y1)]
    else:
        for f in d["features"]:
            feats[f["id"]] = f
    time.sleep(PAUSA)

json.dump({"type": "FeatureCollection", "features": list(feats.values()), "_log": log},
          open(salida, "w"), ensure_ascii=False)
print("peticiones", n, "elementos únicos", len(feats), file=sys.stderr)
