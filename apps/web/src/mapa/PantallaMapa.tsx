import { BARCELONA } from "@celda/dominio/area";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { BotonHexagonal } from "@celda/ui/BotonHexagonal.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createMemo, createSignal, Match, onSettled, Switch } from "solid-js";

import { CREDITOS_MAPA_BASE, type EstadoMapa, hayWebgl, type MotivoFallo } from "./estado.ts";

/** El mapa base de Barcelona a pantalla completa, con zoom y un aviso claro si no carga. */
export function PantallaMapa() {
  const [estado, setEstado] = createSignal<EstadoMapa>({ tipo: "cargando" });
  const listo = createMemo(() => estado().tipo === "listo");
  let contenedor: HTMLDivElement | undefined;
  let mapa: MapaMapLibre | undefined;
  // Cada arranque tiene su número; un arranque viejo o una pantalla ya cerrada
  // no crean mapa cuando MapLibre termina de descargarse.
  let intento = 0;

  const fallar = (motivo: MotivoFallo) => setEstado({ tipo: "fallo", motivo });

  const crear = (crearMapaBase: typeof import("./mapaBase.ts").crearMapaBase) => {
    if (contenedor === undefined) return;
    try {
      mapa = crearMapaBase(contenedor, BARCELONA, {
        listo: () => setEstado({ tipo: "listo" }),
        fallo: fallar,
      });
    } catch (causa) {
      // MapLibre lanza un Error que nombra WebGL si no consigue el contexto.
      fallar(causa instanceof Error && /webgl/iu.test(causa.message) ? "sin-webgl" : "interno");
    }
  };

  const arrancar = () => {
    intento += 1;
    const este = intento;
    mapa?.remove();
    mapa = undefined;
    if (!hayWebgl()) {
      fallar("sin-webgl");
      return;
    }
    setEstado({ tipo: "cargando" });
    // MapLibre pesa casi un mega: se descarga aparte para que la pantalla
    // salga antes. Si no llega, es que no hay conexión con Celda.
    void import("./mapaBase.ts").then(
      (modulo) => {
        if (este === intento) crear(modulo.crearMapaBase);
      },
      () => {
        if (este === intento) fallar("sin-respuesta");
      },
    );
  };

  onSettled(() => {
    arrancar();
    return () => {
      intento += 1;
      mapa?.remove();
    };
  });

  const aviso = createMemo(() => {
    const actual = estado();
    return actual.tipo === "listo" ? undefined : (
      <AvisoMapa estado={actual} reintentar={arrancar} />
    );
  });

  return (
    <DisposicionMapa
      nombre={`Mapa de ${BARCELONA.nombre}`}
      ocupado={estado().tipo === "cargando"}
      lienzo={(elemento) => {
        contenedor = elemento;
      }}
      cabecera={<Cabecera lugar={BARCELONA.nombre} />}
      controles={
        <>
          <BotonHexagonal
            etiqueta="Acercar"
            icono="+"
            disabled={!listo()}
            onClick={() => mapa?.zoomIn()}
          />
          <BotonHexagonal
            etiqueta="Alejar"
            icono="−"
            disabled={!listo()}
            onClick={() => mapa?.zoomOut()}
          />
        </>
      }
      atribucion={<Atribucion creditos={CREDITOS_MAPA_BASE} />}
      aviso={aviso()}
    />
  );
}

function AvisoMapa(props: { readonly estado: EstadoMapa; readonly reintentar: () => void }) {
  const reintentar = <Boton onClick={() => props.reintentar()}>Reintentar</Boton>;
  return (
    <Switch>
      <Match when={props.estado.tipo === "cargando"}>
        <Aviso tono="espera" titulo="Cargando el mapa base">
          El callejero llega desde OpenFreeMap.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo" && props.estado.motivo === "sin-webgl"}>
        <Aviso tono="fallo" titulo="Este navegador no puede dibujar el mapa">
          El mapa se dibuja con WebGL y este navegador lo tiene apagado o no lo admite. Prueba con
          otro navegador o activa la aceleración gráfica en su configuración.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo" && props.estado.motivo === "sin-respuesta"}>
        <Aviso tono="fallo" titulo="No se ha podido cargar el mapa base" acciones={reintentar}>
          El callejero viene de los servidores de OpenFreeMap y no ha llegado. Puede fallar la
          conexión o estar bloqueado el servidor.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo"}>
        <Aviso tono="fallo" titulo="Algo ha fallado al preparar el mapa" acciones={reintentar}>
          Es un error de Celda, no de tu conexión. Si se repite al reintentar, recarga la página.
        </Aviso>
      </Match>
    </Switch>
  );
}
