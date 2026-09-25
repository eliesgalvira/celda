#!/usr/bin/env python3
"""Descarga y convierte a JSON la ficha detalleEstacion.do de Infoantenas.
uso: det.py "OPERADOR - CODIGO" [...]"""
import html, json, re, sys, time, urllib.parse, urllib.request

UA = "Celda (investigación; contacto en celda.elies.site)"
BASE = "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?"


def celdas(fila):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
            for c in re.findall(r"<td[^>]*>(.*?)</td>", fila, re.S)]


def parse(s):
    out = {}
    loc = s.split("LOCALIZACI", 1)[1].split("CARACTERISTICAS", 1)[0]
    vals = [v for v in (html.unescape(re.sub(r"<[^>]+>", "", p)).strip()
                        for p in re.findall(r"<p[^>]*>(.*?)</p>", loc, re.S)) if v]
    out["codigo"], out["direccion"] = (vals + [None, None])[:2]
    tec = s.split("CARACTERISTICAS", 1)[1].split("NIVELES MEDIDOS", 1)[0]
    filas = re.findall(r"<tr[^>]*>(.*?)</tr>", tec, re.S)
    out["caracteristicas"] = [dict(zip(["operador", "referencia", "banda_mhz"], c))
                              for c in map(celdas, filas) if len(c) == 3 and "<h3" not in c[0] and c[0] != "Operador"]
    niv = s.split("NIVELES MEDIDOS", 1)[1] if "NIVELES MEDIDOS" in s else ""
    niv = niv.split("cumplen", 1)[0]
    filas = re.findall(r"<tr[^>]*>(.*?)</tr>", niv, re.S)
    out["niveles_medidos"] = [dict(zip(["distancia_m", "acimut_grados", "valor_uw_cm2"], c))
                              for c in map(celdas, filas) if len(c) == 3 and re.match(r"^[\d.]+$", c[0] or "")]
    return out


res = []
args = sys.argv[1:]
if args and args[0].startswith("@"):
    args = [l.strip() for l in open(args[0][1:], encoding="utf-8") if l.strip()]
for codigo in args:
    emp = codigo.split(" - ", 1)[1]
    url = BASE + urllib.parse.urlencode({"emplazamiento": emp, "codEmplazamiento": codigo})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        s = r.read().decode("latin-1")
    d = parse(s)
    d["_url"] = url
    res.append(d)
    time.sleep(3)
print(json.dumps(res, ensure_ascii=False, indent=1))
