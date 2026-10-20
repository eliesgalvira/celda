import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  CALENDARIO,
  describirProgramada,
  type EjecucionProgramada,
  proximaEjecucion,
} from "./calendario.ts";
import { describirLoQueQueda } from "./programa.ts";

const enMadrid = (instante: number) =>
  DateTime.toParts(DateTime.makeZonedUnsafe(instante, { timeZone: "Europe/Madrid" }));

describe("calendario de la ingesta (ADR 0029)", () => {
  it("el primer sábado de cada mes y el domingo siguiente, a las 00:30 de Madrid", () => {
    // El martes 20/10/2026, la próxima es la del sábado 7 de noviembre: el 1 es domingo.
    const sabado = proximaEjecucion(CALENDARIO, Date.UTC(2026, 9, 20, 12));
    assert.deepStrictEqual(sabado, { instante: Date.UTC(2026, 10, 6, 23, 30), dia: "sabado" });
    const domingo = proximaEjecucion(CALENDARIO, sabado.instante);
    assert.deepStrictEqual(domingo, { instante: Date.UTC(2026, 10, 7, 23, 30), dia: "domingo" });
    // Después del domingo, nada entre semana: la siguiente es la del primer sábado de diciembre.
    assert.deepStrictEqual(proximaEjecucion(CALENDARIO, domingo.instante), {
      instante: Date.UTC(2026, 11, 4, 23, 30),
      dia: "sabado",
    });
    // Un mes que empieza en sábado, en horario de verano: el sábado 1 y el domingo 2 de agosto.
    assert.deepStrictEqual(proximaEjecucion(CALENDARIO, Date.UTC(2026, 6, 20)), {
      instante: Date.UTC(2026, 6, 31, 22, 30),
      dia: "sabado",
    });
    // Y de un año al siguiente: el sábado 2 de enero de 2027.
    assert.deepStrictEqual(proximaEjecucion(CALENDARIO, Date.UTC(2026, 11, 7)), {
      instante: Date.UTC(2027, 0, 1, 23, 30),
      dia: "sabado",
    });
  });

  it("durante cinco años, cada ejecución cae en el primer sábado del mes o en el domingo siguiente, a su hora, y ninguna entre semana", () => {
    const vistas: Array<EjecucionProgramada> = [];
    for (let ahora = Date.UTC(2026, 9, 20); vistas.length < 120;) {
      const siguiente = proximaEjecucion(CALENDARIO, ahora);
      vistas.push(siguiente);
      ahora = siguiente.instante;
    }
    for (const { instante, dia } of vistas) {
      const local = enMadrid(instante);
      assert.deepStrictEqual([local.hour, local.minute], [0, 30]);
      if (dia === "sabado") {
        assert.strictEqual(local.weekDay, 6);
        assert.isAtMost(local.day, 7);
      } else {
        assert.strictEqual(local.weekDay, 0);
        assert.isAtLeast(local.day, 2);
        assert.isAtMost(local.day, 8);
      }
    }
    // Dos por mes, una tras otra.
    assert.deepStrictEqual(
      vistas.slice(0, 4).map((v) => v.dia),
      ["sabado", "domingo", "sabado", "domingo"],
    );
  });

  it("dice la próxima con su día, su fecha, su hora y su zona horaria", () => {
    assert.strictEqual(
      describirProgramada(CALENDARIO, { instante: Date.UTC(2026, 10, 7, 23, 30), dia: "domingo" }),
      "domingo 8/11/2026 a las 00:30 (Europe/Madrid)",
    );
    const canarias = { minuto: 75, zonaHoraria: "Atlantic/Canary" };
    const enCanarias = proximaEjecucion(canarias, Date.UTC(2026, 9, 20));
    assert.strictEqual(
      describirProgramada(canarias, enCanarias),
      "sábado 7/11/2026 a las 01:15 (Atlantic/Canary)",
    );
  });

  it("el diario dice lo que queda de la ronda y qué ejecución lo lee", () => {
    const domingo: EjecucionProgramada = {
      instante: Date.UTC(2026, 10, 7, 23, 30),
      dia: "domingo",
    };
    const diciembre: EjecucionProgramada = {
      instante: Date.UTC(2026, 11, 4, 23, 30),
      dia: "sabado",
    };
    assert.deepStrictEqual(describirLoQueQueda({ zonas: [], fichas: 0 }, domingo, CALENDARIO), {
      aviso: false,
      texto:
        "La ronda está entera, así que la ejecución del domingo 8/11/2026 a las 00:30 " +
        "(Europe/Madrid) no pedirá nada al registro",
    });
    assert.deepStrictEqual(
      describirLoQueQueda({ zonas: ["norte"], fichas: 1204 }, domingo, CALENDARIO),
      {
        aviso: false,
        texto:
          "Lo que queda de la ronda, 1 zona (norte) y 1204 fichas, lo lee la ejecución del " +
          "domingo 8/11/2026 a las 00:30 (Europe/Madrid)",
      },
    );
    // Si ya no queda otra ejecución este mes, es un aviso.
    assert.deepStrictEqual(describirLoQueQueda({ zonas: [], fichas: 37 }, diciembre, CALENDARIO), {
      aviso: true,
      texto:
        "Lo que queda de la ronda, 37 fichas, se queda sin leer este mes, porque no hay otra " +
        "ejecución hasta la del sábado 5/12/2026 a las 00:30 (Europe/Madrid), que empieza otra " +
        "ronda",
    });
    assert.deepStrictEqual(describirLoQueQueda({ zonas: [], fichas: 0 }, diciembre, CALENDARIO), {
      aviso: false,
      texto:
        "La ronda está entera. La próxima ejecución es la del sábado 5/12/2026 a las 00:30 " +
        "(Europe/Madrid), que empieza otra",
    });
  });
});
