import { versionDeCapa } from "@celda/dominio/capa";
import type { ZonaEnLaEjecucion } from "@celda/ingesta/barrido";
import type { Cambios } from "@celda/ingesta/ejecucion";
import type { GrupoDeCola, GrupoPendiente, Pendientes } from "@celda/ingesta/fichas";
import type { ResultadoPublicacion } from "@celda/publicacion/publicar";
import * as DateTime from "effect/DateTime";

import type {
  EjecucionGuardada,
  FichaEnEspera,
  Resumen,
  ResumenDeFuente,
  ResumenDeZona,
} from "./base.ts";

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

const describirPendientes = ({ nuevas, porReleer, enEspera }: Pendientes): string =>
  nuevas + porReleer + enEspera === 0
    ? "ninguna"
    : `${nuevas} sin leer, ${porReleer} por releer` +
      (enEspera === 0 ? "" : `, ${enEspera} esperando tras fallar`);

const describirZona = (z: ResumenDeZona, fichas?: Pendientes): string =>
  `    - ${z.zona}: ` +
  (z.completado === null
    ? "ningún barrido completado"
    : `último barrido completado ${fecha(z.completado)}`) +
  (z.aMedias ? "; tiene uno a medias, que se retoma" : "") +
  (fichas === undefined ? "" : `; fichas por leer: ${describirPendientes(fichas)}`);

/**
 * Las zonas de barrido del registro oficial en la configuración, en su orden, con las fichas que
 * le quedan a cada una, y las que barrerá la noche siguiente.
 */
export interface Turno {
  readonly zonas: ReadonlyArray<{ readonly zona: string; readonly fichas: Pendientes }>;
  readonly proxima: ReadonlyArray<string>;
}

/**
 * Las zonas de la configuración, en su orden y con sus fichas, y luego las demás que se han
 * barrido alguna vez, por nombre.
 */
const describirZonasEnTurno = (
  barridas: ReadonlyArray<ResumenDeZona>,
  turno: Turno,
): ReadonlyArray<string> => {
  const deLaBase = new Map(barridas.map((z) => [z.zona, z]));
  const configuradas = new Set(turno.zonas.map((z) => z.zona));
  return [
    "  Zonas de barrido, en el orden de la configuración:",
    ...turno.zonas.map(({ zona, fichas }) =>
      describirZona(deLaBase.get(zona) ?? { zona, completado: null, aMedias: false }, fichas),
    ),
    ...barridas.filter((z) => !configuradas.has(z.zona)).map((z) => describirZona(z)),
    `  La próxima noche barre: ${turno.proxima.length === 0 ? "ninguna zona" : turno.proxima.join(", ")}`,
  ];
};

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

const describirEnEspera = (f: FichaEnEspera): string =>
  `    - ${f.clave}: ${f.motivo ?? "sin motivo apuntado"}; ` +
  `intento ${f.fallos + 1} desde ${fecha(f.esperaHasta)}`;

/** Las fichas que esperan tras un fallo: cuántas y las primeras que se volverán a pedir. */
const describirFichasEnEspera = (f: ResumenDeFuente): ReadonlyArray<string> =>
  f.enEspera === 0
    ? []
    : [
        `  Fichas esperando tras un fallo: ${f.enEspera}` +
          (f.enEspera > f.primerasEnEspera.length
            ? `; las ${f.primerasEnEspera.length} primeras en volver a pedirse:`
            : ", por orden de su próximo intento:"),
        ...f.primerasEnEspera.map(describirEnEspera),
      ];

const describirFuente = (f: ResumenDeFuente, turno?: Turno): ReadonlyArray<string> => [
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
          ...describirFichasEnEspera(f),
        ]),
  ...(turno !== undefined
    ? describirZonasEnTurno(f.zonas, turno)
    : f.zonas.length === 0
      ? []
      : ["  Zonas de barrido:", ...f.zonas.map((z) => describirZona(z))]),
];

/**
 * El estado de la base en texto, para la orden `estado`. `cola` son las fichas que quedan del
 * registro oficial en cada parte de su cola, en el orden en que se leen, y `turno`, sus zonas de
 * barrido en la configuración.
 */
export const describirResumen = (
  fichero: string,
  resumen: Resumen,
  cola: ReadonlyArray<GrupoPendiente> = [],
  nombreDe: (codigo: string) => string | undefined = () => undefined,
  turno?: Turno,
): string =>
  [
    `Base: ${fichero}`,
    ...resumen.fuentes.flatMap((f) => [
      ...describirFuente(f, f.fuente === "registro-oficial" ? turno : undefined),
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
