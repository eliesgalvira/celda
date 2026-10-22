import type { PuntoElegido } from "@celda/dominio/aportacion";
import { assert, describe, it } from "@effect/vitest";

import {
  asentado,
  type EstadoUbicacion,
  type EventoUbicacion,
  gpsEncendido,
  INICIAL,
  type LecturaGps,
  type Permiso,
  referenciaDe,
  transicion,
  type Ubicacion,
} from "./estado.ts";

const LECTURA: LecturaGps = {
  posicion: { longitud: 2.1136, latitud: 41.3884 },
  precision: 25,
  fecha: Date.UTC(2026, 8, 26, 10),
};

const PUNTO: PuntoElegido = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: Date.UTC(2026, 8, 26, 9),
  origen: "mapa",
  posicion: { longitud: 2.1128, latitud: 41.3903 },
};

const OTRO_PUNTO: PuntoElegido = {
  ...PUNTO,
  id: "0f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  origen: "busqueda",
  posicion: { longitud: 2.17, latitud: 41.387 },
};

/** Aplica los eventos uno detrás de otro. */
const tras = (inicio: Ubicacion, ...eventos: ReadonlyArray<EventoUbicacion>): Ubicacion =>
  eventos.reduce(transicion, inicio);

const con = (permiso: Permiso, estado: EstadoUbicacion = { tipo: "ninguna" }): Ubicacion => ({
  estado,
  permiso,
  aviso: undefined,
});

describe("estado de la ubicación: pedir el permiso", () => {
  it("empieza sin punto de referencia y con el permiso sin saber", () => {
    assert.deepStrictEqual(INICIAL.estado, { tipo: "ninguna" });
    assert.strictEqual(INICIAL.permiso, "desconocido");
    assert.isUndefined(referenciaDe(INICIAL.estado));
  });

  it("antes de pedir el permiso explica para qué se usa; solo al continuar se pide", () => {
    for (const permiso of ["preguntar", "desconocido"] as const) {
      const explicando = tras(con(permiso), { tipo: "usar-ubicacion" });
      assert.strictEqual(explicando.estado.tipo, "explicando");
      assert.isFalse(gpsEncendido(explicando.estado));

      const pidiendo = transicion(explicando, { tipo: "continuar" });
      assert.deepStrictEqual(pidiendo.estado, { tipo: "pidiendo", anterior: { tipo: "ninguna" } });
      assert.isTrue(gpsEncendido(pidiendo.estado));
    }
  });

  it("con el permiso ya concedido no hay aviso del navegador, así que no hace falta el paso previo", () => {
    const pidiendo = tras(con("concedido"), { tipo: "usar-ubicacion" });
    assert.strictEqual(pidiendo.estado.tipo, "pidiendo");
  });

  it("la primera lectura da la ubicación GPS con su precisión, y las siguientes la ponen al día", () => {
    const gps = tras(
      con("preguntar"),
      { tipo: "usar-ubicacion" },
      { tipo: "continuar" },
      { tipo: "lectura", lectura: LECTURA },
    );
    assert.deepStrictEqual(gps.estado, { tipo: "gps", lectura: LECTURA });
    assert.strictEqual(gps.permiso, "concedido");
    assert.deepStrictEqual(referenciaDe(gps.estado), { tipo: "gps", lectura: LECTURA });

    const mejor = { ...LECTURA, precision: 8 };
    assert.deepStrictEqual(transicion(gps, { tipo: "lectura", lectura: mejor }).estado, {
      tipo: "gps",
      lectura: mejor,
    });
  });

  it("cancelar el paso previo o la espera vuelve a donde estaba, con su punto", () => {
    const conPunto = con("preguntar", { tipo: "elegida", punto: PUNTO });
    const explicando = transicion(conPunto, { tipo: "usar-ubicacion" });
    // Mientras tanto, el punto elegido sigue siendo la referencia.
    assert.deepStrictEqual(referenciaDe(explicando.estado), { tipo: "elegido", punto: PUNTO });
    assert.deepStrictEqual(transicion(explicando, { tipo: "cancelar" }).estado, conPunto.estado);

    const pidiendo = transicion(explicando, { tipo: "continuar" });
    assert.deepStrictEqual(transicion(pidiendo, { tipo: "cancelar" }).estado, conPunto.estado);
  });

  it("desde el paso previo se puede ir a elegir en el mapa", () => {
    const eligiendo = tras(
      con("preguntar"),
      { tipo: "usar-ubicacion" },
      { tipo: "elegir-en-mapa" },
    );
    assert.deepStrictEqual(eligiendo.estado, { tipo: "eligiendo", anterior: { tipo: "ninguna" } });
  });
});

