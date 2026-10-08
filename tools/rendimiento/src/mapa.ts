// Sin Effect: Playwright es de promesas y los scripts corren con Node tal cual.
import type { CDPSession, Route } from "playwright-core";

/** Lo que las medidas y las pruebas hacen con el mapa de MapLibre de la página. */

/**
 * Encuentra el mapa de MapLibre de la página y lo deja en `window.__celdaMapa`, para mover la
 * cámara (`CamaraEnPagina`). La web no lo expone, así que se busca en el montón de V8 por CDP: la
 * clase cuyo prototipo tiene `flyTo` y `getCanvasContainer`, y el ejemplar de esa clase que está
 * en la página. Va antes de medir: recorrer el montón cuesta.
 */
export const atraparMapa = async (cdp: CDPSession): Promise<boolean> => {
  const grupo = "celda-mapa";
  const funciones = await cdp.send("Runtime.evaluate", {
    expression: "Function.prototype",
    objectGroup: grupo,
  });
  const todas = await cdp.send("Runtime.queryObjects", {
    prototypeObjectId: funciones.result.objectId ?? "",
    objectGroup: grupo,
  });
  const prototipo = await cdp.send("Runtime.callFunctionOn", {
    objectId: todas.objects.objectId ?? "",
    functionDeclaration: `function () {
      const clase = this.find((f) => {
        try {
          return typeof f.prototype?.flyTo === "function" &&
            typeof f.prototype?.getCanvasContainer === "function";
        } catch {
          return false;
        }
      });
      return clase?.prototype;
    }`,
    objectGroup: grupo,
  });
  let encontrado = false;
  if (prototipo.result.objectId !== undefined) {
    const mapas = await cdp.send("Runtime.queryObjects", {
      prototypeObjectId: prototipo.result.objectId,
      objectGroup: grupo,
    });
    const puesto = await cdp.send("Runtime.callFunctionOn", {
      objectId: mapas.objects.objectId ?? "",
      functionDeclaration: `function () {
        window.__celdaMapa = this.find((mapa) => mapa.getContainer().isConnected);
        return window.__celdaMapa !== undefined;
      }`,
      returnByValue: true,
    });
    encontrado = puesto.result.value === true;
  }
  await cdp.send("Runtime.releaseObjectGroup", { objectGroup: grupo });
  return encontrado;
};

/** Un TileJSON y teselas vacías en lugar de OpenFreeMap. */
export const mapaBaseFalso = async (ruta: Route) => {
  const url = new URL(ruta.request().url());
  if (url.pathname === "/planet") {
    await ruta.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tilejson: "3.0.0",
        tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
        vector_layers: [],
      }),
    });
    return;
  }
  await ruta.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) });
};
