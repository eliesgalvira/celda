import type { Mhz } from "@celda/dominio/banda";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { enumerar } from "@celda/dominio/enumerar";
import type { EstacionDeFicha } from "@celda/dominio/ficha";
import { llano, marcado, termino, textoPlano, type TextoMarcado } from "@celda/dominio/glosario";
import {
  BANDAS_NOMINALES,
  FRANJA_DE_BANDA,
  generacionProbable,
  USOS_DE_BANDA,
} from "@celda/dominio/tecnologia";
import type { EstacionTecnica } from "@celda/ui/panel/DatosTecnicos.tsx";
import type { FilaEje } from "@celda/ui/panel/EjeFrecuencias.tsx";

import {
  claveDeOrigen,
  comprobadoEl,
  fechaCorta,
  NOMBRE_FUENTE,
  SIN_FICHA_EN_REGISTRO,
  sinBandasDe,
  textoCodigos,
  textoTramo,
} from "./textos.ts";

/** Las bandas nominales de una estación base, una vez cada una y de menor a mayor. */
const bandasDe = (estacion: EstacionDeFicha): ReadonlyArray<Mhz> =>
  BANDAS_NOMINALES.filter((mhz) => estacion.bandas.some((banda) => banda.mhz === mhz));

/** Si de una estación se conocen todas las bandas: tiene alguna y todas encajan en una nominal. */
const conocidaDelTodo = (estacion: EstacionDeFicha): boolean =>
  estacion.bandas.length > 0 && estacion.bandas.every((banda) => banda.mhz !== null);

const nombres = (estaciones: ReadonlyArray<EstacionDeFicha>): string =>
  enumerar(estaciones.map((e) => NOMBRE_COMPANIA[e.compania]));

const quienEmite = (estaciones: ReadonlyArray<EstacionDeFicha>): string => {
  if (estaciones.length === 0) return "Ninguna fuente dice qué compañía emite aquí.";
  if (estaciones.length === 1) return `Aquí emite ${nombres(estaciones)}.`;
  return `${nombres(estaciones)} comparten este emplazamiento.`;
};

const CUATRO_G = termino("4g", "4G");
const CINCO_G = termino("5g", "5G");

/**
 * Qué generación da, deducida de las bandas. El 5G dice con qué compañías si no lo dan todas:
 * es lo que más cambia de una a otra.
 */
const queGeneracion = (estaciones: ReadonlyArray<EstacionDeFicha>): TextoMarcado => {
  const con = (generacion: "4G" | "5G") =>
    estaciones.filter((e) => bandasDe(e).some((mhz) => generacionProbable(mhz) === generacion));
  const con4G = con("4G");
  const con5G = con("5G");
  const todas = con5G.length === estaciones.length;
  const cinco = todas ? CINCO_G : marcado`${CINCO_G} con ${nombres(con5G)}`;
  if (con5G.length === 0) return CUATRO_G;
  if (con4G.length === 0) return cinco;
  return todas ? marcado`${CUATRO_G} y ${CINCO_G}` : marcado`${CUATRO_G}, y ${cinco}`;
};

/** Si llega lejos o da velocidad. Solo dice lo que falta si se conocen todas las bandas. */
const queAlcance = (bandas: ReadonlyArray<Mhz>, completo: boolean): string => {
  const franjas = new Set(bandas.map((mhz) => FRANJA_DE_BANDA[mhz]));
  const bajas = franjas.has("baja");
  const altas = franjas.has("alta");
  if (bajas && altas) {
    return "llega lejos, entra bien en los edificios y sus bandas altas dan más velocidad";
  }
  if (bajas) {
    return completo
      ? "llega lejos y entra bien en los edificios, pero sin bandas altas da menos velocidad"
      : "llega lejos y entra bien en los edificios";
  }
  if (altas) {
    return completo
      ? "sus bandas altas dan más velocidad, pero sin bajas llega menos lejos y entra peor en los edificios"
      : "tiene bandas altas que dan más velocidad";
  }
  return completo
    ? "sus bandas son medias, con alcance y velocidad intermedios"
    : "son bandas medias, con alcance y velocidad intermedios";
};

const mayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

const BANDAS = termino("banda", "bandas");

/** Si el registro no tiene la ficha de una estación base, y por eso no tiene bandas. */
const sinFicha = (estacion: EstacionDeFicha): boolean =>
  estacion.sinFichaEnRegistro !== undefined && bandasDe(estacion).length === 0;

/**
 * Si Celda ha leído la ficha del registro de una estación base y el registro no publica ninguna
 * banda de ella (#41).
 */
const sinPublicar = (estacion: EstacionDeFicha): boolean =>
  !estacion.bandasSinLeer &&
  estacion.bandas.length === 0 &&
  estacion.sinFichaEnRegistro === undefined &&
  estacion.origenes.some((o) => o.fuente === "registro-oficial");

/**
 * Que el registro no publica las bandas de unas estaciones base. En un emplazamiento compartido
 * dice de qué compañías, si no son todas.
 */
const fraseSinPublicar = (
  sinBandas: ReadonlyArray<EstacionDeFicha>,
  todas: number,
): TextoMarcado =>
  sinBandas.length === todas
    ? marcado`El ${termino("registro-oficial", "registro")} no publica sus ${BANDAS}.`
    : marcado`El ${termino("registro-oficial", "registro")} no publica las ${BANDAS} de ${nombres(sinBandas)}.`;

/**
 * Que el registro no tiene la ficha de unas estaciones base, con la comprobación más reciente.
 * En un emplazamiento compartido dice de qué compañías, si no son todas.
 */
