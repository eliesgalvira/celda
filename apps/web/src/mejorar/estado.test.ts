import { assert, describe, it } from "@effect/vitest";

import {
  type Disponibilidad,
  escuchando,
  type EventoBrujula,
  guiaDeGiro,
  inicialBrujula,
  lecturaDeOrientacion,
  rumboMostrado,
  type SituacionBrujula,
  transicionBrujula,
} from "./estado.ts";

const DISPONIBILIDADES: ReadonlyArray<Disponibilidad> = [
  "ordenador",
  "sin-api",
  "con-permiso",
  "sin-permiso",
];

const EVENTOS: ReadonlyArray<EventoBrujula> = [
  { tipo: "usar" },
  { tipo: "continuar" },
  { tipo: "cancelar" },
  { tipo: "permiso", permiso: "concedido" },
  { tipo: "permiso", permiso: "denegado" },
  { tipo: "lectura", lectura: { rumbo: 300, margen: undefined } },
  { tipo: "lectura", lectura: { rumbo: 12, margen: 8 } },
  { tipo: "lectura", lectura: { rumbo: 12, margen: 45 } },
  { tipo: "sin-lecturas" },
  { tipo: "apagar" },
];

/** Todas las situaciones a las que se llega desde el principio, con el evento que lleva a cada una. */
const alcanzables = (
  disponibilidad: Disponibilidad,
): ReadonlyArray<{ desde: SituacionBrujula; evento: EventoBrujula; hasta: SituacionBrujula }> => {
  const vistas = new Map<string, SituacionBrujula>();
  const pendientes = [inicialBrujula(disponibilidad)];
  const pasos: Array<{ desde: SituacionBrujula; evento: EventoBrujula; hasta: SituacionBrujula }> =
    [];
  while (pendientes.length > 0) {
    const desde = pendientes.pop();
    if (desde === undefined) break;
    const clave = JSON.stringify(desde);
    if (vistas.has(clave)) continue;
    vistas.set(clave, desde);
    for (const evento of EVENTOS) {
      const hasta = transicionBrujula(desde, evento);
      pasos.push({ desde, evento, hasta });
      pendientes.push(hasta);
    }
  }
  return pasos;
};

/** Aplica unos eventos seguidos. */
const tras = (
  disponibilidad: Disponibilidad,
  eventos: ReadonlyArray<EventoBrujula>,
): SituacionBrujula => eventos.reduce(transicionBrujula, inicialBrujula(disponibilidad));

