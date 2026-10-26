import { type FiltroDeCompanias, resaltadasDe, SIN_FILTRO } from "@celda/dominio/filtro";
import { DURACION_MOVIMIENTO_MS, type Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import type { LogoDeMarcador } from "@celda/ui/marcadores/LogoCompanias.tsx";
import { MarcadorAgrupacion } from "@celda/ui/marcadores/MarcadorAgrupacion.tsx";
import { type FormaDeZona, MarcadorZona } from "@celda/ui/marcadores/MarcadorZona.tsx";
import type { TamanoDeMarcador } from "@celda/ui/marcadores/tamano.ts";
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
  /** Los logos que pueden salir: cada combinación de compañías de la capa con lo que resalta. */
  readonly logos: ReadonlyArray<LogoDeMarcador>;
  /**
   * Las compañías que se ven (ADR 0026): los marcadores resaltan las suyas, y los nombres
   * accesibles dicen de quién son los emplazamientos que se cuentan. Sin él, todas.
   */
  readonly filtro?: FiltroDeCompanias;
  /** Lo que se ve ahora. Al cambiar de nivel, los marcadores se agrupan o se separan. */
  readonly escena: Escena | undefined;
  readonly transicion: (antes: Escena, despues: Escena) => Transicion;
  /** Dónde cae un punto del mapa en la lámina, que va desplazada `salto` respecto a la pantalla. */
  readonly proyectar: Proyectar;
  /** Si un punto de la lámina se ve en la pantalla: solo se anima lo que se ve. */
  readonly seVe: (punto: Salto) => boolean;
  /** El zoom al que se colocan los marcadores: al cambiar, se vuelven a colocar. */
  readonly zoom: number;
  /** Lo que se ha desplazado el mapa desde que se colocaron: lo que se mueve su lámina. */
  readonly salto: Salto;
  /** La preferencia de reducir movimiento: sin transiciones. */
  readonly movimientoReducido: boolean;
  /** Qué forma toma la etiqueta de cada zona; la que no esté aquí va completa. */
  readonly formas: ReadonlyMap<string, FormaDeZona>;
  /**
   * Las zonas que ceden su sitio a un rótulo de ciudad o a otra zona con más habitantes (ADR 0024):
   * no se dibujan hasta que, al acercar, dejan de chocar. Sin ella, se dibujan todas.
   */
  readonly ocultos?: ReadonlySet<string>;
  /** Lo grande que van los hexágonos al zoom de la escena. Sin él, `normal`. */
  readonly tamano?: TamanoDeMarcador;
  /** Clave del emplazamiento con la ficha abierta: su marcador se resalta. */
  readonly seleccionada: string | null;
  /** Se ha pulsado el marcador de un emplazamiento: se abre su ficha. */
  readonly alSeleccionar: (clave: string, provincia: string) => void;
  /** Se ha pulsado una agrupación o una zona: hay que acercar el mapa a ella. */
  readonly alAbrir: (elemento: ElementoAbrible) => void;
  /**
   * En la vista de puntos, la escena que llega con el paso entre los puntos y los logos, y lo
   * pequeño que es un punto al lado de un logo: con ella cada logo crece desde su punto o se
   * encoge hasta él (ADR 0028).
   */
  readonly traspaso?: { readonly escena: Escena; readonly escala: number } | undefined;
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
      traspaso: props.traspaso,
    }),
    ({ escena, reducido, transicion, proyectar, seVe, traspaso }) => {
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
          escalaDeTraspaso: traspaso?.escena === escena ? traspaso.escala : undefined,
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

  /** Lo que se dibuja: lo pintado menos lo que cede su sitio. Cambia al decidir, no al moverse. */
  const visibles = createMemo(() => {
    const ocultos = props.ocultos;
    return ocultos === undefined || ocultos.size === 0
      ? pintados()
      : pintados().filter((pintado) => !ocultos.has(pintado.elemento.clave));
  });

  return (
    <CapaDeMarcadores
      nombre="Emplazamientos"
      contenedor={props.contenedor}
      logos={props.logos}
      salto={props.salto}
    >
      <For each={visibles()} keyed={(pintado) => pintado.elemento.clave}>
        {(pintado) => (
          <MarcadorPintado
            pintado={pintado()}
            zoom={props.zoom}
            proyectar={props.proyectar}
            formas={props.formas}
            tamano={props.tamano ?? "normal"}
            filtro={props.filtro ?? SIN_FILTRO}
            seleccionada={props.seleccionada}
            alSeleccionar={(clave, provincia) => props.alSeleccionar(clave, provincia)}
            alAbrir={(elemento) => props.alAbrir(elemento)}
          />
        )}
      </For>
    </CapaDeMarcadores>
  );
}

function MarcadorPintado(props: {
  readonly pintado: Pintado;
  /** El zoom al que se colocan: la proyección cambia con él aunque no lo lea. */
  readonly zoom: number;
  readonly proyectar: Proyectar;
  readonly formas: ReadonlyMap<string, FormaDeZona>;
  readonly tamano: TamanoDeMarcador;
  readonly filtro: FiltroDeCompanias;
  readonly seleccionada: string | null;
  readonly alSeleccionar: (clave: string, provincia: string) => void;
  readonly alAbrir: (elemento: ElementoAbrible) => void;
}) {
  const punto = createMemo(() => {
    void props.zoom;
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
            resaltadas={resaltadasDe(suelto().emplazamiento.companias, props.filtro)}
            tono={suelto().redUsada === true ? "red-usada" : "propio"}
            estado={suelto().emplazamiento.estado}
            nombre={nombreDeMarcador(
              suelto().emplazamiento,
              props.filtro,
              suelto().redUsada === true,
            )}
            seleccionado={props.seleccionada === suelto().emplazamiento.clave}
            movimiento={props.pintado.movimiento}
            onClick={() =>
              props.alSeleccionar(suelto().emplazamiento.clave, suelto().emplazamiento.provincia)
            }
          />
        )}
      </Match>
      <Match when={agrupacion()}>
        {(agrupada) => (
          <MarcadorAgrupacion
            x={punto().x}
            y={punto().y}
            cuantos={agrupada().cuantos}
            tamano={props.tamano}
            tono={agrupada().redUsada === true ? "red-usada" : "propio"}
            nombre={nombreDeAgrupacion(
              agrupada().cuantos,
              props.filtro,
              agrupada().redUsada === true,
            )}
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
            tamano={props.tamano}
            nombreDeZona={elegido().resumen.barrio.nombre}
            emplazamientos={elegido().resumen.emplazamientos}
            nombre={nombreDeBarrio(elegido().resumen, props.filtro)}
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
            tamano={props.tamano}
            nombreDeZona={elegido().resumen.municipio.nombre}
            emplazamientos={elegido().resumen.emplazamientos}
            nombre={nombreDeMunicipio(elegido().resumen, props.filtro)}
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
            tamano={props.tamano}
            nombreDeZona={hexagono().provincia.nombre}
            emplazamientos={hexagono().cuantos}
            cobertura={coberturaDe(hexagono())}
            carga={hexagono().carga}
            nombre={nombreDeProvincia(hexagono(), props.filtro)}
            movimiento={props.pintado.movimiento}
            onClick={() => props.alAbrir(hexagono())}
          />
        )}
      </Match>
    </Switch>
  );
}