describe("estado de la ubicación: permiso denegado", () => {
  it("si se deniega en el aviso del navegador, queda denegada y lo avisa", () => {
    const denegada = tras(
      con("preguntar"),
      { tipo: "usar-ubicacion" },
      { tipo: "continuar" },
      { tipo: "fallo-gps", motivo: "denegado" },
    );
    assert.deepStrictEqual(denegada, {
      estado: { tipo: "denegada" },
      permiso: "denegado",
      aviso: "denegado",
    });
    assert.isFalse(gpsEncendido(denegada.estado));
  });

  it("el navegador puede decirlo por los dos lados; el segundo no cambia nada", () => {
    const pidiendo = tras(con("preguntar"), { tipo: "usar-ubicacion" }, { tipo: "continuar" });
    const porPermiso = tras(
      pidiendo,
      { tipo: "permiso", permiso: "denegado" },
      { tipo: "fallo-gps", motivo: "denegado" },
    );
    const porFallo = tras(
      pidiendo,
      { tipo: "fallo-gps", motivo: "denegado" },
      { tipo: "permiso", permiso: "denegado" },
    );
    assert.deepStrictEqual(porPermiso, porFallo);
    assert.strictEqual(porPermiso.estado.tipo, "denegada");
  });

  it("con el permiso bloqueado, usar la ubicación no pide nada", () => {
    const denegada = con("denegado", { tipo: "denegada" });
    assert.deepStrictEqual(transicion(denegada, { tipo: "usar-ubicacion" }), denegada);
  });

  it("al saber de entrada que está bloqueado, pasa de ninguna a denegada", () => {
    assert.deepStrictEqual(transicion(INICIAL, { tipo: "permiso", permiso: "denegado" }).estado, {
      tipo: "denegada",
    });
  });

  it("si se desbloquea en los ajustes, vuelve a ninguna y se puede pedir otra vez", () => {
    const desbloqueada = transicion(con("denegado", { tipo: "denegada" }), {
      tipo: "permiso",
      permiso: "preguntar",
    });
    assert.deepStrictEqual(desbloqueada.estado, { tipo: "ninguna" });
    assert.strictEqual(
      transicion(desbloqueada, { tipo: "usar-ubicacion" }).estado.tipo,
      "explicando",
    );
  });

  it("si se bloquea mientras se usa, la ubicación deja de valer en el acto", () => {
    const gps = con("concedido", { tipo: "gps", lectura: LECTURA });
    const bloqueada = transicion(gps, { tipo: "permiso", permiso: "denegado" });
    assert.deepStrictEqual(bloqueada.estado, { tipo: "denegada" });
    assert.isUndefined(referenciaDe(bloqueada.estado));
  });

  it("si se bloquea tras un fallo del GPS, queda denegada y lo avisa: volver a intentarlo no serviría", () => {
    const fallida = tras(
      con("concedido"),
      { tipo: "usar-ubicacion" },
      { tipo: "fallo-gps", motivo: "sin-senal" },
    );
    assert.deepStrictEqual(fallida.estado, { tipo: "fallo", motivo: "sin-senal" });
    const bloqueada = transicion(fallida, { tipo: "permiso", permiso: "denegado" });
    assert.deepStrictEqual(bloqueada.estado, { tipo: "denegada" });
    assert.strictEqual(bloqueada.aviso, "denegado");
    assert.deepStrictEqual(
      transicion(bloqueada, { tipo: "permiso", permiso: "concedido" }).estado,
      { tipo: "ninguna" },
    );
  });

  it("sin https o sin la API, el fallo sigue aunque se bloquee: desbloquearlo no lo arreglaría", () => {
    const sinApi = con("preguntar", { tipo: "fallo", motivo: "no-disponible" });
    assert.deepStrictEqual(transicion(sinApi, { tipo: "permiso", permiso: "denegado" }).estado, {
      tipo: "fallo",
      motivo: "no-disponible",
    });
  });

  it("si se bloquea durante el paso previo, el paso previo se cierra", () => {
    const explicando = transicion(con("preguntar"), { tipo: "usar-ubicacion" });
    assert.deepStrictEqual(
      transicion(explicando, { tipo: "permiso", permiso: "denegado" }).estado,
      { tipo: "denegada" },
    );
  });

  it("con un punto elegido, denegar el GPS conserva el punto y avisa", () => {
    const tras_ = tras(
      con("preguntar", { tipo: "elegida", punto: PUNTO }),
      { tipo: "usar-ubicacion" },
      { tipo: "continuar" },
      { tipo: "fallo-gps", motivo: "denegado" },
    );
    assert.deepStrictEqual(tras_, {
      estado: { tipo: "elegida", punto: PUNTO },
      permiso: "denegado",
      aviso: "denegado",
    });
  });

  it("quitar el punto con el permiso bloqueado deja la ubicación denegada, no ninguna", () => {
    const sinPunto = transicion(con("denegado", { tipo: "elegida", punto: PUNTO }), {
      tipo: "quitar",
    });
    assert.deepStrictEqual(sinPunto.estado, { tipo: "denegada" });
  });
});