describe("estado de la brújula", () => {
  it("en un ordenador o sin la API no hay brújula, y nada la enciende", () => {
    for (const disponibilidad of ["ordenador", "sin-api"] as const) {
      for (const { hasta } of alcanzables(disponibilidad)) {
        assert.deepStrictEqual(hasta.estado, { tipo: "sin-sensor", motivo: disponibilidad });
      }
    }
  });

  it("el permiso solo se pide después de la explicación", () => {
    for (const disponibilidad of DISPONIBILIDADES) {
      for (const { desde, evento, hasta } of alcanzables(disponibilidad)) {
        if (hasta.estado.tipo === "pidiendo-permiso" && desde.estado.tipo !== "pidiendo-permiso") {
          assert.strictEqual(desde.estado.tipo, "explicando");
          assert.strictEqual(evento.tipo, "continuar");
        }
      }
    }
  });

  it("donde no hace falta permiso, no se explica ni se pide", () => {
    for (const { hasta } of alcanzables("sin-permiso")) {
      assert.notInclude(["explicando", "pidiendo-permiso", "denegada"], hasta.estado.tipo);
    }
  });

  it("solo está activa tras una lectura de verdad, y solo cuenta la que se esperaba", () => {
    for (const disponibilidad of DISPONIBILIDADES) {
      for (const { desde, evento, hasta } of alcanzables(disponibilidad)) {
        const activa = hasta.estado.tipo === "activa" || hasta.estado.tipo === "dudosa";
        // Un evento que no cambia nada devuelve la misma situación.
        if (activa && hasta !== desde) assert.strictEqual(evento.tipo, "lectura");
        if (evento.tipo === "lectura" && !escuchando(desde.estado)) {
          assert.deepStrictEqual(hasta, desde);
        }
      }
    }
  });

  it("en el iPhone: usar, explicar, continuar, conceder y leer", () => {
    const pasos: ReadonlyArray<EventoBrujula> = [{ tipo: "usar" }];
    assert.strictEqual(tras("con-permiso", pasos).estado.tipo, "explicando");
    const pidiendo = [...pasos, { tipo: "continuar" } as const];
    assert.strictEqual(tras("con-permiso", pidiendo).estado.tipo, "pidiendo-permiso");
    const concedido = [...pidiendo, { tipo: "permiso", permiso: "concedido" } as const];
    assert.deepStrictEqual(tras("con-permiso", concedido), {
      disponibilidad: "con-permiso",
      concedido: true,
      estado: { tipo: "esperando" },
    });
    const leida = tras("con-permiso", [
      ...concedido,
      { tipo: "lectura", lectura: { rumbo: 12, margen: 8 } },
    ]);
    assert.deepStrictEqual(leida.estado, { tipo: "activa", lectura: { rumbo: 12, margen: 8 } });
    // Con el permiso ya dado, volver a usarla no lo explica otra vez.
    assert.strictEqual(
      tras("con-permiso", [...concedido, { tipo: "apagar" }, { tipo: "usar" }]).estado.tipo,
      "esperando",
    );
  });

  it("denegado el permiso, se puede volver a probar pasando otra vez por la explicación", () => {
    const denegada = tras("con-permiso", [
      { tipo: "usar" },
      { tipo: "continuar" },
      { tipo: "permiso", permiso: "denegado" },
    ]);
    assert.strictEqual(denegada.estado.tipo, "denegada");
    assert.isFalse(denegada.concedido);
    assert.strictEqual(transicionBrujula(denegada, { tipo: "usar" }).estado.tipo, "explicando");
  });

  it("cancelar la explicación no pide nada", () => {
    assert.strictEqual(
      tras("con-permiso", [{ tipo: "usar" }, { tipo: "cancelar" }]).estado.tipo,
      "apagada",
    );
  });

  it("con un margen grande la calibración es dudosa, y se recupera al mejorar", () => {
    const dudosa = tras("sin-permiso", [
      { tipo: "usar" },
      { tipo: "lectura", lectura: { rumbo: 12, margen: 45 } },
    ]);
    assert.strictEqual(dudosa.estado.tipo, "dudosa");
    assert.strictEqual(
      tras("sin-permiso", [
        { tipo: "usar" },
        { tipo: "lectura", lectura: { rumbo: 1, margen: -1 } },
      ]).estado.tipo,
      "dudosa",
    );
    assert.strictEqual(
      transicionBrujula(dudosa, { tipo: "lectura", lectura: { rumbo: 14, margen: 10 } }).estado
        .tipo,
      "activa",
    );
  });

  it("si no llega ninguna lectura, dice que no hay brújula y deja volver a probar", () => {
    const sin = tras("sin-permiso", [{ tipo: "usar" }, { tipo: "sin-lecturas" }]);
    assert.deepStrictEqual(sin.estado, { tipo: "sin-sensor", motivo: "sin-lecturas" });
    assert.strictEqual(transicionBrujula(sin, { tipo: "usar" }).estado.tipo, "esperando");
  });

  it("escucha el dispositivo solo mientras espera o lee", () => {
    const escuchados = new Set<string>();
    for (const disponibilidad of DISPONIBILIDADES) {
      for (const { hasta } of alcanzables(disponibilidad)) {
        if (escuchando(hasta.estado)) escuchados.add(hasta.estado.tipo);
      }
    }
    assert.deepStrictEqual([...escuchados].toSorted(), ["activa", "dudosa", "esperando"]);
  });

  it("sin lectura, la flecha sigue a la barra y lo dice", () => {
    assert.deepStrictEqual(rumboMostrado({ tipo: "apagada" }, 90), { rumbo: 90, fuente: "barra" });
    assert.deepStrictEqual(
      rumboMostrado({ tipo: "activa", lectura: { rumbo: 12, margen: undefined } }, 90),
      { rumbo: 12, fuente: "brujula" },
    );
  });
});

describe("guía de giro", () => {
  it("gira por el camino corto y dice cuándo está alineado", () => {
    assert.deepStrictEqual(guiaDeGiro(48, 300), {
      alineado: false,
      grados: 108,
      sentido: "derecha",
    });
    assert.deepStrictEqual(guiaDeGiro(300, 48), {
      alineado: false,
      grados: 108,
      sentido: "izquierda",
    });
    assert.isTrue(guiaDeGiro(2, 355).alineado);
    assert.isFalse(guiaDeGiro(48, 38).alineado);
  });
});

describe("lectura de un evento de orientación", () => {
  const vacio = {
    rumboSafari: undefined,
    margenSafari: undefined,
    alpha: undefined,
    absoluta: false,
  };

  it("en Safari usa el rumbo de la brújula y su margen", () => {
    assert.deepStrictEqual(
      lecturaDeOrientacion({ ...vacio, rumboSafari: 40, margenSafari: 12 }, 0),
      {
        rumbo: 40,
        margen: 12,
      },
    );
  });

  it("con alpha absoluto, el rumbo va en sentido contrario", () => {
    assert.deepStrictEqual(lecturaDeOrientacion({ ...vacio, alpha: 90, absoluta: true }, 0), {
      rumbo: 270,
      margen: undefined,
    });
  });

  it("un alpha relativo no es una brújula", () => {
    assert.isUndefined(lecturaDeOrientacion({ ...vacio, alpha: 90 }, 0));
    assert.isUndefined(lecturaDeOrientacion(vacio, 0));
  });

  it("corrige el giro de la pantalla en horizontal", () => {
    assert.strictEqual(lecturaDeOrientacion({ ...vacio, alpha: 0, absoluta: true }, 90)?.rumbo, 90);
    assert.strictEqual(lecturaDeOrientacion({ ...vacio, rumboSafari: 350 }, 90)?.rumbo, 80);
  });
});
