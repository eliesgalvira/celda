import type { Coordenada } from "@celda/dominio/area";
import type { FiltroDeCompanias } from "@celda/dominio/filtro";
import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { puntosDePrueba } from "../capa/pruebas.ts";
import type { PuntosDelMapa } from "../capa/puntos.ts";
import { crearPuntosEnMapa, type LienzoDePuntos } from "./enMapa.ts";

/** Un lienzo que apunta todo lo que recibe, en orden. */
const lienzoDePrueba = () => {
  const recibido: Array<string> = [];
  const lienzo: LienzoDePuntos = {
    ponerDatos: (url) => recibido.push(`datos ${url.startsWith("blob:") ? "blob" : url}`),
    mostrar: (visibles) => recibido.push(`mostrar ${visibles}`),
    apagar: (apagados) => recibido.push(`apagar ${apagados}`),
    filtrar: (filtro) => recibido.push(`filtrar ${filtro.join(",")}`),
    elegir: (posicion) => recibido.push(`elegir ${posicion?.longitud ?? "ninguno"}`),
    tocados: () => [],
  };
  return { lienzo, recibido };
};

const PUNTOS = puntosDePrueba([
  {
    codigo: "08",
    emplazamientos: [
      {
        clave: "movistar-1",
        posicion: { longitud: 2.17, latitud: 41.39 },
        estado: "verificado",
        companias: ["movistar"],
        barrio: null,
      },
    ],
  },
]);

describe("los puntos en el mapa", () => {
  it("pone cada cosa al cambiar, una vez, y los datos en una URL que dura la visita", () => {
    const { lienzo, recibido } = lienzoDePrueba();
    const [puntos, setPuntos] = createSignal<PuntosDelMapa>();
    const [visibles, setVisibles] = createSignal(false);
    const [apagados, setApagados] = createSignal(false);
    const [filtro, setFiltro] = createSignal<FiltroDeCompanias>([]);
    const [elegido, setElegido] = createSignal<Coordenada>();
    const creadas: Array<string> = [];
    const revocadas: Array<string> = [];
    const crear = URL.createObjectURL.bind(URL);
    const revocar = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = crear(blob);
      creadas.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revocadas.push(url);
      revocar(url);
    };
    try {
      const { unmount } = render(() => {
        crearPuntosEnMapa({
          lienzo: () => lienzo,
          puntos,
          visibles,
          apagados,
          filtro,
          elegido,
        });
        return null;
      });
      flush();
      assert.deepStrictEqual(recibido, [
        "mostrar false",
        "apagar false",
        "filtrar ",
        "elegir ninguno",
      ]);
      recibido.length = 0;

      setPuntos(PUNTOS);
      setVisibles(true);
      flush();
      assert.sameMembers(recibido, ["datos blob", "mostrar true"]);
      assert.lengthOf(creadas, 1);

      recibido.length = 0;
      setApagados(true);
      setFiltro(["digi"]);
      setElegido({ longitud: 2.17, latitud: 41.39 });
      flush();
      assert.sameMembers(recibido, ["apagar true", "filtrar digi", "elegir 2.17"]);

      // El mismo filtro en otra lista no vuelve a tocar el mapa.
      recibido.length = 0;
      setFiltro(["digi"]);
      flush();
      assert.deepStrictEqual(recibido, []);
      assert.lengthOf(creadas, 1);

      unmount();
      assert.deepStrictEqual(revocadas, creadas);
    } finally {
      URL.createObjectURL = crear;
      URL.revokeObjectURL = revocar;
    }
  });
});
