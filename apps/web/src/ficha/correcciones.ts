import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { Conflicto } from "@celda/dominio/emplazamiento";
import type { EstacionDeFicha, Ficha, OrigenDeFicha } from "@celda/dominio/ficha";

import { fechaCorta } from "./textos.ts";

/** Lo que dice una fuente de una estación base, ya escrito para la ficha. */
export interface TextosLado {
  readonly fuente: string;
  readonly dice: string;
  readonly fecha?: string;
  readonly enlace?: string;
  readonly textoEnlace?: string;
}

/** Una estación base en la que el registro oficial y la comunidad no coinciden. */
export interface TextosContraste {
  readonly tono: "corregido" | "nuevo";
  readonly compania: Compania;
  readonly nombre: string;
  readonly oficial: TextosLado;
  readonly comunidad: TextosLado;
}

/** Lo que la ficha cuenta de las correcciones y los conflictos de un emplazamiento. */
export interface TextosCorrecciones {
  /** Qué pasa en este emplazamiento, en una frase. */
  readonly resumen: string;
  readonly contrastes: ReadonlyArray<TextosContraste>;
  readonly conflictos: ReadonlyArray<string>;
  /** El crédito de antenasmoviles.es, si algo sale de su web. */
  readonly credito: string | undefined;
}

const esOficial = (origen: OrigenDeFicha) => origen.fuente === "registro-oficial";

const NOMBRE_COMUNIDAD: Readonly<Record<OrigenDeFicha["fuente"], string>> = {
  "registro-oficial": "Registro oficial",
  antenasmoviles: "antenasmoviles.es",
  opencellid: "OpenCelliD",
};

const desde = (fecha: number) => `desde el ${fechaCorta(fecha)}`;

const masAntigua = (origenes: ReadonlyArray<OrigenDeFicha>): OrigenDeFicha | undefined =>
  origenes.toSorted((a, b) => a.fecha - b.fecha)[0];

const ladoOficial = (oficiales: ReadonlyArray<OrigenDeFicha>): TextosLado => {
  const primero = masAntigua(oficiales);
  return primero === undefined
    ? { fuente: "Registro oficial", dice: "No la tiene" }
    : {
        fuente: "Registro oficial",
        dice: "La tiene dada de alta",
        fecha: desde(primero.fecha),
        enlace: primero.url,
        textoEnlace: "Ver en el registro oficial",
      };
};

const ladoComunidad = (origen: OrigenDeFicha, dice: string): TextosLado => ({
  fuente: NOMBRE_COMUNIDAD[origen.fuente],
  dice,
  fecha: desde(origen.fecha),
  enlace: origen.url,
  textoEnlace: `Ver en ${NOMBRE_COMUNIDAD[origen.fuente]}`,
});

/**
 * La estación base, si las fuentes no coinciden en ella: la comunidad la da por desmontada, o
 * la conoce y el registro oficial no.
 */
const contrasteDe = (ficha: Ficha, estacion: EstacionDeFicha): TextosContraste | undefined => {
  const oficiales = estacion.origenes.filter((o) => esOficial(o) && o.afirma === "presente");
  const comunidad = estacion.origenes.filter((o) => !esOficial(o));
  const desmontada = masAntigua(comunidad.filter((o) => o.afirma === "desmontada"));
  const presente = masAntigua(comunidad.filter((o) => o.afirma === "presente"));
  const nombre = NOMBRE_COMPANIA[estacion.compania];
  const base = { compania: estacion.compania, nombre, oficial: ladoOficial(oficiales) };
  if (desmontada !== undefined) {
    return {
      ...base,
      tono: "corregido",
      comunidad: ladoComunidad(desmontada, "La da por desmontada"),
    };
  }
  if (presente !== undefined && oficiales.length === 0) {
    const nuevo = ficha.estado === "nuevo";
    return {
      ...base,
      tono: nuevo ? "nuevo" : "corregido",
      // Si el emplazamiento sí está en el registro, lo que falta es esta compañía allí.
      oficial: { fuente: "Registro oficial", dice: nuevo ? "No la tiene" : "No la tiene aquí" },
      comunidad: ladoComunidad(presente, "La han añadido sus usuarios"),
    };
  }
  return undefined;
};

const enumerar = (partes: ReadonlyArray<string>): string =>
  partes.length <= 1
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1) ?? ""}`;

/**
 * Un conflicto entre fuentes, en una frase. La estación desmontada no sale aquí: ya la cuenta
 * su contraste.
 */
export const textoConflicto = (conflicto: Conflicto): string | undefined => {
  const nombre = NOMBRE_COMPANIA[conflicto.compania];
  switch (conflicto.tipo) {
    case "desmontada":
      return undefined;
    case "codigos-distintos":
      return (
        `${nombre} aparece con códigos distintos según la fuente: ${enumerar(conflicto.codigos)}. ` +
        "Puede ser la misma estación base contada dos veces."
      );
    case "posicion-distinta":
      return `Las fuentes sitúan el código ${conflicto.codigo} de ${nombre} en sitios a ${conflicto.metros} m uno de otro.`;
  }
};

const RESUMEN: Readonly<Record<Ficha["estado"], string>> = {
  verificado: "Las fuentes no se ponen de acuerdo en algún dato de este emplazamiento.",
  corregido:
    "La comunidad corrige el registro oficial en este emplazamiento. Aquí están las dos versiones.",
  nuevo:
    "El registro oficial no tiene este emplazamiento: lo han añadido los usuarios de la comunidad.",
};

const CREDITO_ANTENASMOVILES =
  "Correcciones de la comunidad de antenasmoviles.es. Su web no tiene una página por " +
  "emplazamiento: el enlace abre su mapa aquí y hay que pulsar el marcador.";

/**
 * Las correcciones y los conflictos de la ficha, o nada si todas las fuentes coinciden. Cada
 * corrección lleva lo que dice el registro oficial y lo que dice la comunidad, con su fecha y
 * su enlace (historias 18 y 61).
 */
export const textosCorrecciones = (ficha: Ficha): TextosCorrecciones | undefined => {
  const contrastes = ficha.estaciones.flatMap((e) => {
    const contraste = contrasteDe(ficha, e);
    return contraste === undefined ? [] : [contraste];
  });
  const conflictos = [
    ...new Set(
      ficha.conflictos.flatMap((c) => {
        const texto = textoConflicto(c);
        return texto === undefined ? [] : [texto];
      }),
    ),
  ];
  if (contrastes.length === 0 && conflictos.length === 0) {
    return undefined;
  }
  const deAntenasMoviles = ficha.estaciones.some((e) =>
    e.origenes.some((o) => o.fuente === "antenasmoviles"),
  );
  return {
    resumen: RESUMEN[ficha.estado],
    contrastes,
    conflictos,
    credito: deAntenasMoviles ? CREDITO_ANTENASMOVILES : undefined,
  };
};
