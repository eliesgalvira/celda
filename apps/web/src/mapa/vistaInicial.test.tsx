import { contiene, type Coordenada, ESPANA, type Rectangulo } from "@celda/dominio/area";
import type { ProvinciaDelResumen, ResumenLeido } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { provinciasDeLaVista } from "../capa/nacional.ts";
import { FICHERO_DE_PUNTOS_DE_PRUEBA, FUENTES_DE_PRUEBA } from "../capa/pruebas.ts";
import {
  type AlAbrir,
  crearVistaInicial,
  encuadreInicial,
  type MapaQueSeEncuadra,
  type Movimiento,
  type Pantalla,
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
  puntos: FICHERO_DE_PUNTOS_DE_PRUEBA,
});

// Cataluña cubierta y Huesca a medias.
const CATALUNA = resumenCon([
  provincia("08", "Barcelona", { caja: caja(1.36, 41.19, 2.78, 42.32), cubierta: true }),
  provincia("17", "Girona", { caja: caja(1.72, 41.65, 3.33, 42.5), cubierta: true }),
  provincia("22", "Huesca", { caja: caja(0.1, 41.4, 0.77, 42.6) }),
  provincia("25", "Lleida", { caja: caja(0.32, 41.27, 1.86, 42.86), cubierta: true }),
  provincia("43", "Tarragona", { caja: caja(0.16, 40.52, 1.66, 41.58), cubierta: true }),
]);
const MADRID_ENTERA = caja(-4.58, 39.88, -3.05, 41.17);
const EN_MADRID = { longitud: -3.7, latitud: 40.42 };
const SIN_PUNTO: AlAbrir = { punto: null, provinciaDelPunto: null };

