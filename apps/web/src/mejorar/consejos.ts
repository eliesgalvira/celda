import { bloque, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";
import { DISTANCIA_JUNTO_M } from "@celda/sim/sectorServicio";

import type { Orientacion } from "../ficha/diagrama.ts";
import type { LecturaServicio } from "../servicio/servicio.ts";
import type { Referencia } from "../ubicacion/estado.ts";
import { nombreRumbo, textoDistancia } from "../ubicacion/textos.ts";

/** Hasta aquí del eje del sector se está «casi de frente», como en el sector que da servicio. */
const DE_FRENTE_GRADOS = 20;
/** Desde aquí del eje se está entre dos sectores, como en el sector que da servicio. */
const ENTRE_DOS_GRADOS = 45;
/** Más cerca que esto, la señal suele llegar con fuerza. */
export const CERCA_METROS = 300;
/** Desde aquí, la señal llega más débil y una antena exterior se nota más. */
export const LEJOS_METROS = 1000;

/** Lo que se sabe del punto de referencia para aconsejar. */
export interface PuntoParaConsejos {
  readonly tipo: Referencia["tipo"];
  /** Del punto al emplazamiento, en metros. */
  readonly distancia: number;
  /** Del punto al emplazamiento, en grados desde el norte. */
  readonly rumbo: number;
  /** El sector que da servicio, si el modelo ya lo ha calculado. */
  readonly servicio: LecturaServicio | undefined;
  readonly orientacion: Orientacion;
}

export type ClaveConsejo =
  | "router"
  | "antena"
  | "distancia"
  | "sector"
  | "otro-emplazamiento"
  | "movil";

export interface Consejo {
  readonly clave: ClaveConsejo;
  readonly texto: TextoMarcado;
  /** `secundario` se lee como un aparte, como lo de girar el móvil. */
  readonly tono: "principal" | "secundario";
}

export type Consejos =
  | {
      readonly tipo: "sin-punto";
      readonly consejos: ReadonlyArray<Consejo>;
      /** Qué se ganaría con un punto de referencia. */
      readonly llamada: TextoMarcado;
    }
  | {
      readonly tipo: "con-punto";
      /** Hacia dónde queda el emplazamiento y a qué distancia. */
      readonly hacia: TextoMarcado;
      readonly consejos: ReadonlyArray<Consejo>;
      /**
       * El rumbo al que apuntar, en grados enteros, o `undefined` al pie del emplazamiento,
       * donde no hay hacia dónde apuntar.
       */
      readonly objetivo: number | undefined;
      /** Cuánto fiarse: la orientación de los sectores es supuesta o estimada. */
      readonly nota: TextoMarcado;
    };

const ROUTER = termino("router-movil", "router 4G/5G");
const DB = termino("decibelio", "dB");

const MOVIL: Consejo = {
  clave: "movil",
  tono: "secundario",
  texto: marcado`Girar el móvil en la mano apenas cambia la señal. Su antena recibe casi igual en todas direcciones, y la mano y el cuerpo cuentan más que hacia dónde apunte.`,
};

/** Grados enteros entre 0 y 359. */
const enteros = (grados: number): number => ((Math.round(grados) % 360) + 360) % 360;

/**
 * Los consejos para mejorar la señal (historias 34, 35 y 37). Sin punto de referencia son
 * generales y dicen qué se ganaría con uno. Con punto dicen hacia qué ventana poner un router
 * 4G/5G y a qué rumbo apuntar una antena exterior, y cambian si el punto está al pie del
 * emplazamiento, de frente a un sector o entre dos, cerca o lejos.
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
        texto: marcado`Una ${termino("antena-exterior", "antena exterior")} direccional hay que apuntarla al emplazamiento, y ahí la orientación importa mucho.`,
      },
      MOVIL,
    ];
    return {
      tipo: "sin-punto",
      consejos: lista.map((consejo) => ({ ...consejo, texto: marcar(consejo.texto) })),
      llamada: marcar(
        marcado`Con un ${termino("punto-de-referencia", "punto de referencia")}, Celda te dice hacia qué ventana poner el router y a qué ${termino("rumbo", "rumbo")} apuntar la antena, y la brújula del móvil te ayuda a alinearla.`,
      ),
    };
  }

  const tu = punto.tipo === "gps";
  const distancia = textoDistancia(punto.distancia);
  const rumbo = enteros(punto.rumbo);
  const lado = nombreRumbo(rumbo);
  const alPie =
    punto.servicio === undefined
      ? punto.distancia < DISTANCIA_JUNTO_M
      : punto.servicio.sector === undefined;
  const nota = notaConsejos(punto.orientacion);

  if (alPie) {
    return {
      tipo: "con-punto",
      objetivo: undefined,
      ...ordenar(
        marcado`${tu ? "Estás" : "El punto está"} al pie del ${termino("emplazamiento", "emplazamiento")}, a ${distancia}.`,
        [
          {
            clave: "router",
            tono: "principal",
            texto: marcado`Desde tan cerca no hace falta orientar el ${ROUTER}. Lo que más ayuda es ponerlo junto a una ventana, porque una pared puede quitar 10 ${DB} o más.`,
          },
          {
            clave: "antena",
            tono: "principal",
            texto: marcado`Tampoco sirve de mucho apuntar una ${termino("antena-exterior", "antena exterior")}, porque desde aquí no hay una dirección clara.`,
          },
          MOVIL,
        ],
        nota,
      ),
    };
  }

  const lista: Array<Consejo> = [
    {
      clave: "router",
      tono: "principal",
      texto: marcado`Con un ${ROUTER}, ponlo junto a una ventana que dé al ${lado}. Una pared puede quitar 10 ${DB} o más, y en un piso alto suele llegar mejor.`,
    },
    {
      clave: "antena",
      tono: "principal",
      texto: marcado`Con una ${termino("antena-exterior", "antena exterior")} direccional, apúntala a ${String(rumbo)}°. Ahí la orientación importa mucho, y la brújula de abajo ayuda a alinearla.`,
    },
  ];

  if (punto.distancia < CERCA_METROS) {
    lista.push({
      clave: "distancia",
      tono: "principal",
      texto: marcado`A ${distancia} la señal suele llegar con fuerza, y con el router junto a la ventana normalmente basta.`,
    });
  } else if (punto.distancia >= LEJOS_METROS) {
    lista.push({
      clave: "distancia",
      tono: "principal",
      texto: marcado`A ${distancia} la señal llega más débil, y es donde más se nota una antena exterior.`,
    });
  }

  const servicio = punto.servicio;
  if (servicio?.sector !== undefined) {
    const sector = termino("sector", `sector ${servicio.sector + 1}`);
    const grados = Math.abs(servicio.desviacion);
    const esta = tu ? "Estás" : "El punto está";
    if (grados < DE_FRENTE_GRADOS) {
      lista.push({
        clave: "sector",
        tono: "principal",
        texto: marcado`${esta} casi de frente al ${sector}, así que apuntar al emplazamiento es apuntar a su haz.`,
      });
    } else if (grados >= ENTRE_DOS_GRADOS) {
      lista.push({
        clave: "sector",
        tono: "principal",
        texto: marcado`${esta} entre dos sectores, donde llega menos señal de cada uno. Apunta igualmente al emplazamiento. Qué sector da servicio lo decide la red, no la antena.`,
      });
    }
    if (servicio.enCelda === false) {
      lista.push({
        clave: "otro-emplazamiento",
        tono: "principal",
        texto: marcado`Hay otro emplazamiento más cerca ${tu ? "de ti" : "del punto"}. Mira también su ficha antes de orientar nada, porque la señal puede llegar de allí.`,
      });
    }
  }
  lista.push(MOVIL);

  return {
    tipo: "con-punto",
    objetivo: rumbo,
    ...ordenar(
      marcado`${tu ? "Desde donde estás" : "Desde el punto"}, el ${termino("emplazamiento", "emplazamiento")} queda hacia el ${lado}, con ${termino("rumbo", `rumbo ${String(rumbo)}°`)}, a ${distancia}.`,
      lista,
      nota,
    ),
  };
};

/**
 * Marca los términos en el orden en que se leen: primero hacia dónde queda, luego los consejos y
 * al final la nota.
 */
const ordenar = (hacia: TextoMarcado, lista: ReadonlyArray<Consejo>, nota: TextoMarcado) => {
  const marcar = bloque();
  return {
    hacia: marcar(hacia),
    consejos: lista.map((consejo) => ({ ...consejo, texto: marcar(consejo.texto) })),
    nota: marcar(nota),
  };
};

/** Cuánto fiarse de los consejos: el rumbo es de fiar y lo de los sectores, menos. */
export const notaConsejos = (orientacion: Orientacion): TextoMarcado =>
  orientacion.tipo === "estimada"
    ? marcado`Los sectores tienen ${termino("azimut", "orientación estimada")}, con ±${String(orientacion.margen)}° de margen. El rumbo sale de la posición publicada del emplazamiento. Tómalo como punto de partida y ajusta mirando la señal del router.`
    : marcado`Los sectores tienen ${termino("azimut", "orientación supuesta")}. Ninguna fuente publica hacia dónde apuntan, así que lo que se dice de ellos puede no cuadrar. El rumbo sale de la posición publicada del emplazamiento. Tómalo como punto de partida y ajusta mirando la señal del router.`;
