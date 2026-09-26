import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  GRUPO_DE_LINEAS,
  NOMBRE_GRUPO,
  type ParametrosDelEjercicio,
  type ResultadoDeCompania,
  type ResultadoDelEjercicio,
} from "@celda/dominio/ejercicio";

import { decimal, entero } from "./tabla.ts";

/** Un eslabón de una cadena de cálculo, en texto. */
export interface Eslabon {
  readonly operacion?: string;
  readonly etiqueta: string;
  readonly valor: string;
  readonly fuente: string;
}

const metros = (n: number | undefined) => (n === undefined ? "—" : `${entero(n)} m`);

/**
 * Cómo sale el radio de cobertura de una compañía: sus estaciones, la media de las distancias a
 * la vecina y la mitad. Si no tiene otra estación en toda la capa, lo dice.
 */
export const cadenaDelRadio = (c: ResultadoDeCompania): ReadonlyArray<Eslabon> => {
  const nombre = NOMBRE_COMPANIA[c.compania];
  const distancias = c.vecinas.map((v) => entero(v.metros));
  const lista =
    distancias.length <= 6
      ? `${distancias.join(", ")} m`
      : `${distancias.slice(0, 5).join(", ")} m…`;
  return [
    {
      etiqueta: `Estaciones base de ${nombre} en la zona`,
      valor: entero(c.estaciones),
      fuente: "Emplazamientos del mapa en que emite la compañía",
    },
    {
      operacion: "distancia de cada una a su vecina de la misma compañía, y la media",
      etiqueta: "Distancia media a la vecina",
      valor: metros(c.distanciaMedia),
      fuente:
        c.vecinas.length === 0
          ? `${nombre} no tiene ninguna otra estación base en el mapa`
          : `Media de ${entero(c.vecinas.length)} distancias: ${lista}`,
    },
    {
      operacion: "÷ 2",
      etiqueta: "Radio de cobertura",
      valor: metros(c.radio),
      fuente: "La mitad de la distancia media a la vecina",
    },
  ];
};

/**
 * Cómo salen los usuarios por estación base de una compañía: habitantes, líneas, las de su grupo
 * y el reparto entre sus estaciones.
 */
export const cadenaDeUsuarios = (
  resultado: ResultadoDelEjercicio,
  compania: Compania,
  parametros: ParametrosDelEjercicio,
  fuenteParametros: string,
): ReadonlyArray<Eslabon> => {
  const grupo = GRUPO_DE_LINEAS[compania];
  const c = resultado.companias.find((r) => r.compania === compania);
  const estacionesDelGrupo = resultado.companias
    .filter((r) => GRUPO_DE_LINEAS[r.compania] === grupo)
    .reduce((suma, r) => suma + r.estaciones, 0);
  const compartido = grupo === "masorange";
  return [
    {
      etiqueta: "Habitantes de la zona",
      valor: entero(resultado.habitantes),
      fuente: "Padrón municipal",
    },
    {
      operacion: `× ${decimal(parametros.penetracion)} líneas por cada 100 habitantes`,
      etiqueta: "Líneas móviles en la zona",
      valor: entero(resultado.lineas),
      fuente: fuenteParametros,
    },
    {
      operacion: `× ${decimal(parametros.cuotas[grupo])} % de cuota de ${NOMBRE_GRUPO[grupo]}`,
      etiqueta: `Líneas de ${NOMBRE_GRUPO[grupo]}`,
      valor: entero(c?.lineasDelGrupo ?? 0),
      fuente: fuenteParametros,
    },
    {
      operacion: compartido
        ? `÷ ${entero(estacionesDelGrupo)} estaciones base de Orange y Yoigo en la zona`
        : `÷ ${entero(c?.estaciones ?? 0)} estaciones base en la zona`,
      etiqueta: "Usuarios por estación base",
      valor: c?.usuariosPorEstacion === undefined ? "—" : entero(c.usuariosPorEstacion),
      fuente:
        c?.usuariosPorEstacion === undefined
          ? `${NOMBRE_COMPANIA[compania]} no tiene estaciones base en la zona`
          : "Se supone que cada línea usa una estación base de la zona",
    },
  ];
};
