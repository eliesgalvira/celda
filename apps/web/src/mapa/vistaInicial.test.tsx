import { ESPANA, type Rectangulo } from "@celda/dominio/area";
import type { ProvinciaDelResumen, ResumenLeido } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { provinciasDeLaVista } from "../capa/nacional.ts";
import { FUENTES_DE_PRUEBA } from "../capa/pruebas.ts";
import {
  type AlAbrir,
  crearVistaInicial,
  encuadreDeLoQueHay,
  encuadreInicial,
  type MapaQueSeEncuadra,
  type Movimiento,
  provinciaDelPunto,
  rellenoDeLaVista,
  zoomParaEncuadrar,
} from "./vistaInicial.ts";

const caja = (oeste: number, sur: number, este: number, norte: number): Rectangulo => ({
  suroeste: { longitud: oeste, latitud: sur },
  noreste: { longitud: este, latitud: norte },
});

const provincia = (
  codigo: string,
  nombre: string,
  datos: { readonly caja?: Rectangulo; readonly cubierta?: boolean },
): ProvinciaDelResumen => ({
  codigo,
  nombre,
  etiqueta: { longitud: 0, latitud: 40 },
  caja: datos.caja,
  emplazamientos: datos.caja === undefined ? 0 : 100,
  companias: [],
  cubierta: datos.cubierta ?? false,
  barrido: null,
  fichero: datos.caja === undefined ? undefined : `provincias/${codigo}/prueba.json`,
});

const resumenCon = (provincias: ReadonlyArray<ProvinciaDelResumen>): ResumenLeido => ({
  version: "sitios@2026-09-29T02:15:00Z",
  fecha: Date.UTC(2026, 8, 29, 2, 15),
  fuentes: FUENTES_DE_PRUEBA,
  cobertura: [],
  provincias,
});

// Cataluña cubierta, Huesca a medias y Soria sin nada.
const BARCELONA = provincia("08", "Barcelona", {
  caja: caja(1.36, 41.19, 2.78, 42.32),
  cubierta: true,
});
const GIRONA = provincia("17", "Girona", { caja: caja(1.72, 41.65, 3.33, 42.5), cubierta: true });
const LLEIDA = provincia("25", "Lleida", { caja: caja(0.32, 41.27, 1.86, 42.86), cubierta: true });
const TARRAGONA = provincia("43", "Tarragona", {
  caja: caja(0.16, 40.52, 1.66, 41.58),
  cubierta: true,
});
const HUESCA = provincia("22", "Huesca", { caja: caja(0.1, 41.4, 0.77, 42.6) });
const SORIA = provincia("42", "Soria", {});
const CATALUNA = resumenCon([BARCELONA, GIRONA, HUESCA, LLEIDA, SORIA, TARRAGONA]);
const MADRID_ENTERA = caja(-4.58, 39.88, -3.05, 41.17);
const EN_MADRID = { longitud: -3.7, latitud: 40.42 };

describe("encuadreInicial", () => {
  it("sin punto, encuadra las provincias cubiertas, no las que están a medias", () => {
    assert.deepStrictEqual(
      encuadreInicial({ punto: null, provinciaDelPunto: null, resumen: CATALUNA }),
      caja(0.16, 40.52, 3.33, 42.86),
    );
  });

  it("sin ninguna cubierta, las que tienen algún emplazamiento; sin ninguna, España", () => {
    assert.deepStrictEqual(encuadreDeLoQueHay(resumenCon([HUESCA, SORIA])), HUESCA.caja);
    assert.deepStrictEqual(
      encuadreInicial({ punto: null, provinciaDelPunto: null, resumen: resumenCon([SORIA]) }),
      ESPANA.encuadre,
    );
  });

  it("si el resumen no llega, España", () => {
    assert.deepStrictEqual(
      encuadreInicial({ punto: null, provinciaDelPunto: null, resumen: null }),
      ESPANA.encuadre,
    );
  });

  it("con un punto guardado, su provincia entera, aunque Celda no tenga datos de ella", () => {
    assert.deepStrictEqual(
      encuadreInicial({ punto: EN_MADRID, provinciaDelPunto: MADRID_ENTERA, resumen: undefined }),
      MADRID_ENTERA,
    );
  });

  it("con el punto fuera de todas las provincias, lo que Celda tiene", () => {
    assert.deepStrictEqual(
      encuadreInicial({
        punto: { longitud: 2.35, latitud: 43.21 },
        provinciaDelPunto: null,
        resumen: CATALUNA,
      }),
      encuadreDeLoQueHay(CATALUNA),
    );
  });

  it("espera a saber si hay punto, dónde cae y, sin él, a que llegue el resumen", () => {
    const esperando: ReadonlyArray<AlAbrir> = [
      { punto: undefined, provinciaDelPunto: undefined, resumen: CATALUNA },
      { punto: EN_MADRID, provinciaDelPunto: undefined, resumen: CATALUNA },
      { punto: null, provinciaDelPunto: null, resumen: undefined },
    ];
    for (const alAbrir of esperando) assert.isUndefined(encuadreInicial(alAbrir));
  });

  it("la caja de la provincia del punto sale de sus límites, no de sus emplazamientos", () => {
    const provincias = [
      { codigo: "28", nombre: "Madrid", caja: [-4.58, 39.88, -3.05, 41.17] as const },
    ];
    const enMadrid = {
      municipio: undefined,
      provincia: { codigo: "28", nombre: "Madrid", etiqueta: EN_MADRID },
    };
    assert.deepStrictEqual(provinciaDelPunto(enMadrid, provincias), MADRID_ENTERA);
    assert.isNull(provinciaDelPunto({ municipio: undefined, provincia: undefined }, provincias));
    assert.isUndefined(provinciaDelPunto(undefined, provincias));
  });

  it("de lo que Celda tiene al abrir no se pide ninguna provincia: se ve el resumen", () => {
    const cubierto = encuadreDeLoQueHay(CATALUNA);
    assert.isDefined(cubierto);
    if (cubierto === undefined) return;
    for (const [pantalla, escritorio] of [
      [{ ancho: 390, alto: 844 }, false],
      [{ ancho: 1400, alto: 900 }, true],
    ] as const) {
      const zoom = zoomParaEncuadrar(cubierto, pantalla, rellenoDeLaVista(escritorio));
      assert.deepStrictEqual(provinciasDeLaVista(CATALUNA, { caja: cubierto, zoom }), []);
    }
    const madrid = zoomParaEncuadrar(
      MADRID_ENTERA,
      { ancho: 390, alto: 844 },
      rellenoDeLaVista(false),
    );
    assert.closeTo(madrid, 7.3, 0.3);
  });
});

