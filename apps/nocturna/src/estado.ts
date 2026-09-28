import { versionDeCapa } from "@celda/dominio/capa";
import type { ZonaEnLaEjecucion } from "@celda/ingesta/barrido";
import type { Cambios } from "@celda/ingesta/ejecucion";
import type { GrupoDeCola, GrupoPendiente } from "@celda/ingesta/fichas";
import type { ResultadoPublicacion } from "@celda/publicacion/publicar";
import * as DateTime from "effect/DateTime";

import type { EjecucionGuardada, Resumen, ResumenDeFuente, ResumenDeZona } from "./base.ts";

/** Una fecha en UTC, al segundo: `2026-09-26 02:15:00 UTC`. */
const fecha = (milisegundos: number): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).slice(0, 19).replace("T", " ")} UTC`;

const describirCambios = ({ observaciones, fichas, emplazamientos, puntos }: Cambios): string =>
  [
    ...(puntos === undefined
      ? []
      : [`puntos +${puntos.creados} ~${puntos.cambiados} -${puntos.retirados}`]),
    `observaciones +${observaciones.creados} ~${observaciones.cambiados} -${observaciones.retirados}`,
    puntos === undefined
      ? `fichas ${fichas.leidas} leídas (${fichas.cambiadas} cambiadas)`
      : `detalles ${fichas.leidas} leídos (${fichas.cambiadas} cambiados)`,
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
    case "barrido":
      return `${resultado.version} ya estaba publicada; nuevo resumen con el último barrido`;
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

const describirGrupo = (
  grupo: GrupoDeCola,
  nombreDe: (codigo: string) => string | undefined,
): string => {
  switch (grupo.tipo) {
    case "provincia": {
      const nombre = nombreDe(grupo.provincia);
      return `provincia ${grupo.provincia}` + (nombre === undefined ? "" : ` (${nombre})`);
    }
    case "zona":
      return `resto de la zona ${grupo.zona}`;
    case "fuera":
      return "fuera de las zonas de barrido";
  }
};

const describirPendiente = (
  { grupo, nuevas, porReleer, enEspera }: GrupoPendiente,
  nombreDe: (codigo: string) => string | undefined,
): string =>
  `    - ${describirGrupo(grupo, nombreDe)}: ${nuevas} sin leer, ${porReleer} por releer` +
  (enEspera === 0 ? "" : `, ${enEspera} esperando tras fallar`);

const describirFuente = (f: ResumenDeFuente): ReadonlyArray<string> => [
  `${f.fuente}: ${f.interruptor.activo ? "encendida" : `apagada (${f.interruptor.motivo})`}`,
  ...(f.ultima === undefined ? ["  Ninguna ejecución todavía"] : describirEjecucion(f.ultima)),
  ...(f.puntos > 0
    ? [
        `  Puntos vigentes: ${f.puntos}; detalles de ER5 pendientes: ${f.detallesPendientes}; ` +
          `observaciones vigentes: ${f.vigentes}`,
      ]
    : f.vigentes === 0
      ? []
      : [
          `  Observaciones vigentes: ${f.vigentes}; fichas pendientes: ${f.sinLeer} sin leer y ` +
            `${f.porReleer} por releer`,
        ]),
  ...(f.zonas.length === 0 ? [] : ["  Zonas de barrido:", ...f.zonas.map(describirZona)]),
];

/**
 * El estado de la base en texto, para la orden `estado`. `cola` son las fichas que quedan del
 * registro oficial en cada parte de su cola, en el orden en que se leen.
 */
export const describirResumen = (
  fichero: string,
  resumen: Resumen,
  cola: ReadonlyArray<GrupoPendiente> = [],
  nombreDe: (codigo: string) => string | undefined = () => undefined,
): string =>
  [
    `Base: ${fichero}`,
    ...resumen.fuentes.flatMap((f) => [
      ...describirFuente(f),
      ...(f.fuente !== "registro-oficial" || cola.length === 0
        ? []
        : [
            "  Fichas por leer, en el orden de la cola:",
            ...cola.map((grupo) => describirPendiente(grupo, nombreDe)),
          ]),
    ]),
    `Emplazamientos: ${resumen.emplazamientos}` +
      (resumen.version === null ? "" : `; versión de los datos ${versionDeCapa(resumen.version)}`),
    `Última versión publicada: ${resumen.publicada ?? "ninguna"}`,
    resumen.ultimoIntento === undefined
      ? "Último intento de publicar: ninguno"
      : `Último intento de publicar: ${fecha(resumen.ultimoIntento.fecha)}, ` +
        describirPublicacion(resumen.ultimoIntento.resultado),
  ].join("\n");
