import { assert, describe, it } from "@effect/vitest";
import { type AlmacenDelTema, CLAVE_DEL_TEMA } from "@celda/ui/temaElegido.ts";
import { createRoot, createSignal, flush } from "solid-js";

import { crearTema, repintarConElTema, type TemaDelSistema } from "./tema.ts";

const almacenDePrueba = (inicial: Record<string, string> = {}) => {
  const datos = new Map(Object.entries(inicial));
  const almacen: AlmacenDelTema = {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave),
  };
  return { almacen, datos };
};

/** Un documento propio, para no tocar el de las demás pruebas. */
const documentoDePrueba = (): Document => document.implementation.createHTMLDocument("Celda");

/**
 * El tema del sistema como `matchMedia`: avisa con `change` cuando cambia y cuenta quién lo
 * escucha.
 */
const sistemaDePrueba = () => {
  const escuchadores = new Set<() => void>();
  const consulta: TemaDelSistema = {
    addEventListener: (_tipo, escuchador) => void escuchadores.add(escuchador),
    removeEventListener: (_tipo, escuchador) => void escuchadores.delete(escuchador),
  };
  return {
    consulta,
    escuchadores,
    cambiar: () => {
      for (const escuchador of escuchadores) escuchador();
    },
  };
};

describe("elección de tema", () => {
  it("empieza con la guardada en el dispositivo y, sin ninguna, con Sistema", () => {
    createRoot((cerrar) => {
      assert.strictEqual(
        crearTema(documentoDePrueba(), almacenDePrueba().almacen).eleccion(),
        "sistema",
      );
      const guardado = almacenDePrueba({ [CLAVE_DEL_TEMA]: "oscuro" }).almacen;
      assert.strictEqual(crearTema(documentoDePrueba(), guardado).eleccion(), "oscuro");
      cerrar();
    });
  });

  it("elegir pone el tema en el documento en el momento y lo guarda", () => {
    const documento = documentoDePrueba();
    const { almacen, datos } = almacenDePrueba();
    const [tema, cerrar] = createRoot((cerrar) => [crearTema(documento, almacen), cerrar] as const);
    tema.elegir("oscuro");
    assert.strictEqual(documento.documentElement.getAttribute("data-tema"), "oscuro");
    flush();
    assert.strictEqual(tema.eleccion(), "oscuro");
    assert.strictEqual(datos.get(CLAVE_DEL_TEMA), "oscuro");
    assert.isFalse(tema.sinGuardar());

    tema.elegir("sistema");
    flush();
    assert.isNull(documento.documentElement.getAttribute("data-tema"));
    assert.isFalse(datos.has(CLAVE_DEL_TEMA));
    cerrar();
  });

  it("si no se puede guardar, se aplica igual y lo dice", () => {
    const documento = documentoDePrueba();
    const [tema, cerrar] = createRoot(
      (cerrar) => [crearTema(documento, undefined), cerrar] as const,
    );
    tema.elegir("claro");
    flush();
    assert.strictEqual(documento.documentElement.getAttribute("data-tema"), "claro");
    assert.isTrue(tema.sinGuardar());
    cerrar();
  });
});

describe("el mapa con el tema", () => {
  const montar = () => {
    const [lienzo, setLienzo] = createSignal<object>();
    const [eleccion, setEleccion] = createSignal<"sistema" | "claro" | "oscuro">("sistema");
    const sistema = sistemaDePrueba();
    let repintados = 0;
    const cerrar = createRoot((cerrar) => {
      repintarConElTema(
        lienzo,
        eleccion,
        () => (repintados += 1),
        () => sistema.consulta,
      );
      return cerrar;
    });
    flush();
    return {
      sistema,
      repintados: () => repintados,
      ponerMapa: () => {
        setLienzo({});
        flush();
      },
      elegir: (nueva: "sistema" | "claro" | "oscuro") => {
        setEleccion(nueva);
        flush();
      },
      cerrar,
    };
  };

  it("sin mapa no hace nada; con él, repinta una vez por si el tema cambió mientras se creaba", () => {
    const prueba = montar();
    assert.strictEqual(prueba.repintados(), 0);
    assert.strictEqual(prueba.sistema.escuchadores.size, 0);
    prueba.ponerMapa();
    assert.strictEqual(prueba.repintados(), 1);
    prueba.cerrar();
  });

  it("con Sistema repinta cada vez que el sistema cambia de tema", () => {
    const prueba = montar();
    prueba.ponerMapa();
    prueba.sistema.cambiar();
    prueba.sistema.cambiar();
    assert.strictEqual(prueba.repintados(), 3);
    prueba.cerrar();
    assert.strictEqual(prueba.sistema.escuchadores.size, 0);
  });

  it("al elegir un tema repinta sin recargar, y con Claro u Oscuro deja de seguir al sistema", () => {
    const prueba = montar();
    prueba.ponerMapa();
    prueba.elegir("oscuro");
    assert.strictEqual(prueba.repintados(), 2);
    assert.strictEqual(prueba.sistema.escuchadores.size, 0);
    prueba.sistema.cambiar();
    assert.strictEqual(prueba.repintados(), 2);

    prueba.elegir("claro");
    assert.strictEqual(prueba.repintados(), 3);

    // De vuelta a Sistema toma el tema del sistema y vuelve a seguirlo.
    prueba.elegir("sistema");
    assert.strictEqual(prueba.repintados(), 4);
    prueba.sistema.cambiar();
    assert.strictEqual(prueba.repintados(), 5);
    assert.strictEqual(prueba.sistema.escuchadores.size, 1);
    prueba.cerrar();
    assert.strictEqual(prueba.sistema.escuchadores.size, 0);
  });
});
