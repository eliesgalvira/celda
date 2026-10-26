import { assert, describe, it } from "@effect/vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
} from "solid-js";

import { avisosDeSolid } from "./pruebas/vigilante.ts";
import {
  MAXIMO_POR_SEGUNDO,
  mismasListas,
  mismosCampos,
  recurso,
  recursoFijo,
  vigilante,
} from "./recurso.ts";

/** Los códigos de los avisos de Solid desde el principio de la prueba. */
const codigosDeAvisos = () => (avisosDeSolid?.events ?? []).map((aviso) => aviso.code);

/**
 * Monta `montar` en una raíz y devuelve cómo desmontarla. Las señales se crean fuera: Solid no
 * deja escribirlas desde dentro de la raíz.
 */
const enRaiz = (montar: () => void): (() => void) =>
  createRoot((desmontar) => {
    montar();
    return desmontar;
  });

/**
 * Lo que hace la versión de Solid del catálogo con los efectos y que da forma a `recurso`,
 * comprobado aquí para que una subida de versión que lo cambie se note (docs/patterns/efectos.md).
 */
describe("Solid 2: efectos", () => {
  it("un efecto vuelve a correr, y limpia antes, aunque su primera función devuelva lo mismo", () => {
    const registro: Array<string> = [];
    const [estado, setEstado] = createSignal({ lecturas: 0, encendido: true });
    const desmontar = enRaiz(() => {
      createEffect(
        () => estado().encendido,
        (encendido) => {
          registro.push(`abre ${encendido}`);
          return () => registro.push("cierra");
        },
      );
    });
    flush();
    setEstado({ lecturas: 1, encendido: true });
    flush();
    setEstado({ lecturas: 2, encendido: true });
    flush();
    desmontar();
    assert.deepStrictEqual(registro, [
      "abre true",
      "cierra",
      "abre true",
      "cierra",
      "abre true",
      "cierra",
    ]);
  });

  it("`onCleanup` dentro de la segunda función de un efecto no se llama nunca", () => {
    const registro: Array<string> = [];
    const [n, setN] = createSignal(0);
    const desmontar = enRaiz(() => {
      createEffect(n, () => {
        onCleanup(() => registro.push("onCleanup"));
        return () => registro.push("devuelta");
      });
    });
    flush();
    setN(1);
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["devuelta", "devuelta"]);
    assert.deepStrictEqual(codigosDeAvisos(), ["NO_OWNER_CLEANUP", "NO_OWNER_CLEANUP"]);
    // El vigilante haría fallar esta prueba por el aviso que acaba de comprobar.
    avisosDeSolid?.clear();
  });
});

