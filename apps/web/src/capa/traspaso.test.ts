import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";

import { crearAgrupador, type Escena, SIN_TRANSICION } from "./agrupacion.ts";
import { siguientesPintados } from "./pintados.ts";
import { type EstadoDelTraspaso, puntosDelTraspaso, siguienteTraspaso } from "./traspaso.ts";

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
  barrio: null,
  lote: 0,
  provincia: "08",
  municipio: null,
});

// Dos casi juntos, que van en una agrupación a zoom 15, y uno suelto.
const JUNTOS = [emplazamiento("a", 2.17, 41.39), emplazamiento("b", 2.17005, 41.39003)];
const SUELTO = emplazamiento("c", 2.18, 41.4);
const AGRUPADOR = crearAgrupador([...JUNTOS, SUELTO]);
const CAJA = {
  suroeste: { longitud: 2.1, latitud: 41.3 },
  noreste: { longitud: 2.3, latitud: 41.5 },
};
const ESCENA = AGRUPADOR.escena(15, CAJA);
const TODO_SE_VE = () => true;

describe("los puntos del paso entre los puntos y los logos", () => {
  it("cada punto va a su logo o al hexágono que lo recoge", () => {
    const puntos = puntosDelTraspaso(ESCENA, AGRUPADOR.emplazamientosDe, TODO_SE_VE);
    const agrupacion = [...ESCENA.elementos.values()].find((e) => e.tipo === "agrupacion");
    assert.isDefined(agrupacion);
    assert.deepStrictEqual(puntos.map((p) => [p.clave, p.marcador]).toSorted(), [
      ["a", agrupacion?.posicion],
      ["b", agrupacion?.posicion],
      ["c", SUELTO.posicion],
    ]);
  });

  it("solo los que se ven, o cuyo marcador se ve, y como mucho los que caben", () => {
    const seVe = (p: Coordenada) => p.longitud > 2.175;
    assert.deepStrictEqual(
      puntosDelTraspaso(ESCENA, AGRUPADOR.emplazamientosDe, seVe).map((p) => p.clave),
      ["c"],
    );
    assert.lengthOf(puntosDelTraspaso(ESCENA, AGRUPADOR.emplazamientosDe, TODO_SE_VE, 2), 2);
  });

  it("cada logo crece desde el tamaño de su punto, también sin cambiar de nivel", () => {
    const vacia: Escena = { nivel: 15, elementos: new Map() };
    const cambio = {
      anterior: vacia,
      nueva: ESCENA,
      transicion: SIN_TRANSICION,
      proyectar: () => ({ x: 100, y: 100 }),
      seVe: () => true,
      ahora: 0,
      reducido: false,
    };
    const conTraspaso = siguientesPintados([], { ...cambio, escalaDeTraspaso: 0.27 });
    assert.deepStrictEqual(conTraspaso.map((p) => [p.elemento.tipo, p.movimiento]).toSorted(), [
      ["agrupacion", { tipo: "entra", desde: undefined }],
      ["emplazamiento", { tipo: "entra", desde: undefined, escala: 0.27 }],
    ]);
    // Sin el paso, en el mismo nivel no se anima nada.
    assert.isTrue(siguientesPintados([], cambio).every((p) => p.movimiento.tipo === "quieto"));
    // Con la preferencia de reducir movimiento, tampoco.
    assert.isTrue(
      siguientesPintados([], { ...cambio, escalaDeTraspaso: 0.27, reducido: true }).every(
        (p) => p.movimiento.tipo === "quieto",
      ),
    );
  });
});

describe("cuándo hay paso entre los puntos y los logos", () => {
  const VACIA: Escena = { nivel: 14, elementos: new Map() };
  const paso = (
    antes: EstadoDelTraspaso | undefined,
    vista: "puntos" | "agrupada",
    con: boolean,
    escena: Escena,
  ) => siguienteTraspaso(antes, { vista, con, escena });

  it("con la vista de puntos, al salir los logos y al irse", () => {
    const inicio = paso(undefined, "puntos", false, VACIA);
    assert.isUndefined(inicio.traspaso);
    const acercar = paso(inicio, "puntos", true, ESCENA);
    assert.deepInclude(acercar.traspaso, { hacia: "logos", marcadores: ESCENA, llega: ESCENA });
    // Mientras siguen los logos, el paso es el mismo.
    assert.strictEqual(paso(acercar, "puntos", true, ESCENA).traspaso, acercar.traspaso);
    const alejar = paso(acercar, "puntos", false, VACIA);
    assert.deepInclude(alejar.traspaso, { hacia: "puntos", marcadores: ESCENA, llega: VACIA });
  });

  it("al cambiar de vista no hay paso, y el anterior deja de valer", () => {
    const conLogos = paso(paso(undefined, "puntos", false, VACIA), "puntos", true, ESCENA);
    // A la agrupada con los logos a la vista: siguen los marcadores, el paso es el de antes.
    const agrupada = paso(conLogos, "agrupada", true, ESCENA);
    assert.strictEqual(agrupada.traspaso, conLogos.traspaso);
    // De vuelta a los puntos de lejos: los marcadores se van sin paso, y los puntos se encienden.
    const puntos = paso(agrupada, "puntos", false, VACIA);
    assert.isUndefined(puntos.traspaso);
    assert.isFalse(puntos.con);
    assert.strictEqual(puntos.ultima, ESCENA);
  });
});
