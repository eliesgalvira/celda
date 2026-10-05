import { ESQUEMA_AJUSTES } from "@celda/dominio/ajustes";
import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createSignal, flush } from "solid-js";

import { crearAjustes } from "../ajustes/ajustes.ts";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { type EstadoDeLasVecinas, VECINAS_LISTAS } from "../capa/vecinas.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import type { Esperar } from "../mapa/callejero.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { SALVEDAD_DE_LAS_CELDAS, type CalculoCeldas } from "./celdas.ts";
import {
  crearPistaDeCeldas,
  ESPERA_LENTA_MS,
  type PistaDeLasCeldas,
  SALVEDAD_MS,
} from "./pista.ts";

/** Un reloj de prueba: los plazos vencen al avanzarlo, como `setTimeout`. */
const relojDePrueba = () => {
  let ahora = 0;
  let plazos: Array<{ readonly vence: number; readonly alVencer: () => void }> = [];
  const esperar: Esperar = (ms, alVencer) => {
    const plazo = { vence: ahora + ms, alVencer };
    plazos.push(plazo);
    return () => {
      plazos = plazos.filter((otro) => otro !== plazo);
    };
  };
  const avanzar = (ms: number) => {
    ahora += ms;
    const vencidos = plazos.filter((plazo) => plazo.vence <= ahora);
    plazos = plazos.filter((plazo) => plazo.vence > ahora);
    for (const plazo of vencidos) plazo.alVencer();
    flush();
  };
  return { esperar, avanzar };
};

/** Monta la pista con señales que la prueba mueve. */
const montar = (vista: boolean | "sin-leer" = false) => {
  const reloj = relojDePrueba();
  const [cerca, setCerca] = createSignal(true);
  const [calculo, setCalculo] = createSignal<CalculoCeldas>("sin-pedir");
  const [vecinas, setVecinas] = createSignal<EstadoDeLasVecinas>(VECINAS_LISTAS);
  const [salvedadVista, setSalvedadVista] = createSignal<boolean | undefined>(
    vista === "sin-leer" ? undefined : vista,
  );
  let marcadas = 0;
  let pista: PistaDeLasCeldas | undefined;
  render(() => {
    pista = crearPistaDeCeldas({
      cerca,
      calculo,
      vecinas,
      salvedadVista,
      marcarSalvedadVista: () => {
        marcadas += 1;
        setSalvedadVista(true);
      },
      esperar: reloj.esperar,
    });
    return null;
  });
  flush();
  const texto = () => pista?.pista()?.texto;
  const poner = (nuevo: CalculoCeldas) => {
    setCalculo(nuevo);
    flush();
  };
  return {
    reloj,
    texto,
    poner,
    marcadas: () => marcadas,
    interactuar: () => {
      pista?.interactuar();
      flush();
    },
    setCerca: (valor: boolean) => {
      setCerca(valor);
      flush();
    },
    setVecinas: (valor: EstadoDeLasVecinas) => {
      setVecinas(valor);
      flush();
    },
    setSalvedadVista: (valor: boolean | undefined) => {
      setSalvedadVista(valor);
      flush();
    },
  };
};