const fraseSinFicha = (sinFichas: ReadonlyArray<EstacionDeFicha>, todas: number): TextoMarcado => {
  const fecha = Math.max(...sinFichas.map((e) => e.sinFichaEnRegistro ?? 0));
  const de = sinFichas.length === todas ? "" : ` de ${nombres(sinFichas)}`;
  return marcado`El ${termino("registro-oficial", "registro")} no tiene ficha${de} para este emplazamiento (${comprobadoEl(fecha)}).`;
};

/**
 * La frase que abre la ficha (historia 13): quién emite, si da 4G o 5G y si llega lejos o da
 * velocidad. El registro oficial no publica la tecnología, así que se deduce de la banda y se
 * dice «probablemente». Lo que no se conoce se dice que no se conoce. Lleva marcados la banda,
 * el 4G y el 5G, que se subrayan la primera vez.
 */
export const fraseDeResumen = (estaciones: ReadonlyArray<EstacionDeFicha>): TextoMarcado => {
  const quien = quienEmite(estaciones);
  if (estaciones.length === 0) return llano(quien);

  const bandas = BANDAS_NOMINALES.filter((mhz) =>
    estaciones.some((e) => bandasDe(e).includes(mhz)),
  );
  const sinFichas = estaciones.filter(sinFicha);
  const sinBandas = estaciones.filter(sinPublicar);
  const deSinFicha: TextoMarcado | string =
    sinFichas.length === 0 ? "" : marcado` ${fraseSinFicha(sinFichas, estaciones.length)}`;
  const deSinBandas: TextoMarcado | string =
    sinBandas.length === 0 ? "" : marcado` ${fraseSinPublicar(sinBandas, estaciones.length)}`;
  if (bandas.length === 0) {
    // Si el registro no tiene la ficha de ninguna o no publica sus bandas, no se da por pendiente.
    return sinFichas.length + sinBandas.length === estaciones.length
      ? marcado`${quien}${deSinFicha}${deSinBandas} Sin sus ${BANDAS} no se sabe si da ${CUATRO_G} o ${CINCO_G}.`
      : marcado`${quien} Aún no se conocen sus ${BANDAS} ni si da ${CUATRO_G} o ${CINCO_G}.${deSinFicha}${deSinBandas}`;
  }

  const completo = estaciones.every(conocidaDelTodo);
  const pendientes = estaciones.filter(
    (e) => bandasDe(e).length === 0 && !sinFicha(e) && !sinPublicar(e),
  );
  const segun = completo ? marcado`Por sus ${BANDAS}` : marcado`Por las ${BANDAS} que se conocen`;
  const falta =
    pendientes.length === 0 ? "" : ` De ${nombres(pendientes)} aún no se conocen las bandas.`;
  return marcado`${quien} ${segun}, probablemente da ${queGeneracion(estaciones)}. ${mayuscula(queAlcance(bandas, completo))}.${falta}${deSinFicha}${deSinBandas}`;
};

/** El título del eje de frecuencias, con la frecuencia y los MHz explicados. */
export const TITULO_EJE: TextoMarcado = marcado`Qué ${termino("banda", "frecuencia")} usa cada compañía (${termino("mhz", "MHz")})`;

/** El mismo título, llano: el nombre accesible de la tabla. */
export const NOMBRE_EJE = textoPlano(TITULO_EJE);

/** Las filas del eje de frecuencias (historia 14): una por compañía, con sus bandas nominales. */
export const filasDelEje = (estaciones: ReadonlyArray<EstacionDeFicha>): ReadonlyArray<FilaEje> =>
  estaciones.map((estacion) => {
    const bandas = bandasDe(estacion);
    return {
      compania: estacion.compania,
      nombre: NOMBRE_COMPANIA[estacion.compania],
      bandas,
      nota:
        bandas.length > 0
          ? undefined
          : sinFicha(estacion)
            ? SIN_FICHA_EN_REGISTRO
            : sinPublicar(estacion)
              ? "El registro no publica sus bandas"
              : "Aún no se conocen sus bandas",
    };
  });

/** La tecnología de una banda en los datos técnicos: la probable y, entre paréntesis, las otras. */
const textoTecnologia = (mhz: Mhz | null): string => {
  if (mhz === null) return "No se sabe";
  const [probable, ...otras] = USOS_DE_BANDA[mhz];
  return otras.length === 0 ? `${probable}` : `${probable} (o ${otras.join(" o ")})`;
};

/** Lo que cuentan los datos técnicos de cada estación base (historia 19). */
export const datosTecnicosDe = (
  estaciones: ReadonlyArray<EstacionDeFicha>,
): ReadonlyArray<EstacionTecnica> =>
  estaciones.map((estacion) => ({
    compania: estacion.compania,
    nombre: NOMBRE_COMPANIA[estacion.compania],
    codigos: textoCodigos(estacion.codigos),
    expedientes: estacion.bandas.map((banda) => ({
      referencia: banda.referencia,
      tramo: textoTramo(banda),
      banda: banda.mhz === null ? "Sin banda conocida" : `${banda.mhz} MHz`,
      tecnologia: textoTecnologia(banda.mhz),
    })),
    sinExpedientes: sinBandasDe(estacion),
    origenes: estacion.origenes.map((origen) => ({
      fuente: NOMBRE_FUENTE[origen.fuente],
      clave: claveDeOrigen(origen),
      fecha:
        origen.afirma === "desmontada"
          ? `la da por desmontada desde el ${fechaCorta(origen.fecha)}`
          : `desde el ${fechaCorta(origen.fecha)}`,
    })),
  }));

export const NOTA_TECNICA: TextoMarcado = marcado`El registro oficial no publica la tecnología, la ${termino("azimut", "orientación de los sectores")}, la altura ni la potencia. La tecnología probable sale de la banda: en España, el 700 y el 3500 MHz son de 5G y el resto, sobre todo de 4G.`;