describe("recurso", () => {
  it("abre con la clave, no reabre con cambios que dan la misma clave y cierra al desmontar", () => {
    vigilante.reiniciar();
    const registro: Array<string> = [];
    const [estado, setEstado] = createSignal({ lecturas: 0, encendido: true });
    const desmontar = enRaiz(() => {
      recurso(
        "prueba:gps",
        () => estado().encendido,
        () => {
          registro.push("abre");
          return (siguiente) => registro.push(`cierra ${String(siguiente)}`);
        },
      );
    });
    flush();
    // Cada lectura escribe el estado, como el GPS: la clave sigue siendo `true`.
    for (let lecturas = 1; lecturas <= 50; lecturas += 1) {
      setEstado({ lecturas, encendido: true });
      flush();
    }
    assert.deepStrictEqual(registro, ["abre"]);
    setEstado({ lecturas: 51, encendido: false });
    flush();
    setEstado({ lecturas: 52, encendido: true });
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["abre", "cierra undefined", "abre", "cierra undefined"]);
    assert.strictEqual(vigilante.aperturas("prueba:gps"), 2);
  });

  it("al cambiar la clave cierra lo anterior pasándole la nueva y abre con ella", () => {
    const registro: Array<string> = [];
    const [clave, setClave] = createSignal<string | undefined>("a");
    const desmontar = enRaiz(() => {
      recurso("prueba:cambio", clave, (actual) => {
        registro.push(`abre ${actual}`);
        return (siguiente) => registro.push(`cierra ${actual} → ${String(siguiente)}`);
      });
    });
    flush();
    setClave("b");
    flush();
    setClave(undefined);
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["abre a", "cierra a → b", "abre b", "cierra b → undefined"]);
  });

  it("con un comparador, un objeto nuevo con los mismos campos no reabre", () => {
    let abiertos = 0;
    const lienzo = { nombre: "mapa" };
    const [n, setN] = createSignal(0);
    const [capa, setCapa] = createSignal<ReadonlyArray<number>>([1, 2]);
    const desmontar = enRaiz(() => {
      recurso(
        "prueba:calculo",
        () => ({ lienzo, capa: capa(), vuelta: n() > 5 }),
        () => {
          abiertos += 1;
          return undefined;
        },
        { iguales: mismosCampos },
      );
    });
    flush();
    setN(1);
    flush();
    setN(2);
    flush();
    assert.strictEqual(abiertos, 1);
    setCapa([1, 2]);
    flush();
    assert.strictEqual(abiertos, 2);
    desmontar();
  });

  it("lo que leen la apertura y el cierre no reabre nada ni hace avisar a Solid", () => {
    const registro: Array<string> = [];
    const [clave, setClave] = createSignal("a");
    const [otra, setOtra] = createSignal(0);
    const desmontar = enRaiz(() => {
      recurso("prueba:lecturas", clave, (actual) => {
        registro.push(`abre ${actual} ${otra()}`);
        return () => registro.push(`cierra ${actual} ${otra()}`);
      });
    });
    flush();
    setOtra(1);
    flush();
    setClave("b");
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["abre a 0", "cierra a 1", "abre b 1", "cierra b 1"]);
    assert.deepStrictEqual(codigosDeAvisos(), []);
  });

  it("una fila que sale de una lista en el mismo flush en que vuelve a correr cierra sus recursos", () => {
    const abiertos = new Set<string>();
    const [comun, setComun] = createSignal(0);
    const [lista, setLista] = createSignal(["a", "b", "c", "d"]);
    const desmontar = enRaiz(() => {
      const filas = mapArray(lista, (id) =>
        createMemo(() => {
          const valor = comun();
          recurso(
            `fila ${id}`,
            () => valor,
            (clave) => {
              abiertos.add(`${id} ${clave}`);
              return () => abiertos.delete(`${id} ${clave}`);
            },
          );
          return valor;
        }),
      );
      createEffect(
        () => filas().map((fila) => fila()),
        () => undefined,
      );
    });
    flush();
    setComun(1);
    setLista(["a", "c", "d"]);
    flush();
    assert.deepStrictEqual([...abiertos].toSorted(), ["a 1", "c 1", "d 1"]);
    setComun(2);
    flush();
    assert.deepStrictEqual([...abiertos].toSorted(), ["a 2", "c 2", "d 2"]);
    desmontar();
    assert.deepStrictEqual([...abiertos], []);
  });

  it("recursoFijo abre una vez y cierra al desmontar", () => {
    const registro: Array<string> = [];
    const desmontar = enRaiz(() => {
      recursoFijo("prueba:fijo", () => {
        registro.push("abre");
        return () => registro.push("cierra");
      });
    });
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["abre", "cierra"]);
  });

  it("el vigilante apunta un exceso si un recurso se reabre más veces por segundo de las normales", () => {
    vigilante.reiniciar();
    const [n, setN] = createSignal(0);
    const desmontar = enRaiz(() => {
      recurso("prueba:bucle", n, () => undefined);
    });
    flush();
    for (let i = 1; i <= MAXIMO_POR_SEGUNDO; i += 1) {
      setN(i);
      flush();
    }
    desmontar();
    assert.deepStrictEqual(vigilante.excesos(), [
      { nombre: "prueba:bucle", veces: MAXIMO_POR_SEGUNDO + 1, maximo: MAXIMO_POR_SEGUNDO },
    ]);
    vigilante.reiniciar();
  });

  it("compara listas y campos", () => {
    const x = { a: 1 };
    assert.isTrue(mismasListas([1, "a", x], [1, "a", x]));
    assert.isFalse(mismasListas([1, 2], [1, 2, 3]));
    assert.isFalse(mismasListas([{ a: 1 }], [{ a: 1 }]));
    assert.isTrue(mismosCampos({ a: 1, b: x }, { a: 1, b: x }));
    assert.isFalse(mismosCampos({ a: 1, b: x }, { a: 1, b: { a: 1 } }));
  });
});
