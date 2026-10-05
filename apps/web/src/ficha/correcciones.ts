import { distanciaMetros } from "@celda/dominio/area";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { Conflicto } from "@celda/dominio/emplazamiento";
import type {
  CorreccionDeFicha,
  EstacionDeFicha,
  Ficha,
  OrigenDeFicha,
} from "@celda/dominio/ficha";
import { llano, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";

import { haciaDonde, textoCoordenada, textoDistancia } from "../buzon/textos.ts";
import { ENLACE_FUENTE, enumerar, fechaCorta, NOMBRE_FUENTE } from "./textos.ts";

/** Lo que dice una fuente de una estación base, ya escrito para la ficha. */
export interface TextosLado {
  readonly fuente: string;
  readonly dice: string;
  readonly fecha?: string;
  readonly enlace?: string;
  readonly textoEnlace?: string;
}

/** Una estación base, o el emplazamiento, en el que el registro oficial y otra fuente no coinciden. */
export interface TextosContraste {
  readonly tono: "corregido" | "nuevo";
  /** La compañía, o nada si la corrección es de todo el emplazamiento. */
  readonly compania?: Compania;
  readonly nombre: string;
  readonly oficial: TextosLado;
  readonly comunidad: TextosLado;
  /** Una corrección aceptada que se puede respaldar: su clave y lo que dice. */
  readonly correccion?: { readonly clave: string; readonly dice: string };
}

/** Lo que la ficha cuenta de las correcciones y los conflictos de un emplazamiento. */
export interface TextosCorrecciones {
  /** Qué pasa en este emplazamiento, en una frase, con sus términos marcados. */
  readonly resumen: TextoMarcado;
  readonly contrastes: ReadonlyArray<TextosContraste>;
  readonly conflictos: ReadonlyArray<string>;
}

const esOficial = (origen: OrigenDeFicha) => origen.fuente === "registro-oficial";

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

/** Lo que dice la otra fuente, sea cual sea: su nombre y su enlace salen de la fuente. */
const ladoComunidad = (origen: OrigenDeFicha, dice: string): TextosLado => ({
  fuente: NOMBRE_FUENTE[origen.fuente],
  dice,
  fecha: desde(origen.fecha),
  enlace: origen.url,
  textoEnlace: ENLACE_FUENTE[origen.fuente],
});

/**
 * La estación base, si las fuentes no coinciden en ella: otra fuente la da por desmontada, o la
 * conoce y el registro oficial no.
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
      comunidad: ladoComunidad(presente, "La sitúa aquí"),
    };
  }
  return undefined;
};

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

/** El título de la sección de correcciones. */
export const TITULO_CORRECCIONES: TextoMarcado = marcado`${termino(
  "registro-oficial",
  "Registro oficial",
)} y comunidad`;

const REGISTRO = termino("registro-oficial", "registro oficial");
const EMPLAZAMIENTO = termino("emplazamiento", "emplazamiento");

const RESUMEN: Readonly<Record<Ficha["estado"], TextoMarcado>> = {
  verificado: llano("Las fuentes no se ponen de acuerdo en algún dato de este emplazamiento."),
  corregido: marcado`La comunidad ha ${termino("correccion", "corregido")} lo que dice el ${REGISTRO} de este ${EMPLAZAMIENTO}.`,
  nuevo: marcado`El ${REGISTRO} no tiene este ${EMPLAZAMIENTO}. Lo ha añadido la comunidad de Celda.`,
};

/** «1 persona lo sitúa», «2 personas lo sitúan»: el sujeto con el verbo en su número. */
const personas = (n: number, singular: string, plural: string): string =>
  n === 1 ? `1 persona ${singular}` : `${n} personas ${plural}`;

/** El registro oficial de una compañía en el emplazamiento, como lo cuenta la ficha. */
const oficialDe = (ficha: Ficha, compania: Compania): TextosLado =>
  ladoOficial(
    ficha.estaciones
      .filter((e) => e.compania === compania)
      .flatMap((e) => e.origenes.filter((o) => esOficial(o) && o.afirma === "presente")),
  );

/** Lo que dice el registro de todo el emplazamiento: lo tiene, con su fecha y su enlace, o no. */
const oficialDelEmplazamiento = (ficha: Ficha, dice: string): TextosLado => {
  const oficial = ladoOficial(
    ficha.estaciones.flatMap((e) =>
      e.origenes.filter((o) => esOficial(o) && o.afirma === "presente"),
    ),
  );
  return oficial.fecha === undefined ? oficial : { ...oficial, dice };
};

/**
 * Una corrección de la comunidad aceptada (ADR 0020), al lado de lo que dice el registro: «el
 * registro dice X; N personas lo sitúan en Y». Nunca sustituye al registro.
 */
const contrasteAceptado = (ficha: Ficha, correccion: CorreccionDeFicha): TextosContraste => {
  const n = correccion.personas;
  const comunidad = (dice: string): TextosLado => ({
    fuente: "Comunidad de Celda · CC0",
    dice,
    fecha: `aceptada el ${fechaCorta(correccion.aceptadaEl)}`,
  });
  const base = { tono: "corregido" as const };
  const { cambio } = correccion;
  switch (cambio.tipo) {
    case "posicion": {
      const metros = distanciaMetros(ficha.posicion, cambio.posicion);
      const dice = `${personas(n, "lo sitúa", "lo sitúan")} a ${textoDistancia(metros)} ${haciaDonde(ficha.posicion, cambio.posicion)}, en ${textoCoordenada(cambio.posicion)}`;
      return {
        ...base,
        nombre: "Posición del emplazamiento",
        oficial: oficialDelEmplazamiento(ficha, `Lo sitúa en ${textoCoordenada(ficha.posicion)}`),
        comunidad: comunidad(dice),
        correccion: { clave: correccion.clave, dice },
      };
    }
    case "compania": {
      const nombre = NOMBRE_COMPANIA[cambio.compania];
      const dice = cambio.esta
        ? `${personas(n, "sitúa", "sitúan")} aquí a ${nombre}`
        : `${personas(n, "dice", "dicen")} que ${nombre} no está`;
      return {
        ...base,
        compania: cambio.compania,
        nombre,
        oficial: oficialDe(ficha, cambio.compania),
        comunidad: comunidad(dice),
        correccion: { clave: correccion.clave, dice },
      };
    }
    case "ya-no-existe": {
      const dice = `${personas(n, "dice", "dicen")} que ya no existe`;
      return {
        ...base,
        nombre: "El emplazamiento",
        oficial: oficialDelEmplazamiento(ficha, "Lo tiene dado de alta"),
        comunidad: comunidad(dice),
        correccion: { clave: correccion.clave, dice },
      };
    }
    case "falta": {
      const dice = `${personas(n, "lo sitúa", "lo sitúan")} aquí, con ${enumerar(cambio.companias.map((c) => NOMBRE_COMPANIA[c]))}`;
      return {
        ...base,
        tono: "nuevo",
        nombre: "El emplazamiento",
        oficial: { fuente: "Registro oficial", dice: "No lo tiene" },
        comunidad: comunidad(dice),
        correccion: { clave: correccion.clave, dice },
      };
    }
  }
};

/**
 * Las correcciones y los conflictos de la ficha, o nada si todas las fuentes coinciden. Cada
 * corrección lleva lo que dice el registro oficial y lo que dice la comunidad, con su fecha y
 * su enlace (historias 18 y 61). Las aceptadas por la moderación van primero, con cuántas
 * personas las sostienen; de una compañía con una aceptada no se repite lo que dicen sus
 * observaciones.
 */
export const textosCorrecciones = (ficha: Ficha): TextosCorrecciones | undefined => {
  const aceptadas = (ficha.correcciones ?? []).map((c) => contrasteAceptado(ficha, c));
  const conAceptada = new Set(
    aceptadas.flatMap((c) => (c.compania === undefined ? [] : [c.compania])),
  );
  const contrastes = [
    ...aceptadas,
    ...ficha.estaciones.flatMap((e) => {
      const contraste = contrasteDe(ficha, e);
      return contraste === undefined || conAceptada.has(e.compania) ? [] : [contraste];
    }),
  ];
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
  return { resumen: RESUMEN[ficha.estado], contrastes, conflictos };
};