describe("estado de la ubicación: fallos y lecturas tardías", () => {
  it("sin señal o sin respuesta a tiempo lo dice, y se puede volver a intentar", () => {
    for (const motivo of ["sin-senal", "sin-fuente", "tiempo-agotado", "no-disponible"] as const) {
      const fallo = tras(
        con("preguntar"),
        { tipo: "usar-ubicacion" },
        { tipo: "continuar" },
        { tipo: "fallo-gps", motivo },
      );
      assert.deepStrictEqual(fallo, {
        estado: { tipo: "fallo", motivo },
        permiso: "preguntar",
        aviso: motivo,
      });
      assert.strictEqual(transicion(fallo, { tipo: "usar-ubicacion" }).estado.tipo, "explicando");
    }
  });

  it("una lectura que llega tras quitar o cancelar se descarta", () => {
    const pidiendo = tras(con("concedido"), { tipo: "usar-ubicacion" });
    for (const salida of [{ tipo: "cancelar" }, { tipo: "quitar" }] as const) {
      const fuera = transicion(pidiendo, salida);
      assert.deepStrictEqual(transicion(fuera, { tipo: "lectura", lectura: LECTURA }), fuera);
    }
  });

  it("un fallo que llega cuando ya no se espera nada no cambia el estado", () => {
    const elegida = con("concedido", { tipo: "elegida", punto: PUNTO });
    assert.deepStrictEqual(
      transicion(elegida, { tipo: "fallo-gps", motivo: "sin-senal" }),
      elegida,
    );
  });

  it("lo siguiente que hace la persona borra el aviso", () => {
    const fallo = tras(
      con("preguntar"),
      { tipo: "usar-ubicacion" },
      { tipo: "continuar" },
      { tipo: "fallo-gps", motivo: "tiempo-agotado" },
    );
    assert.isUndefined(transicion(fallo, { tipo: "cerrar-aviso" }).aviso);
    assert.isUndefined(transicion(fallo, { tipo: "elegir-en-mapa" }).aviso);
  });
});

