import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";

import { PuntoElegido } from "./MarcadorReferencia.tsx";

const montar = (arrastrable: boolean) => {
  const movimientos: Array<readonly [number, number]> = [];
  let soltado = 0;
  let alMapa = 0;
  const pantalla = render(() => (
    <div
      // Como el contenedor del mapa, que escucha el ratón para moverse.
      ref={(mapa) => {
        mapa.addEventListener("mousedown", () => {
          alMapa += 1;
        });
      }}
    >
      <PuntoElegido
        x={100}
        y={200}
        nombre="El punto elegido"
        arrastrable={arrastrable}
        alMover={(x, y) => movimientos.push([x, y])}
        alSoltar={() => {
          soltado += 1;
        }}
      />
    </div>
  ));
  return {
    punto: pantalla.getByRole("button", { name: "El punto elegido" }),
    movimientos,
    soltado: () => soltado,
    alMapa: () => alMapa,
  };
};

describe("PuntoElegido", () => {
  it("el ratón que lo arrastra no llega al mapa; si no se arrastra, sí", () => {
    const raton = montar(true);
    fireEvent.mouseDown(raton.punto, { button: 0 });
    assert.strictEqual(raton.alMapa(), 0);
    const dedo = montar(false);
    fireEvent.mouseDown(dedo.punto, { button: 0 });
    assert.strictEqual(dedo.alMapa(), 1);
  });

  it("con el teclado, las flechas lo mueven y soltar la tecla lo deja ahí", () => {
    const { punto, movimientos, soltado } = montar(true);
    fireEvent.keyDown(punto, { key: "ArrowRight" });
    fireEvent.keyDown(punto, { key: "ArrowUp", shiftKey: true });
    assert.deepStrictEqual(movimientos, [
      [110, 200],
      [100, 150],
    ]);
    fireEvent.keyUp(punto, { key: "ArrowUp" });
    assert.strictEqual(soltado(), 1);
    // Otras teclas no lo mueven.
    fireEvent.keyDown(punto, { key: "a" });
    assert.lengthOf(movimientos, 2);
  });

  it("con el ratón se arrastra; con el dedo no, para que el dedo mueva el mapa", () => {
    const raton = montar(true);
    fireEvent.pointerDown(raton.punto, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(raton.punto, { pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent.pointerUp(raton.punto, { pointerId: 1 });
    assert.lengthOf(raton.movimientos, 1);
    assert.strictEqual(raton.soltado(), 1);

    const dedo = montar(false);
    fireEvent.pointerDown(dedo.punto, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.pointerMove(dedo.punto, { pointerId: 2, clientX: 30, clientY: 40 });
    fireEvent.pointerUp(dedo.punto, { pointerId: 2 });
    assert.lengthOf(dedo.movimientos, 0);
    assert.strictEqual(dedo.soltado(), 0);
  });
});
