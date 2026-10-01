import type { Compania } from "@celda/dominio/compania";
import { DURACION_MOVIMIENTO_MS, type Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { MarcadorAgrupacion } from "@celda/ui/marcadores/MarcadorAgrupacion.tsx";
import { type FormaDeZona, MarcadorZona } from "@celda/ui/marcadores/MarcadorZona.tsx";
import {
  CapaDeMarcadores,
  MarcadorEmplazamiento,
} from "@celda/ui/marcadores/MarcadorEmplazamiento.tsx";
import { recurso } from "@celda/ui/recurso.ts";
import { createEffect, createMemo, createSignal, For, Match, Switch } from "solid-js";

import {
  type ElementoAbrible,
  type Escena,
  SIN_TRANSICION,
  type Transicion,
} from "../capa/agrupacion.ts";
import {
  coberturaDe,
  nombreDeAgrupacion,
  nombreDeBarrio,
  nombreDeMarcador,
  nombreDeMunicipio,
  nombreDeProvincia,
} from "../capa/marcadores.ts";
import {
  type Pintado,
  type Proyectar,
  quitarLosIdos,
  siguientesPintados,
} from "../capa/pintados.ts";

export interface CapaAgrupadaProps {
  /** El elemento del mapa que recibe los gestos; los marcadores van dentro (ver `CapaDeMarcadores`). */
  readonly contenedor: HTMLElement;
  /** Todas las combinaciones de compañías de la capa. */
  readonly combinaciones: ReadonlyArray<ReadonlyArray<Compania>>;
  /** Lo que se ve ahora. Al cambiar de nivel, los marcadores se agrupan o se separan. */
  readonly escena: Escena | undefined;
  readonly transicion: (antes: Escena, despues: Escena) => Transicion;
  readonly proyectar: Proyectar;
  /** Si un punto de la pantalla se ve: solo se anima lo que se ve. */
  readonly seVe: (punto: Salto) => boolean;
  /** Cambia en cada fotograma en que se mueve el mapa: los marcadores se vuelven a colocar. */
  readonly fotograma: number;
  /** La preferencia de reducir movimiento: sin transiciones. */
  readonly movimientoReducido: boolean;
  /** Qué forma toma la etiqueta de cada zona; la que no esté aquí va completa. */
  readonly formas: ReadonlyMap<string, FormaDeZona>;
  /** Clave del emplazamiento con la ficha abierta: su marcador se resalta. */
  readonly seleccionada: string | null;
  /** Se ha pulsado el marcador de un emplazamiento: se abre su ficha. */
  readonly alSeleccionar: (clave: string) => void;
  /** Se ha pulsado una agrupación o una zona: hay que acercar el mapa a ella. */
  readonly alAbrir: (elemento: ElementoAbrible) => void;
}

/**
 * Los marcadores de la escena: logos para los emplazamientos sueltos y hexágonos con número para
 * las agrupaciones y las zonas (provincias, municipios y barrios), que llevan además su nombre.
 * Al alejar, cada marcador que se agrupa se desliza hacia su hexágono; al acercar, sale de él. Lo
 * que se va sigue en el DOM mientras dura la transición y luego se quita.
 */
export function CapaAgrupada(props: CapaAgrupadaProps) {
  const [pintados, setPintados] = createSignal<ReadonlyArray<Pintado>>([]);
  /** Si queda algo yéndose: mientras tanto se mira en cada fotograma. */
  const [animando, setAnimando] = createSignal(false);
  let anterior: Escena | undefined;
  let quitarHasta = 0;

  createEffect(
    () => ({
      escena: props.escena,
      reducido: props.movimientoReducido,
      transicion: props.transicion,
      proyectar: props.proyectar,
      seVe: props.seVe,
    }),
    ({ escena, reducido, transicion, proyectar, seVe }) => {
      const antes = anterior;
      anterior = escena;
      if (escena === undefined) {
        setPintados([]);
        return;
      }
      const t = antes === undefined || reducido ? SIN_TRANSICION : transicion(antes, escena);
      const ahora = performance.now();
      setPintados((actuales) =>
        siguientesPintados(actuales, {
          anterior: antes,
          nueva: escena,
          transicion: t,
          proyectar,
          seVe,
          ahora,
          reducido,
        }),
      );
      quitarHasta = ahora + DURACION_MOVIMIENTO_MS;
      setAnimando(true);
    },
  );

  // Lo que se va se quita del DOM cuando termina su transición. Se mira en cada fotograma
  // mientras quede algo yéndose, que es como mucho `DURACION_MOVIMIENTO_MS` tras el último cambio;
  // un cambio a mitad alarga la espera sin volver a empezar.
  recurso("marcadores:latido", animando, () => {
    let latido = 0;
    const latir = (ahora: number) => {
      setPintados((actuales) => quitarLosIdos(actuales, ahora));
      if (ahora < quitarHasta) {
        latido = requestAnimationFrame(latir);
      } else {
        latido = 0;
        setAnimando(false);
      }
    };
    latido = requestAnimationFrame(latir);
    return () => cancelAnimationFrame(latido);
  });

  return (
    <CapaDeMarcadores
      nombre="Emplazamientos"
      contenedor={props.contenedor}
      combinaciones={props.combinaciones}
    >
      <For each={pintados()} keyed={(pintado) => pintado.elemento.clave}>
        {(pintado) => (
          <MarcadorPintado
            pintado={pintado()}
            fotograma={props.fotograma}
            proyectar={props.proyectar}
            formas={props.formas}
            seleccionada={props.seleccionada}
            alSeleccionar={(clave) => props.alSeleccionar(clave)}
            alAbrir={(elemento) => props.alAbrir(elemento)}
          />
        )}
      </For>
    </CapaDeMarcadores>
  );
}

function MarcadorPintado(props: {
  readonly pintado: Pintado;
  readonly fotograma: number;
  readonly proyectar: Proyectar;
  readonly formas: ReadonlyMap<string, FormaDeZona>;
  readonly seleccionada: string | null;
  readonly alSeleccionar: (clave: string) => void;
  readonly alAbrir: (elemento: ElementoAbrible) => void;
}) {
  const punto = createMemo(() => {
    // La proyección cambia con cada fotograma aunque no lo lea.
    void props.fotograma;
    return props.proyectar(props.pintado.elemento.posicion);
  });
  const emplazamiento = () => {
    const elemento = props.pintado.elemento;
    return elemento.tipo === "emplazamiento" ? elemento : undefined;
  };
  const agrupacion = () => {
    const elemento = props.pintado.elemento;
    return elemento.tipo === "agrupacion" ? elemento : undefined;
  };
  const barrio = () => {
    const elemento = props.pintado.elemento;
    return elemento.tipo === "barrio" ? elemento : undefined;
  };
  const municipio = () => {
    const elemento = props.pintado.elemento;
    return elemento.tipo === "municipio" ? elemento : undefined;
  };
  const provincia = () => {
    const elemento = props.pintado.elemento;
    return elemento.tipo === "provincia" ? elemento : undefined;
  };
  return (
    <Switch>
      <Match when={emplazamiento()}>
        {(suelto) => (
          <MarcadorEmplazamiento
            x={punto().x}
            y={punto().y}
            companias={suelto().emplazamiento.companias}
            estado={suelto().emplazamiento.estado}
            nombre={nombreDeMarcador(suelto().emplazamiento)}
            seleccionado={props.seleccionada === suelto().emplazamiento.clave}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alSeleccionar(suelto().emplazamiento.clave)}
          />
        )}
      </Match>
      <Match when={agrupacion()}>
        {(agrupada) => (
          <MarcadorAgrupacion
            x={punto().x}
            y={punto().y}
            cuantos={agrupada().cuantos}
            nombre={nombreDeAgrupacion(agrupada().cuantos)}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alAbrir(agrupada())}
          />
        )}
      </Match>
      <Match when={barrio()}>
        {(elegido) => (
          <MarcadorZona
            x={punto().x}
            y={punto().y}
            zona="barrio"
            forma={props.formas.get(elegido().clave) ?? "completa"}
            nombreDeZona={elegido().resumen.barrio.nombre}
            emplazamientos={elegido().resumen.emplazamientos}
            ausentes={elegido().resumen.ausentes}
            nombre={nombreDeBarrio(elegido().resumen)}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alAbrir(elegido())}
          />
        )}
      </Match>
      <Match when={municipio()}>
        {(elegido) => (
          <MarcadorZona
            x={punto().x}
            y={punto().y}
            zona="municipio"
            forma={props.formas.get(elegido().clave) ?? "completa"}
            nombreDeZona={elegido().resumen.municipio.nombre}
            emplazamientos={elegido().resumen.emplazamientos}
            ausentes={elegido().resumen.ausentes}
            nombre={nombreDeMunicipio(elegido().resumen)}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alAbrir(elegido())}
          />
        )}
      </Match>
      <Match when={provincia()}>
        {(hexagono) => (
          <MarcadorZona
            x={punto().x}
            y={punto().y}
            zona="provincia"
            forma={props.formas.get(hexagono().clave) ?? "completa"}
            nombreDeZona={hexagono().provincia.nombre}
            emplazamientos={hexagono().provincia.emplazamientos}
            cobertura={coberturaDe(hexagono())}
            carga={hexagono().carga}
            ausentes={hexagono().ausentes}
            nombre={nombreDeProvincia(hexagono())}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alAbrir(hexagono())}
          />
        )}
      </Match>
    </Switch>
  );
}