describe("estado de la ubicación: encender, quitar y volver a encender", () => {
  it("tras quitar la ubicación GPS se puede volver a pedir, y la nueva lectura vale", () => {
    const primera = tras(
      con("preguntar"),
      { tipo: "usar-ubicacion" },
      { tipo: "continuar" },
      { tipo: "permiso", permiso: "concedido" },
      { tipo: "lectura", lectura: LECTURA },
    );
    assert.strictEqual(primera.estado.tipo, "gps");
    const apagada = transicion(primera, { tipo: "quitar" });
    assert.deepStrictEqual(apagada.estado, { tipo: "ninguna" });
    assert.isFalse(gpsEncendido(apagada.estado));

    // El permiso ya está dado: vuelve a pedirla sin el paso previo.
    const otraVez = transicion(apagada, { tipo: "usar-ubicacion" });
    assert.deepStrictEqual(otraVez.estado, { tipo: "pidiendo", anterior: { tipo: "ninguna" } });
    assert.isTrue(gpsEncendido(otraVez.estado));
    const mejor = { ...LECTURA, precision: 9 };
    assert.deepStrictEqual(transicion(otraVez, { tipo: "lectura", lectura: mejor }).estado, {
      tipo: "gps",
      lectura: mejor,
    });
  });

  it("al recargar con el permiso ya concedido, pedirla enciende el GPS sin paso previo", () => {
    const recargada = transicion(INICIAL, { tipo: "permiso", permiso: "concedido" });
    assert.deepStrictEqual(recargada.estado, { tipo: "ninguna" });
    const pidiendo = transicion(recargada, { tipo: "usar-ubicacion" });
    assert.strictEqual(pidiendo.estado.tipo, "pidiendo");
    assert.isTrue(gpsEncendido(pidiendo.estado));
  });

  it("al recargar, si se pide antes de saber el permiso, pasa por el paso previo", () => {
    const explicando = transicion(INICIAL, { tipo: "usar-ubicacion" });
    assert.strictEqual(explicando.estado.tipo, "explicando");
    // El permiso llega mientras tanto: el paso previo sigue y continuar enciende el GPS.
    const pidiendo = tras(
      explicando,
      { tipo: "permiso", permiso: "concedido" },
      { tipo: "continuar" },
    );
    assert.strictEqual(pidiendo.estado.tipo, "pidiendo");
  });

  it("mientras se busca la ubicación se puede ir a elegir en el mapa, y deja de buscarla", () => {
    const pidiendo = tras(con("concedido"), { tipo: "usar-ubicacion" });
    const eligiendo = transicion(pidiendo, { tipo: "elegir-en-mapa" });
    assert.deepStrictEqual(eligiendo.estado, { tipo: "eligiendo", anterior: { tipo: "ninguna" } });
    assert.isFalse(gpsEncendido(eligiendo.estado));
  });

  it("si la ubicación no llega, se puede volver a intentar sin recargar", () => {
    for (const motivo of ["sin-senal", "sin-fuente", "tiempo-agotado"] as const) {
      const fallo = tras(
        con("concedido"),
        { tipo: "usar-ubicacion" },
        { tipo: "fallo-gps", motivo },
      );
      assert.deepStrictEqual(fallo.estado, { tipo: "fallo", motivo });
      assert.isFalse(gpsEncendido(fallo.estado));
      const otraVez = transicion(fallo, { tipo: "usar-ubicacion" });
      assert.strictEqual(otraVez.estado.tipo, "pidiendo", motivo);
      assert.isUndefined(otraVez.aviso);
    }
  });
});

describe("estado de la ubicación: punto elegido", () => {
  it("elegir un punto lo convierte en la referencia y apaga el GPS", () => {
    const elegida = tras(
      con("concedido", { tipo: "gps", lectura: LECTURA }),
      { tipo: "elegir-en-mapa" },
      { tipo: "elegido", punto: PUNTO },
    );
    assert.deepStrictEqual(elegida.estado, { tipo: "elegida", punto: PUNTO });
    assert.isFalse(gpsEncendido(elegida.estado));
  });

  it("mientras se elige, la referencia sigue siendo la anterior; cancelar la conserva", () => {
    const gps = con("concedido", { tipo: "gps", lectura: LECTURA });
    const eligiendo = transicion(gps, { tipo: "elegir-en-mapa" });
    assert.deepStrictEqual(referenciaDe(eligiendo.estado), { tipo: "gps", lectura: LECTURA });
    assert.deepStrictEqual(transicion(eligiendo, { tipo: "cancelar" }), gps);
  });

  it("mientras se elige con la ubicación GPS de referencia, el GPS sigue encendido y al día", () => {
    const eligiendo = transicion(con("concedido", { tipo: "gps", lectura: LECTURA }), {
      tipo: "elegir-en-mapa",
    });
    assert.isTrue(gpsEncendido(eligiendo.estado));
    const mejor = { ...LECTURA, precision: 6 };
    assert.deepStrictEqual(transicion(eligiendo, { tipo: "lectura", lectura: mejor }).estado, {
      tipo: "eligiendo",
      anterior: { tipo: "gps", lectura: mejor },
    });
    // «Usar mi ubicación» vuelve a ella sin pedir nada.
    assert.deepStrictEqual(transicion(eligiendo, { tipo: "usar-ubicacion" }).estado, {
      tipo: "gps",
      lectura: LECTURA,
    });
  });

  it("arrastrar el punto elegido lo cambia sin pasar por elegir", () => {
    const elegida = con("preguntar", { tipo: "elegida", punto: PUNTO });
    assert.deepStrictEqual(transicion(elegida, { tipo: "elegido", punto: OTRO_PUNTO }).estado, {
      tipo: "elegida",
      punto: OTRO_PUNTO,
    });
  });

  it("el punto guardado se recupera solo si la persona aún no ha hecho nada", () => {
    assert.deepStrictEqual(transicion(INICIAL, { tipo: "restaurado", punto: PUNTO }).estado, {
      tipo: "elegida",
      punto: PUNTO,
    });
    const eligiendo = transicion(INICIAL, { tipo: "elegir-en-mapa" });
    assert.deepStrictEqual(transicion(eligiendo, { tipo: "restaurado", punto: PUNTO }), eligiendo);
    const elegida = con("preguntar", { tipo: "elegida", punto: OTRO_PUNTO });
    assert.deepStrictEqual(transicion(elegida, { tipo: "restaurado", punto: PUNTO }), elegida);
  });

  it("quitar deja la ubicación en ninguna", () => {
    for (const estado of [
      { tipo: "elegida", punto: PUNTO },
      { tipo: "gps", lectura: LECTURA },
      { tipo: "fallo", motivo: "sin-senal" },
    ] as const) {
      assert.deepStrictEqual(transicion(con("concedido", estado), { tipo: "quitar" }).estado, {
        tipo: "ninguna",
      });
    }
  });
});