describe("pista de las celdas en el mapa", () => {
  it("la salvedad sale la primera vez que hay celdas, se apunta y se va a los 5 s", () => {
    const m = montar();
    m.poner("calculando");
    m.poner("listas");
    assert.strictEqual(m.texto(), SALVEDAD_DE_LAS_CELDAS);
    assert.strictEqual(m.marcadas(), 1);
    m.reloj.avanzar(SALVEDAD_MS - 1);
    assert.strictEqual(m.texto(), SALVEDAD_DE_LAS_CELDAS);
    m.reloj.avanzar(1);
    assert.isUndefined(m.texto());
    assert.strictEqual(m.marcadas(), 1);
  });

  it("el primer gesto sobre el mapa la quita antes", () => {
    const m = montar();
    m.poner("listas");
    assert.strictEqual(m.texto(), SALVEDAD_DE_LAS_CELDAS);
    m.interactuar();
    assert.isUndefined(m.texto());
    // Tocar después no hace nada más.
    m.interactuar();
    m.reloj.avanzar(SALVEDAD_MS);
    assert.isUndefined(m.texto());
  });

  it("al mover el mapa y recalcular no dice nada, ni la espera ni la salvedad", () => {
    const m = montar();
    m.poner("listas");
    m.reloj.avanzar(SALVEDAD_MS);
    for (let vez = 0; vez < 3; vez++) {
      m.poner("calculando");
      assert.isUndefined(m.texto());
      m.reloj.avanzar(ESPERA_LENTA_MS * 3);
      assert.isUndefined(m.texto());
      m.poner("listas");
      assert.isUndefined(m.texto());
    }
    // Alejar y volver a acercar tampoco.
    m.setCerca(false);
    m.setCerca(true);
    m.poner("calculando");
    m.reloj.avanzar(ESPERA_LENTA_MS * 3);
    m.poner("listas");
    assert.isUndefined(m.texto());
    assert.strictEqual(m.marcadas(), 1);
  });

  it("un dispositivo que ya la ha visto no la vuelve a ver", () => {
    const m = montar(true);
    m.poner("listas");
    assert.isUndefined(m.texto());
    assert.strictEqual(m.marcadas(), 0);
  });

  it("mientras no se han leído los ajustes no sale; al leerlos, si no se ha visto, sí", () => {
    const m = montar("sin-leer");
    m.poner("listas");
    assert.isUndefined(m.texto());
    m.setSalvedadVista(false);
    assert.strictEqual(m.texto(), SALVEDAD_DE_LAS_CELDAS);
  });

  it("el primer cálculo solo se dice si tarda más de 1 s", () => {
    const m = montar(true);
    m.poner("calculando");
    m.reloj.avanzar(ESPERA_LENTA_MS - 1);
    assert.isUndefined(m.texto());
    m.reloj.avanzar(1);
    assert.strictEqual(m.texto(), "Calculando las celdas…");
    m.poner("listas");
    assert.isUndefined(m.texto());
  });

  it("una provincia vecina que tarda se dice solo antes de las primeras celdas", () => {
    const girona = { codigo: "17", nombre: "Girona" };
    const m = montar(true);
    m.setVecinas({ tipo: "cargando", provincias: [girona] });
    assert.isUndefined(m.texto());
    m.reloj.avanzar(ESPERA_LENTA_MS);
    assert.strictEqual(m.texto(), "Cargando Girona…");
    m.setVecinas(VECINAS_LISTAS);
    m.poner("listas");
    m.setVecinas({ tipo: "cargando", provincias: [girona] });
    m.reloj.avanzar(ESPERA_LENTA_MS * 3);
    assert.isUndefined(m.texto());
  });

  it("los fallos se dicen siempre, también con las celdas ya vistas", () => {
    const m = montar(true);
    m.poner("listas");
    m.poner("fallo");
    assert.strictEqual(m.texto(), "No se han podido calcular las celdas");
    m.setVecinas({ tipo: "fallo", provincias: [{ codigo: "17", nombre: "Girona" }] });
    assert.strictEqual(m.texto(), "Faltan las celdas junto a Girona");
  });
});

const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: Date.UTC(2026, 8, 25, 23, 44, 53),
  emplazamientos: [],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

describe("la salvedad de las celdas en el dispositivo", () => {
  /** Monta Celda con los ajustes del almacén y la pista con las celdas ya calculadas. */
  const visita = async (ubicacion: ReturnType<typeof ubicacionDePrueba>) => {
    let pista: PistaDeLasCeldas | undefined;
    let leidos: () => boolean = () => false;
    const { unmount } = render(() => (
      <ProveedorDeDatos
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.succeed(CAPA)]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacion.capa,
        )}
      >
        {(() => {
          const ajustes = crearAjustes(usarDatos());
          leidos = ajustes.leidos;
          pista = crearPistaDeCeldas({
            cerca: () => true,
            calculo: () => "listas",
            vecinas: () => VECINAS_LISTAS,
            salvedadVista: () =>
              ajustes.leidos() ? ajustes.ajustes().salvedadDeCeldasVista === true : undefined,
            marcarSalvedadVista: () => ajustes.marcarSalvedadDeCeldasVista(),
            esperar: relojDePrueba().esperar,
          });
          return null;
        })()}
      </ProveedorDeDatos>
    ));
    await waitFor(() => {
      flush();
      assert.isTrue(leidos());
    });
    flush();
    return { texto: () => pista?.pista()?.texto, desmontar: unmount };
  };

  it("sale en la primera visita, se guarda, y al volver a abrir Celda ya no sale", async () => {
    const ubicacion = ubicacionDePrueba({
      ajustes: { esquema: ESQUEMA_AJUSTES, modoEstudiante: false },
    });
    const primera = await visita(ubicacion);
    assert.strictEqual(primera.texto(), SALVEDAD_DE_LAS_CELDAS);
    await waitFor(() => assert.isTrue(ubicacion.almacen.ajustes().salvedadDeCeldasVista));
    primera.desmontar();

    const segunda = await visita(ubicacion);
    assert.isUndefined(segunda.texto());
    segunda.desmontar();
  });
});
