import { versionDeCapa } from "@celda/dominio/capa";
import type { ZonaEnLaEjecucion } from "@celda/ingesta/barrido";
import type { Cambios, Interruptor } from "@celda/ingesta/ejecucion";
import type { Pendientes } from "@celda/ingesta/fichas";
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
    case "barrido":
      return `${resultado.version} ya estaba publicada; nuevo resumen con el último barrido`;
    case "publicada":
      return `${resultado.version} publicada, ${resultado.escritos} ficheros escritos`;
  }
};

const kilobytes = (bytes: number): string => `${Math.round(bytes / 1000)} kB`;

/** Lo que hizo una zona en una ejecución, para la orden `estado` y el diario. */
export const describirZonaEnLaEjecucion = (z: ZonaEnLaEjecucion): string =>
  `${z.zona}: ${z.estado}, ${z.cuadros} cuadros, ${z.peticiones} peticiones, ` +
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
 * La ronda del registro oficial: las zonas de barrido de la configuración, en su orden, con las
 * fichas que le quedan a cada una; las fichas que le quedan a la ronda; y la próxima ejecución
 * del calendario, con las zonas que barrerá.
 */
export interface Turno {
  readonly zonas: ReadonlyArray<{ readonly zona: string; readonly fichas: Pendientes }>;
  readonly cola: Pendientes;
  readonly proxima: {
    /** «domingo 8/11/2026 a las 00:30 (Europe/Madrid)». */
    readonly cuando: string;
    readonly dia: "sabado" | "domingo";
    /** Cuántas zonas tiene la configuración. */
    readonly configuradas: number;
    /** Las que barrerá, por nombre. */
    readonly zonas: ReadonlyArray<string>;
  };
}

/** Las fichas sin leer en la ronda, sin las que esperan tras un fallo. */
const porLeerEn = ({ cola }: Turno): number => cola.nuevas + cola.porReleer;

/**
 * La próxima ejecución. La del domingo retoma la ronda y solo pide al registro lo que quede de
 * ella; la del primer sábado del mes empieza otra y lo vuelve a leer todo.
 */
const describirProxima = (turno: Turno): string => {
  const { proxima } = turno;
  if (proxima.dia === "sabado") {
    return (
      `  Próxima ejecución: el ${proxima.cuando}. Empieza otra ronda, en la que barre ` +
      `${proxima.configuradas === 1 ? "su zona" : `sus ${proxima.configuradas} zonas`} y lee ` +
      "todas las fichas"
    );
  }
  const porLeer = porLeerEn(turno);
  const queda = loQueQueda(proxima.zonas, porLeer);
  return (
    `  Próxima ejecución: el ${proxima.cuando}. Retoma la ronda y solo pide al registro lo ` +
    "que quede de ella. " +
    (queda === undefined
      ? "Ahora no queda nada, así que no pedirá nada."
      : `Ahora ${proxima.zonas.length + porLeer === 1 ? "queda" : "quedan"} ${queda}.`)
  );
};

/**
 * Lo que queda de una ronda, «1 zona (norte) y 1204 fichas», sin lo que no queda. Sin nada,
 * `undefined`.
 */
export const loQueQueda = (zonas: ReadonlyArray<string>, fichas: number): string | undefined => {
  const partes = [
    ...(zonas.length === 0
      ? []
      : [`${zonas.length === 1 ? "1 zona" : `${zonas.length} zonas`} (${zonas.join(", ")})`]),
    ...(fichas === 0 ? [] : [fichas === 1 ? "1 ficha" : `${fichas} fichas`]),
  ];
  return partes.length === 0 ? undefined : partes.join(" y ");
};

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
    `  Fichas por leer en la ronda: ${describirPendientes(turno.cola)}`,
    "  Zonas de barrido, en el orden de la configuración:",
    ...turno.zonas.map(({ zona, fichas }) =>
      describirZona(deLaBase.get(zona) ?? { zona, completado: null, aMedias: false }, fichas),
    ),
    ...barridas.filter((z) => !configuradas.has(z.zona)).map((z) => describirZona(z)),
    `  La próxima ejecución barre: ${turno.proxima.zonas.length === 0 ? "ninguna zona" : turno.proxima.zonas.join(", ")}`,
    describirProxima(turno),
  ];
};

const describirEjecucion = (e: EjecucionGuardada, turno?: Turno): ReadonlyArray<string> => [
  `  Última ejecución: ${fecha(e.inicio)}, ${e.estado}` +
    (e.registros === null ? "" : `, ${e.registros} registros en el listado`) +
    (e.estado === "en curso" && turno !== undefined
      ? `; le quedan ${porLeerEn(turno)} fichas por leer de la ronda`
      : ""),
  ...(e.estado === "completada" ? [`  Cambios: ${describirCambios(e.cambios)}`] : []),
  ...(e.zonas === null || e.zonas.length === 0
    ? []
    : ["  Zonas:", ...e.zonas.map((z) => `    - ${describirZonaEnLaEjecucion(z)}`)]),
  ...(e.publicacion === null ? [] : [`  Publicación: ${describirPublicacion(e.publicacion)}`]),
  ...(e.errores.length === 0
    ? ["  Errores: ninguno"]
    : [`  Errores (${e.errores.length}):`, ...e.errores.map((error) => `    - ${error}`)]),
];

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

/** Cómo está el interruptor de una fuente, o nada si no tiene. */
const describirInterruptor = (interruptor: Interruptor | undefined): string => {
  if (interruptor === undefined) return "";
  return interruptor.activo ? ": encendida" : `: apagada (${interruptor.motivo})`;
};

const describirFuente = (f: ResumenDeFuente, turno?: Turno): ReadonlyArray<string> => [
  `${f.fuente}${describirInterruptor(f.interruptor)}`,
  ...(f.ultima === undefined
    ? ["  Ninguna ejecución todavía"]
    : describirEjecucion(f.ultima, turno)),
  ...(f.vigentes === 0
    ? []
    : [`  Observaciones vigentes: ${f.vigentes}`, ...describirFichasEnEspera(f)]),
  ...(turno !== undefined
    ? describirZonasEnTurno(f.zonas, turno)
    : f.zonas.length === 0
      ? []
      : ["  Zonas de barrido:", ...f.zonas.map((z) => describirZona(z))]),
];

/**
 * El estado de la base en texto, para la orden `estado`. `turno` es la ronda del registro oficial:
 * sus zonas de barrido en la configuración, lo que le queda y la próxima ejecución.
 */
export const describirResumen = (fichero: string, resumen: Resumen, turno?: Turno): string =>
  [
    `Base: ${fichero}`,
    ...resumen.fuentes.flatMap((f) =>
      describirFuente(f, f.fuente === "registro-oficial" ? turno : undefined),
    ),
    `Emplazamientos: ${resumen.emplazamientos}` +
      (resumen.version === null ? "" : `; versión de los datos ${versionDeCapa(resumen.version)}`),
    `Última versión publicada: ${resumen.publicada ?? "ninguna"}`,
    resumen.ultimoIntento === undefined
      ? "Último intento de publicar: ninguno"
      : `Último intento de publicar: ${fecha(resumen.ultimoIntento.fecha)}, ` +
        describirPublicacion(resumen.ultimoIntento.resultado),
  ].join("\n");
