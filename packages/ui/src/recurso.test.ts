import { assert, describe, it } from "@effect/vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  onSettled,
  untrack,
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
 * Lo que hace Solid 2.0.0-rc.9 con los efectos y los memos, comprobado aquí para que una subida
 * de versión que lo cambie se note. Es la razón de `recurso` (docs/patterns/efectos.md).
 */
describe("Solid 2: igualdad de efectos y memos", () => {
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

  it("también si devuelve el mismo objeto", () => {
    let veces = 0;
    const mismo = { a: 1 };
    const [n, setN] = createSignal(0);
    const desmontar = enRaiz(() => {
      createEffect(
        () => {
          n();
          return mismo;
        },
        () => {
          veces += 1;
        },
      );
    });
    flush();
    setN(1);
    flush();
    desmontar();
    assert.strictEqual(veces, 2);
  });

  it("un memo compara con `===`: el mismo primitivo no avisa, un objeto nuevo igual sí", () => {
    const registro: Array<string> = [];
    const [estado, setEstado] = createSignal({ lecturas: 0, encendido: true });
    const desmontar = enRaiz(() => {
      const encendido = createMemo(() => estado().encendido);
      const envuelto = createMemo(() => ({ encendido: estado().encendido }));
      createEffect(encendido, () => {
        registro.push("primitivo");
      });
      createEffect(envuelto, () => {
        registro.push("objeto");
      });
    });
    flush();
    setEstado({ lecturas: 1, encendido: true });
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["primitivo", "objeto", "objeto"]);
  });

  it("un memo con `equals` compara con esa función", () => {
    let veces = 0;
    const [estado, setEstado] = createSignal({ lecturas: 0, encendido: true });
    const desmontar = enRaiz(() => {
      const envuelto = createMemo(() => ({ encendido: estado().encendido }), {
        equals: (a, b) => a.encendido === b.encendido,
      });
      createEffect(envuelto, () => {
        veces += 1;
      });
    });
    flush();
    setEstado({ lecturas: 1, encendido: true });
    flush();
    desmontar();
    assert.strictEqual(veces, 1);
  });

  it("una señal a la que se escribe el mismo valor no avisa", () => {
    let veces = 0;
    const [n, setN] = createSignal(1);
    const desmontar = enRaiz(() => {
      createEffect(n, () => {
        veces += 1;
      });
    });
    flush();
    setN(1);
    flush();
    desmontar();
    assert.strictEqual(veces, 1);
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

  it("`onSettled` corre una vez, no sigue lo que lee, y limpia al desmontar", () => {
    const registro: Array<string> = [];
    const [n, setN] = createSignal(0);
    const desmontar = enRaiz(() => {
      onSettled(() => {
        registro.push(`abre ${n()}`);
        return () => registro.push("cierra");
      });
    });
    flush();
    setN(1);
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["abre 0", "cierra"]);
  });

  it("leer una señal en la segunda función de un efecto avisa `STRICT_READ_UNTRACKED`, y con `untrack` no", () => {
    const [n, setN] = createSignal(0);
    const [otra] = createSignal("a");
    const desmontar = enRaiz(() => {
      createEffect(n, () => {
        untrack(otra);
      });
    });
    flush();
    setN(1);
    flush();
    assert.deepStrictEqual(codigosDeAvisos(), []);
    desmontar();
    const sinUntrack = enRaiz(() => {
      createEffect(n, () => {
        otra();
      });
    });
    flush();
    sinUntrack();
    assert.deepStrictEqual(codigosDeAvisos(), ["STRICT_READ_UNTRACKED"]);
    // El vigilante haría fallar esta prueba por el aviso que acaba de comprobar.
    avisosDeSolid?.clear();
  });

  it("`onCleanup` en el cuerpo del dueño se llama al desmontar", () => {
    const registro: Array<string> = [];
    const desmontar = enRaiz(() => {
      onCleanup(() => registro.push("cierra"));
    });
    flush();
    desmontar();
    assert.deepStrictEqual(registro, ["cierra"]);
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