// Todos los estados a los que se puede llegar desde el inicio con estos eventos, en cualquier
// orden, para comprobar las reglas que no se pueden romper nunca.
const PERMISOS: ReadonlyArray<Permiso> = ["concedido", "preguntar", "denegado", "desconocido"];
const EVENTOS: ReadonlyArray<EventoUbicacion> = [
  ...PERMISOS.map((permiso) => ({ tipo: "permiso", permiso }) as const),
  { tipo: "restaurado", punto: PUNTO },
  { tipo: "usar-ubicacion" },
  { tipo: "continuar" },
  { tipo: "cancelar" },
  { tipo: "elegir-en-mapa" },
  { tipo: "lectura", lectura: LECTURA },
  ...(["denegado", "sin-senal", "sin-fuente", "tiempo-agotado", "no-disponible"] as const).map(
    (motivo) => ({ tipo: "fallo-gps", motivo }) as const,
  ),
  { tipo: "elegido", punto: OTRO_PUNTO },
  { tipo: "quitar" },
  { tipo: "cerrar-aviso" },
];

const alcanzables = (): ReadonlyArray<Ubicacion> => {
  const vistos = new Map<string, Ubicacion>([[JSON.stringify(INICIAL), INICIAL]]);
  const pendientes = [INICIAL];
  for (let actual = pendientes.pop(); actual !== undefined; actual = pendientes.pop()) {
    for (const evento of EVENTOS) {
      const siguiente = transicion(actual, evento);
      const clave = JSON.stringify(siguiente);
      if (!vistos.has(clave)) {
        vistos.set(clave, siguiente);
        pendientes.push(siguiente);
      }
    }
  }
  return [...vistos.values()];
};
const TODAS = alcanzables();

/**
 * Un estado es coherente si no dice «denegada» con el permiso sin bloquear, ni al revés, y si con
 * el permiso bloqueado no queda nada del GPS: ni su lectura ni un fallo que ofrezca volver a
 * intentarlo.
 */
const coherente = (ubicacion: Ubicacion): boolean => {
  const actual =
    ubicacion.estado.tipo === "explicando" ||
    ubicacion.estado.tipo === "pidiendo" ||
    ubicacion.estado.tipo === "eligiendo"
      ? ubicacion.estado.anterior
      : ubicacion.estado;
  if (actual.tipo === "denegada") return ubicacion.permiso === "denegado";
  if (actual.tipo === "ninguna") return ubicacion.permiso !== "denegado";
  if (actual.tipo === "gps") return ubicacion.permiso !== "denegado";
  if (actual.tipo === "fallo" && actual.motivo !== "no-disponible") {
    return ubicacion.permiso !== "denegado";
  }
  return true;
};

const describir = (ubicacion: Ubicacion, evento: EventoUbicacion) =>
  `${JSON.stringify(ubicacion)} + ${JSON.stringify(evento)}`;