describe("encuadreInicial", () => {
  it("sin punto, la península entera", () => {
    assert.deepStrictEqual(encuadreInicial(SIN_PUNTO), ESPANA.encuadre);
  });

  it("con un punto guardado, su provincia entera, aunque Celda no tenga datos de ella", () => {
    assert.deepStrictEqual(
      encuadreInicial({ punto: EN_MADRID, provinciaDelPunto: MADRID_ENTERA }),
      MADRID_ENTERA,
    );
  });

  it("con el punto fuera de todas las provincias, la península", () => {
    assert.deepStrictEqual(
      encuadreInicial({ punto: { longitud: 2.35, latitud: 43.21 }, provinciaDelPunto: null }),
      ESPANA.encuadre,
    );
  });

  it("espera a saber si hay punto y dónde cae", () => {
    const esperando: ReadonlyArray<AlAbrir> = [
      { punto: undefined, provinciaDelPunto: undefined },
      { punto: EN_MADRID, provinciaDelPunto: undefined },
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
});

/** Un rectángulo de la pantalla en píxeles CSS, desde la esquina de arriba a la izquierda. */
interface Recuadro {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const seTocan = (a: Recuadro, b: Recuadro): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Lo que tapa la interfaz en cada pantalla, medido en Chromium sobre `DisposicionMapa` al abrir:
 * la cabecera con «Datos del mapa» debajo, las pastillas de abajo a la derecha (con Acercar y
 * Alejar encima en escritorio) y los créditos de abajo a la izquierda.
 */
const interfaz = (pantalla: Pantalla, escritorio: boolean): ReadonlyArray<Recuadro> => {
  const { ancho, alto } = pantalla;
  return escritorio
    ? [
        { x0: 0, y0: 0, x1: ancho, y1: 96 },
        { x0: ancho - 174, y0: alto - 308, x1: ancho, y1: alto },
        { x0: 0, y0: alto - 56, x1: ancho - 96, y1: alto },
      ]
    : [
        { x0: 0, y0: 0, x1: ancho, y1: 84 },
        { x0: ancho - 162, y0: alto - 156, x1: ancho, y1: alto },
        { x0: 0, y0: alto - 48, x1: 48, y1: alto },
      ];
};

const MUNDO = 512;
const xMercator = (longitud: number) => (longitud + 180) / 360;
const yMercator = (latitud: number) => {
  const seno = Math.sin((latitud * Math.PI) / 180);
  return 0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI);
};
const latitudDeY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** Dónde queda una caja en la pantalla y dónde queda el centro del mapa. */
interface Encuadrado {
  readonly recuadro: Recuadro;
  readonly centro: Coordenada;
}

/**
 * Dónde queda `caja` en la pantalla y en qué punto se centra el mapa, como hace `fitBounds` de
 * MapLibre: el zoom que da `zoomParaEncuadrar` y el centro de la caja en el centro de lo que deja
 * libre el relleno.
 */
const encuadrar = (encuadre: Rectangulo, pantalla: Pantalla, escritorio: boolean): Encuadrado => {
  const relleno = rellenoDeLaVista(encuadre, pantalla, escritorio);
  const escala = MUNDO * 2 ** zoomParaEncuadrar(encuadre, pantalla, relleno);
  const oeste = xMercator(encuadre.suroeste.longitud);
  const este = xMercator(encuadre.noreste.longitud);
  const norte = yMercator(encuadre.noreste.latitud);
  const sur = yMercator(encuadre.suroeste.latitud);
  const libreX = (relleno.left + pantalla.ancho - relleno.right) / 2;
  const libreY = (relleno.top + pantalla.alto - relleno.bottom) / 2;
  const ancho = (este - oeste) * escala;
  const alto = (sur - norte) * escala;
  const centroX = (oeste + este) / 2 + (pantalla.ancho / 2 - libreX) / escala;
  const centroY = (norte + sur) / 2 + (pantalla.alto / 2 - libreY) / escala;
  return {
    recuadro: {
      x0: libreX - ancho / 2,
      y0: libreY - alto / 2,
      x1: libreX + ancho / 2,
      y1: libreY + alto / 2,
    },
    centro: { longitud: centroX * 360 - 180, latitud: latitudDeY(centroY) },
  };
};

const PANTALLAS: ReadonlyArray<readonly [Pantalla, boolean]> = [
  [{ ancho: 360, alto: 640 }, false],
  [{ ancho: 390, alto: 844 }, false],
  [{ ancho: 412, alto: 915 }, false],
  [{ ancho: 768, alto: 1024 }, true],
  [{ ancho: 1440, alto: 900 }, true],
];

/** Que `encuadre` se vea entero, sin salirse de la pantalla ni quedar bajo la interfaz. */
const seVeEntero = (encuadre: Rectangulo, pantalla: Pantalla, escritorio: boolean) => {
  const { recuadro, centro } = encuadrar(encuadre, pantalla, escritorio);
  const donde = `${pantalla.ancho}×${pantalla.alto}`;
  assert.isAtLeast(recuadro.x0, 0, donde);
  assert.isAtLeast(recuadro.y0, 0, donde);
  assert.isAtMost(recuadro.x1, pantalla.ancho, donde);
  assert.isAtMost(recuadro.y1, pantalla.alto, donde);
  for (const tapado of interfaz(pantalla, escritorio)) {
    assert.isFalse(seTocan(recuadro, tapado), `${donde}: bajo ${JSON.stringify(tapado)}`);
  }
  // El mapa solo aparta el centro que sale de los límites: este se queda donde lo pone el encuadre.
  assert.isTrue(contiene(ESPANA.limites, centro), donde);
};

describe("el encuadre al abrir", () => {
  it("la península se ve entera, sin nada encima, en los móviles, una tableta y un portátil", () => {
    for (const [pantalla, escritorio] of PANTALLAS) {
      seVeEntero(ESPANA.encuadre, pantalla, escritorio);
    }
  });

  it("con un punto, su provincia se ve entera y más de cerca que la península", () => {
    const madrid = encuadreInicial({ punto: EN_MADRID, provinciaDelPunto: MADRID_ENTERA });
    assert.deepStrictEqual(madrid, MADRID_ENTERA);
    for (const [pantalla, escritorio] of PANTALLAS) {
      seVeEntero(MADRID_ENTERA, pantalla, escritorio);
      const zoom = (encuadre: Rectangulo) =>
        zoomParaEncuadrar(encuadre, pantalla, rellenoDeLaVista(encuadre, pantalla, escritorio));
      assert.isAbove(zoom(MADRID_ENTERA), zoom(ESPANA.encuadre) + 2);
    }
    const enElMovil = { ancho: 390, alto: 844 };
    assert.closeTo(
      zoomParaEncuadrar(
        MADRID_ENTERA,
        enElMovil,
        rellenoDeLaVista(MADRID_ENTERA, enElMovil, false),
      ),
      7.4,
      0.2,
    );
  });

  it("en el móvil la península va encima de los controles; en un portátil, a su izquierda", () => {
    const movil = rellenoDeLaVista(ESPANA.encuadre, { ancho: 390, alto: 844 }, false);
    assert.isAbove(movil.bottom, movil.right);
    const portatil = rellenoDeLaVista(ESPANA.encuadre, { ancho: 1440, alto: 900 }, true);
    assert.isAbove(portatil.right, portatil.bottom);
  });

  it("al abrir con la península no se pide ninguna provincia: se ve el resumen", () => {
    for (const [pantalla, escritorio] of PANTALLAS) {
      const relleno = rellenoDeLaVista(ESPANA.encuadre, pantalla, escritorio);
      const zoom = zoomParaEncuadrar(ESPANA.encuadre, pantalla, relleno);
      assert.deepStrictEqual(provinciasDeLaVista(CATALUNA, { caja: ESPANA.encuadre, zoom }), []);
    }
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
  });
  const [mapa, setMapa] = createSignal<MapaQueSeEncuadra>();
  let vista: ReturnType<typeof crearVistaInicial> | undefined;
  render(() => {
    vista = crearVistaInicial({
      activa,
      alAbrir,
      mapa,
      relleno: (encuadre) => rellenoDeLaVista(encuadre, { ancho: 390, alto: 844 }, false),
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

const SUROESTE: [number, number] = [
  ESPANA.encuadre.suroeste.longitud,
  ESPANA.encuadre.suroeste.latitud,
];
const NORESTE: [number, number] = [
  ESPANA.encuadre.noreste.longitud,
  ESPANA.encuadre.noreste.latitud,
];

describe("crearVistaInicial", () => {
  it("con el mapa ya creado, lo encuadra una vez al saber qué se ve, sin animación", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa } = montar();
    ponerMapa(mapa);
    assert.lengthOf(encuadres, 0);
    abrir(SIN_PUNTO);
    assert.deepStrictEqual(encuadres, [[SUROESTE, NORESTE]]);
    // Que luego cambie lo que se sabe al abrir no lo vuelve a mover.
    abrir({ punto: EN_MADRID, provinciaDelPunto: MADRID_ENTERA });
    assert.lengthOf(encuadres, 1);
  });

  it("si ya se sabe al crear el mapa, el mapa nace ahí y no se vuelve a encuadrar", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar();
    abrir(SIN_PUNTO);
    assert.deepStrictEqual(vista()?.alCrear(), ESPANA.encuadre);
    ponerMapa(mapa);
    assert.lengthOf(encuadres, 0);
    assert.isUndefined(vista()?.alCrear());
  });

  it("si una persona mueve el mapa antes de saberlo, no se lo quita", () => {
    const { mapa, encuadres, gesto } = mapaDePrueba();
    const { abrir, ponerMapa } = montar();
    ponerMapa(mapa);
    gesto();
    abrir(SIN_PUNTO);
    assert.lengthOf(encuadres, 0);
  });

  it("si la web ya ha llevado el mapa a otro sitio, tampoco", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar();
    ponerMapa(mapa);
    vista()?.yaColocado();
    abrir(SIN_PUNTO);
    assert.lengthOf(encuadres, 0);
  });

  it("dice si aún puede mover el mapa, hasta ponerlo o hasta que otro lo mueva (#81)", () => {
    const puesta = mapaDePrueba();
    const conVista = montar();
    assert.isTrue(conVista.vista()?.pendiente());
    conVista.ponerMapa(puesta.mapa);
    assert.isTrue(conVista.vista()?.pendiente());
    conVista.abrir(SIN_PUNTO);
    assert.isFalse(conVista.vista()?.pendiente());

    const conGesto = mapaDePrueba();
    const movida = montar();
    movida.ponerMapa(conGesto.mapa);
    conGesto.gesto();
    flush();
    assert.isFalse(movida.vista()?.pendiente());

    const llevada = montar();
    llevada.vista()?.yaColocado();
    flush();
    assert.isFalse(llevada.vista()?.pendiente());

    const nacida = montar();
    nacida.abrir(SIN_PUNTO);
    assert.isTrue(nacida.vista()?.pendiente());
    nacida.vista()?.alCrear();
    flush();
    assert.isFalse(nacida.vista()?.pendiente());

    assert.isFalse(montar(false).vista()?.pendiente());
  });

  it("con un emplazamiento en la dirección no hace nada", () => {
    const { mapa, encuadres } = mapaDePrueba();
    const { abrir, ponerMapa, vista } = montar(false);
    ponerMapa(mapa);
    abrir(SIN_PUNTO);
    assert.lengthOf(encuadres, 0);
    assert.isUndefined(vista()?.encuadre());
  });
});
