import { versionDeCapa } from "@celda/dominio/capa";
import type { ZonaEnLaEjecucion } from "@celda/ingesta/barrido";
import type { Cambios } from "@celda/ingesta/ejecucion";
import type { ResultadoPublicacion } from "@celda/publicacion/publicar";
import * as DateTime from "effect/DateTime";

import type { EjecucionGuardada, Resumen, ResumenDeFuente, ResumenDeZona } from "./base.ts";

/** Una fecha en UTC, al segundo: `2026-09-26 02:15:00 UTC`. */
const fecha = (milisegundos: number): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).slice(0, 19).replace("T", " ")} UTC`;

const describirCambios = ({ observaciones, fichas, emplazamientos }: Cambios): string =>
  [
    `observaciones +${observaciones.creados} ~${observaciones.cambiados} -${observaciones.retirados}`,
    `fichas ${fichas.leidas} leídas (${fichas.cambiadas} cambiadas)`,
    `emplazamientos +${emplazamientos.creados} ~${emplazamientos.cambiados} -${emplazamientos.retirados}`,
  ].join(", ");

const describirPublicacion = (resultado: ResultadoPublicacion): string => {
  switch (resultado.tipo) {
    case "sin-almacen":
      return "sin almacén, no se publica";
    case "fallida":
      return `fallida: ${resultado.motivo}`;
    case "al-dia":
      return `${resultado.version} ya estaba publicada`;
    case "publicada":
      return `${resultado.version} publicada, ${resultado.escritos} ficheros escritos`;
  }
};

const kilobytes = (bytes: number): string => `${Math.round(bytes / 1000)} kB`;

const describirZonaEnLaEjecucion = (z: ZonaEnLaEjecucion): string =>
  `    - ${z.zona}: ${z.estado}, ${z.cuadros} cuadros, ${z.peticiones} peticiones, ` +
  `${kilobytes(z.bytes)}, ${z.registros} registros; observaciones ` +
  `+${z.observaciones.creados} ~${z.observaciones.cambiados} -${z.observaciones.retirados}` +
  (z.error === undefined ? "" : `; ${z.error}`);

const describirZona = (z: ResumenDeZona): string =>
  `    - ${z.zona}: ` +
  (z.completado === null
    ? "ningún barrido completado"
    : `último barrido completado ${fecha(z.completado)}`) +
  (z.aMedias ? "; tiene uno a medias, que se retoma" : "");

const describirEjecucion = (e: EjecucionGuardada): ReadonlyArray<string> => [
  `  Última ejecución: ${fecha(e.inicio)}, ${e.estado}` +
    (e.registros === null ? "" : `, ${e.registros} registros en el listado`),
  ...(e.estado === "completada" ? [`  Cambios: ${describirCambios(e.cambios)}`] : []),
  ...(e.zonas === null || e.zonas.length === 0
    ? []
    : ["  Zonas:", ...e.zonas.map(describirZonaEnLaEjecucion)]),
  ...(e.publicacion === null ? [] : [`  Publicación: ${describirPublicacion(e.publicacion)}`]),
  ...(e.errores.length === 0
    ? ["  Errores: ninguno"]
    : [`  Errores (${e.errores.length}):`, ...e.errores.map((error) => `    - ${error}`)]),
];

const describirFuente = (f: ResumenDeFuente): ReadonlyArray<string> => [
  `${f.fuente}: ${f.interruptor.activo ? "encendida" : `apagada (${f.interruptor.motivo})`}`,
  ...(f.ultima === undefined ? ["  Ninguna ejecución todavía"] : describirEjecucion(f.ultima)),
  ...(f.vigentes === 0
    ? []
    : [
        `  Observaciones vigentes: ${f.vigentes}; fichas pendientes: ${f.sinLeer} sin leer y ` +
          `${f.porReleer} por releer`,
      ]),
  ...(f.zonas.length === 0 ? [] : ["  Zonas de barrido:", ...f.zonas.map(describirZona)]),
];

/** El estado de la base en texto, para la orden `estado`. */
export const describirResumen = (fichero: string, resumen: Resumen): string =>
  [
    `Base: ${fichero}`,
    ...resumen.fuentes.flatMap(describirFuente),
    `Emplazamientos: ${resumen.emplazamientos}` +
      (resumen.version === null ? "" : `; versión de los datos ${versionDeCapa(resumen.version)}`),
    `Última versión publicada: ${resumen.publicada ?? "ninguna"}`,
    resumen.ultimoIntento === undefined
      ? "Último intento de publicar: ninguno"
      : `Último intento de publicar: ${fecha(resumen.ultimoIntento.fecha)}, ` +
        describirPublicacion(resumen.ultimoIntento.resultado),
  ].join("\n");