describe("estado de la ubicación: reglas para cualquier estado y evento", () => {
  it(`nunca se enciende el GPS sin el paso previo, salvo con el permiso ya concedido (${TODAS.length} estados × ${EVENTOS.length} eventos)`, () => {
    for (const antes of TODAS) {
      for (const evento of EVENTOS) {
        const despues = transicion(antes, evento);
        if (!gpsEncendido(antes.estado) && gpsEncendido(despues.estado)) {
          const trasPasoPrevio = antes.estado.tipo === "explicando" && evento.tipo === "continuar";
          const yaConcedido = antes.permiso === "concedido" && evento.tipo === "usar-ubicacion";
          assert.isTrue(trasPasoPrevio || yaConcedido, describir(antes, evento));
        }
      }
    }
  });

  it("la ubicación GPS solo sale de una lectura que se estaba esperando, o de volver a ella", () => {
    for (const antes of TODAS) {
      for (const evento of EVENTOS) {
        const despues = transicion(antes, evento);
        if (despues.estado.tipo === "gps" && asentado(antes.estado).tipo !== "gps") {
          assert.strictEqual(antes.estado.tipo, "pidiendo", describir(antes, evento));
          assert.strictEqual(evento.tipo, "lectura", describir(antes, evento));
        }
      }
    }
  });

  it("con el permiso bloqueado, ni hay ubicación GPS ni se pide ni se explica", () => {
    for (const antes of TODAS) {
      for (const evento of EVENTOS) {
        const despues = transicion(antes, evento);
        if (despues.permiso === "denegado") {
          assert.notInclude(
            ["gps", "pidiendo", "explicando"],
            despues.estado.tipo,
            describir(antes, evento),
          );
        }
      }
    }
  });

  it("quitar nunca impide volver a encender el GPS, salvo con el permiso bloqueado", () => {
    for (const antes of TODAS) {
      const apagada = transicion(antes, { tipo: "quitar" });
      const pedida = transicion(apagada, { tipo: "usar-ubicacion" });
      const encendida =
        pedida.estado.tipo === "explicando" ? transicion(pedida, { tipo: "continuar" }) : pedida;
      assert.strictEqual(
        gpsEncendido(encendida.estado),
        antes.permiso !== "denegado",
        describir(antes, { tipo: "quitar" }),
      );
      if (antes.permiso === "concedido") {
        assert.strictEqual(pedida.estado.tipo, "pidiendo", "con el permiso dado no se explica");
      }
    }
  });

  it("de buscar la ubicación siempre se sale: cancelar, elegir en el mapa, quitar, leer o fallar", () => {
    const salidas: ReadonlyArray<EventoUbicacion> = [
      { tipo: "cancelar" },
      { tipo: "elegir-en-mapa" },
      { tipo: "quitar" },
      { tipo: "lectura", lectura: LECTURA },
      ...(["denegado", "sin-senal", "sin-fuente", "tiempo-agotado", "no-disponible"] as const).map(
        (motivo) => ({ tipo: "fallo-gps", motivo }) as const,
      ),
    ];
    const pidiendo = TODAS.filter((u) => u.estado.tipo === "pidiendo");
    assert.isNotEmpty(pidiendo);
    for (const antes of pidiendo) {
      for (const evento of salidas) {
        assert.notStrictEqual(
          transicion(antes, evento).estado.tipo,
          "pidiendo",
          describir(antes, evento),
        );
      }
    }
  });

  it("quitar siempre deja sin punto de referencia y con el GPS apagado", () => {
    for (const antes of TODAS) {
      const despues = transicion(antes, { tipo: "quitar" });
      assert.isUndefined(referenciaDe(despues.estado), describir(antes, { tipo: "quitar" }));
      assert.isFalse(gpsEncendido(despues.estado));
    }
  });

  it("llega a todos los estados de la ubicación, y todos son coherentes", () => {
    const tipos = new Set(TODAS.map((u) => u.estado.tipo));
    assert.sameMembers(
      [...tipos],
      ["ninguna", "denegada", "gps", "elegida", "fallo", "explicando", "pidiendo", "eligiendo"],
    );
    for (const ubicacion of TODAS) {
      assert.isTrue(coherente(ubicacion), JSON.stringify(ubicacion));
    }
  });

  it("los estados de paso siempre recuerdan un asentado, nunca otro estado de paso", () => {
    for (const antes of TODAS) {
      for (const evento of EVENTOS) {
        const despues = transicion(antes, evento).estado;
        if ("anterior" in despues) {
          assert.notInclude(["explicando", "pidiendo", "eligiendo"], despues.anterior.tipo);
        }
      }
    }
  });
});