/** Un mapa de MapLibre de mentira: apunta cada encuadre y deja simular un gesto. */
const mapaDePrueba = () => {
  const encuadres: Array<[[number, number], [number, number]]> = [];
  const oyentes = new Set<(movimiento: Movimiento) => void>();
  const mapa: MapaQueSeEncuadra = {
    fitBounds: (limites) => {
      encuadres.push(limites);
      for (const oyente of oyentes) oyente({});
    },
    on: (_, oyente) => {
      oyentes.add(oyente);
    },
    off: (_, oyente) => {
      oyentes.delete(oyente);
    },
  };
  return {
    mapa,
    encuadres,
    gesto: () => {
      for (const oyente of oyentes) oyente({ originalEvent: new Event("pointerdown") });
    },
  };
};

const montar = (activa = true) => {
  const [alAbrir, setAlAbrir] = createSignal<AlAbrir>({
    punto: undefined,
    provinciaDelPunto: undefined,
    resumen: undefined,
  });
  const [mapa, setMapa] = createSignal<MapaQueSeEncuadra>();
  let vista: ReturnType<typeof crearVistaInicial> | undefined;
  render(() => {
    vista = crearVistaInicial({
      activa,
      alAbrir,
      mapa,
      relleno: () => rellenoDeLaVista(false),
    });
    return <></>;
  });
  flush();
  return {
    vista: () => vista,
    abrir: (nuevo: AlAbrir) => {
      setAlAbrir(nuevo);
      flush();
    },
    ponerMapa: (nuevo: MapaQueSeEncuadra) => {
      setMapa(nuevo);
      flush();
    },
  };
};

const SIN_PUNTO_CON_CATALUNA: AlAbrir = { punto: null, provinciaDelPunto: null, resumen: CATALUNA };
const SUROESTE: [number, number] = [0.16, 40.52];
const NORESTE: [number, number] = [3.33, 42.86];

describe("crearVistaInicial", () => {
  it("con el mapa ya creado, lo encuadra una vez al saber qué se ve, sin animación", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa } = montar();
    ponerMapa(mapa);
    assert.lengthOf(encuadres, 0);
    abrir(SIN_PUNTO_CON_CATALUNA);
    assert.deepStrictEqual(encuadres, [[SUROESTE, NORESTE]]);
    // Que llegue otro resumen no lo vuelve a mover.
    abrir({ ...SIN_PUNTO_CON_CATALUNA, resumen: resumenCon([HUESCA]) });
    assert.lengthOf(encuadres, 1);
  });

  it("si ya se sabe al crear el mapa, el mapa nace ahí y no se vuelve a encuadrar", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar();
    abrir(SIN_PUNTO_CON_CATALUNA);
    assert.deepStrictEqual(vista()?.alCrear(), caja(0.16, 40.52, 3.33, 42.86));
    ponerMapa(mapa);
    assert.lengthOf(encuadres, 0);
    assert.isUndefined(vista()?.alCrear());
  });

  it("si una persona mueve el mapa antes de saberlo, no se lo quita", () => {
    const { mapa, encuadres, gesto } = mapaDePrueba();
    const { abrir, ponerMapa } = montar();
    ponerMapa(mapa);
    gesto();
    abrir(SIN_PUNTO_CON_CATALUNA);
    assert.lengthOf(encuadres, 0);
  });

  it("si la web ya ha llevado el mapa a otro sitio, tampoco", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar();
    ponerMapa(mapa);
    vista()?.yaColocado();
    abrir(SIN_PUNTO_CON_CATALUNA);
    assert.lengthOf(encuadres, 0);
  });

  it("con un emplazamiento en la dirección no hace nada", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar(false);
    ponerMapa(mapa);
    abrir(SIN_PUNTO_CON_CATALUNA);
    assert.lengthOf(encuadres, 0);
    assert.isUndefined(vista()?.encuadre());
  });
});
