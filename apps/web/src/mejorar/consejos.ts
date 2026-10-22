import { bloque, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";

import type { Referencia } from "../ubicacion/estado.ts";
import { gradosEnteros, nombreRumbo, textoDistancia } from "../ubicacion/textos.ts";

/**
 * Más cerca que esto del emplazamiento no hay hacia dónde apuntar. Es el radio de la fusión
 * (ADR 0012), así que la posición del emplazamiento tampoco se conoce mejor.
 */
const DISTANCIA_JUNTO_M = 15;
/** Más cerca que esto, la señal suele llegar con fuerza. */
const CERCA_METROS = 300;
/** Desde aquí, la señal llega más débil y una antena exterior se nota más. */
const LEJOS_METROS = 1000;

/** Lo que se sabe del punto de referencia para aconsejar. */
export interface PuntoParaConsejos {
  readonly tipo: Referencia["tipo"];
  /** Del punto al emplazamiento, en metros. */
  readonly distancia: number;
  /** Del punto al emplazamiento, en grados desde el norte. */
  readonly rumbo: number;
}

type ClaveConsejo = "router" | "antena" | "distancia" | "movil";

export interface Consejo {
  readonly clave: ClaveConsejo;
  readonly texto: TextoMarcado;
  /** `secundario` se lee como un aparte, como lo de girar el móvil. */
  readonly tono: "principal" | "secundario";
}

/**
 * Sin punto de referencia, al pie del emplazamiento, donde no hay hacia dónde apuntar, o con un
 * rumbo al que apuntar.
 */
export type Consejos =
  | {
      readonly tipo: "sin-punto";
      readonly consejos: ReadonlyArray<Consejo>;
      /** Qué se ganaría con un punto de referencia. */
      readonly llamada: TextoMarcado;
    }
  | {
      readonly tipo: "al-pie";
      /** A qué distancia queda el emplazamiento. */
      readonly hacia: TextoMarcado;
      readonly consejos: ReadonlyArray<Consejo>;
    }
  | {
      readonly tipo: "con-rumbo";
      /** Hacia dónde queda el emplazamiento y a qué distancia. */
      readonly hacia: TextoMarcado;
      readonly consejos: ReadonlyArray<Consejo>;
      /** El rumbo al que apuntar, en grados enteros. */
      readonly rumbo: number;
    };

const ROUTER = termino("router-movil", "router 4G/5G");
const DB = termino("decibelio", "dB");

const MOVIL: Consejo = {
  clave: "movil",
  tono: "secundario",
  texto: marcado`Girar el móvil en la mano apenas cambia la señal. La mano y el cuerpo influyen más.`,
};

/**
 * Los consejos para mejorar la señal (historias 34, 35 y 37). Sin punto de referencia son
 * generales y dicen qué se ganaría con uno. Al pie del emplazamiento no hay nada que orientar. Con
 * rumbo dicen hacia qué ventana poner un router 4G/5G y a qué rumbo apuntar una antena exterior, y
 * cambian si el punto está cerca o lejos.
 *
 * Con un punto elegido hablan del «punto», nunca de «ti» (historia 31). Cada término se subraya
 * una vez en toda la sección.
 */
export const consejos = (punto: PuntoParaConsejos | undefined): Consejos => {
  if (punto === undefined) {
    const marcar = bloque();
    const lista: ReadonlyArray<Consejo> = [
      {
        clave: "router",
        tono: "principal",
        texto: marcado`Un ${ROUTER} recibe mejor junto a una ventana que mire hacia el ${termino("emplazamiento", "emplazamiento")}. Una pared puede quitar 10 ${DB} o más.`,
      },
      {
        clave: "antena",
        tono: "principal",
        texto: marcado`Una ${termino("antena-exterior", "antena exterior")} direccional tiene que apuntar hacia el emplazamiento.`,
      },
      MOVIL,
    ];
    return {
      tipo: "sin-punto",
      consejos: lista.map((consejo) => ({ ...consejo, texto: marcar(consejo.texto) })),
      llamada: marcar(
        marcado`Con un ${termino("punto-de-referencia", "punto de referencia")}, Celda te dice hacia qué ventana poner el router y a qué ${termino("rumbo", "rumbo")} apuntar la antena.`,
      ),
    };
  }

  const tu = punto.tipo === "gps";
  const distancia = textoDistancia(punto.distancia);
  const rumbo = gradosEnteros(punto.rumbo);
  const lado = nombreRumbo(rumbo);

  if (punto.distancia < DISTANCIA_JUNTO_M) {
    return {
      tipo: "al-pie",
      ...ordenar(
        marcado`${tu ? "Estás" : "El punto está"} al pie del ${termino("emplazamiento", "emplazamiento")}, a ${distancia}.`,
        [
          {
            clave: "router",
            tono: "principal",
            texto: marcado`Desde tan cerca no hace falta orientar el ${ROUTER}. Basta con ponerlo junto a una ventana.`,
          },
          {
            clave: "antena",
            tono: "principal",
            texto: marcado`Tampoco hace falta apuntar una ${termino("antena-exterior", "antena exterior")}.`,
          },
          MOVIL,
        ],
      ),
    };
  }

  const lista: Array<Consejo> = [
    {
      clave: "router",
      tono: "principal",
      texto: marcado`Pon el ${ROUTER} junto a una ventana que dé al ${lado}. Una pared puede quitar 10 ${DB} o más.`,
    },
    {
      clave: "antena",
      tono: "principal",
      texto: marcado`Si usas una ${termino("antena-exterior", "antena exterior")} direccional, apúntala a ${String(rumbo)}°. La brújula de abajo sirve para alinearla.`,
    },
  ];

  if (punto.distancia < CERCA_METROS) {
    lista.push({
      clave: "distancia",
      tono: "principal",
      texto: marcado`A ${distancia} la señal suele llegar con fuerza.`,
    });
  } else if (punto.distancia >= LEJOS_METROS) {
    lista.push({
      clave: "distancia",
      tono: "principal",
      texto: marcado`A ${distancia} la señal llega más débil, y es donde más se nota una antena exterior.`,
    });
  }

  lista.push(MOVIL);

  return {
    tipo: "con-rumbo",
    rumbo,
    ...ordenar(
      marcado`${tu ? "Desde donde estás" : "Desde el punto"}, el ${termino("emplazamiento", "emplazamiento")} queda hacia el ${lado}, con ${termino("rumbo", `rumbo ${String(rumbo)}°`)}, a ${distancia}.`,
      lista,
    ),
  };
};

/** Marca los términos en el orden en que se leen: primero hacia dónde queda y luego los consejos. */
const ordenar = (hacia: TextoMarcado, lista: ReadonlyArray<Consejo>) => {
  const marcar = bloque();
  return {
    hacia: marcar(hacia),
    consejos: lista.map((consejo) => ({ ...consejo, texto: marcar(consejo.texto) })),
  };
};
