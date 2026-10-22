import { type Coordenada, contiene, ESPANA } from "@celda/dominio/area";
import type { FuenteDeBarrios } from "@celda/dominio/barrio";
import { distanciaALosDatos, seCortan } from "@celda/dominio/cobertura";
import { marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";
import type { FuenteDeCapitales, FuenteDeMunicipios } from "@celda/dominio/municipio";
import type { ResumenLeido } from "@celda/dominio/provincias";
import type { Credito } from "@celda/ui/Atribucion.tsx";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import { MARGEN_DE_LOS_DATOS } from "../ubicacion/textos.ts";
import type { Vista } from "./marcadores.ts";
import {
  type EstadoProvincia,
  type MotivoFalloProvincia,
  NIVEL_DE_PROVINCIAS,
  type ProvinciaCargada,
} from "./nacional.ts";
import type { FalloCapa } from "./servicio.ts";

/** Por qué no se ha podido cargar el resumen nacional. */
export type MotivoFalloCapa = "sin-publicar" | "sin-origen" | "sin-descarga" | "danada" | "interno";

export type EstadoCapa =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly resumen: ResumenLeido }
  | { readonly tipo: "fallo"; readonly motivo: MotivoFalloCapa };

const MOTIVO: Readonly<Record<FalloCapa["_tag"], MotivoFalloCapa>> = {
  SinCapaPublicada: "sin-publicar",
  OrigenNoResponde: "sin-origen",
  CapaNoDescargada: "sin-descarga",
  CapaIlegible: "danada",
  VersionDistinta: "danada",
  IndiceFallido: "interno",
};

const motivoDe = <A>(salida: Exit.Exit<A, FalloCapa>): MotivoFalloCapa =>
  Exit.isSuccess(salida)
    ? "interno"
    : Cause.findErrorOption(salida.cause).pipe(
        Option.match({ onNone: () => "interno" as const, onSome: (error) => MOTIVO[error._tag] }),
      );

/** El estado del resumen según cómo ha terminado su carga. */
export const estadoDeCarga = (salida: Exit.Exit<ResumenLeido, FalloCapa>): EstadoCapa =>
  Exit.isSuccess(salida)
    ? { tipo: "lista", resumen: salida.value }
    : { tipo: "fallo", motivo: motivoDe(salida) };

const MOTIVO_PROVINCIA: Readonly<Record<MotivoFalloCapa, MotivoFalloProvincia>> = {
  "sin-publicar": "sin-descarga",
  "sin-origen": "sin-descarga",
  "sin-descarga": "sin-descarga",
  danada: "danada",
  interno: "interno",
};

/** El estado de una provincia según cómo ha terminado su carga. */
export const estadoDeProvincia = (
  salida: Exit.Exit<ProvinciaCargada, FalloCapa>,
): EstadoProvincia =>
  Exit.isSuccess(salida)
    ? { tipo: "lista", provincia: salida.value }
    : { tipo: "fallo", motivo: MOTIVO_PROVINCIA[motivoDe(salida)] };

const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

const DIA = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Madrid",
});

/** «26 sep 2026», sin el punto de la abreviatura. */
const textoDeFecha = (fecha: number): string => FECHA.format(fecha).replace(".", "");

/**
 * El texto de la marca de agua del mapa: la fecha de los datos que se ven, en Barcelona. Si lo que
 * se ve se barrió después, también la fecha de ese barrido (historia 13). Si las provincias que se
 * ven son de versiones distintas, las dos fechas.
 */
export const textoDatosDelMapa = (
  fecha: number,
  opciones: { readonly hasta?: number; readonly barrido?: number | null } = {},
): TextoMarcado => {
  const datos =
    opciones.hasta === undefined || DIA.format(opciones.hasta) === DIA.format(fecha)
      ? textoDeFecha(fecha)
      : `${DIA.format(fecha).replace(".", "")} a ${textoDeFecha(opciones.hasta)}`;
  const barrido = opciones.barrido ?? null;
  const ultimo = Math.max(fecha, opciones.hasta ?? fecha);
  return barrido === null || DIA.format(barrido) === DIA.format(ultimo) || barrido < ultimo
    ? marcado`${termino("version-de-los-datos", "Datos del mapa")}: ${datos}`
    : marcado`${termino("version-de-los-datos", "Datos")}: ${datos} · ${termino("barrido", "barrido")} ${DIA.format(barrido).replace(".", "")}`;
};

const MES = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

/**
 * El crédito de los límites de barrio, con su fecha y su licencia, como pide CC BY 4.0:
 * «Ajuntament de Barcelona (nov 2024, CC BY 4.0)». Así cabe en una línea del móvil; el detalle
 * dice que son los límites de barrio y el día exacto.
 */
export const creditoDeBarrios = (fuente: FuenteDeBarrios): Credito => {
  const fecha = Date.parse(`${fuente.fecha}T12:00:00Z`);
  const cuando = Number.isNaN(fecha) ? fuente.fecha : MES.format(fecha).replace(".", "");
  const dia = Number.isNaN(fecha) ? fuente.fecha : textoDeFecha(fecha);
  return {
    texto: `${fuente.atribucion} (${cuando}, ${fuente.licencia})`,
    enlace: fuente.enlace,
    detalle: `Límites de barrio de Open Data BCN, datos del ${dia}`,
  };
};

/**
 * El crédito de unos datos del IGN, como piden sus condiciones para una obra derivada: «Obra
 * derivada de <producto> <fecha> CC-BY 4.0 ign.es» (ADR 0017).
 */
const creditoDelIgn = (
  fuente: FuenteDeMunicipios | FuenteDeCapitales,
  detalle: string,
): Credito => {
  const fecha = Date.parse(`${fuente.fecha}T12:00:00Z`);
  const cuando = Number.isNaN(fecha) ? fuente.fecha : MES.format(fecha).replace(".", "");
  return {
    texto: `Obra derivada de ${fuente.producto} ${cuando} CC-BY 4.0 ign.es`,
    enlace: fuente.enlace,
    detalle,
  };
};

/** El crédito de los límites de municipios y provincias. */
export const creditoDeMunicipios = (fuente: FuenteDeMunicipios): Credito =>
  creditoDelIgn(fuente, "Provincias y municipios de cada emplazamiento, con los límites del IGN");

/** El crédito de las capitales, junto a las que va cada municipio (ADR 0017). */
export const creditoDeCapitales = (fuente: FuenteDeCapitales): Credito =>
  creditoDelIgn(fuente, "Dónde va cada municipio, junto a su capital en el Nomenclátor del IGN");

/**
 * Dónde tiene Celda los emplazamientos, para el detalle de la marca de agua: España si todas las
 * provincias están cubiertas y, si no, las zonas de barrido que ya se han barrido enteras. Sale
 * del resumen, así que dice lo que hay y no lo que habrá.
 */
export const dondeHayDatos = (resumen: ResumenLeido): ReadonlyArray<string> =>
  resumen.provincias.length > 0 && resumen.provincias.every((p) => p.cubierta)
    ? [ESPANA.nombre]
    : resumen.cobertura.filter((z) => z.barrido !== null).map((z) => z.titulo);

/** Una provincia por su código y su nombre. */
interface ProvinciaNombrada {
  readonly codigo: string;
  readonly nombre: string;
}

/**
 * Lo que dice la marca de agua del mapa según lo que se ve (ADR 0016):
 *
 * - `fallo`: alguna provincia que se ve no ha llegado; se dice cuál y se puede reintentar.
 * - `cargando`: alguna provincia que se ve se está pidiendo; se ve su hexágono mientras.
 * - `sin-datos`: lo que se ve queda fuera de lo barrido con emplazamientos
 *   (`distanciaALosDatos`); Celda aún no tiene datos de ahí.
 * - `datos`: la fecha de los datos de lo que se ve, de la más antigua a la más reciente si las
 *   provincias son de versiones distintas, y su último barrido.
 */
export type EstadoDeLaVista =
  | { readonly tipo: "fallo"; readonly provincias: ReadonlyArray<ProvinciaNombrada> }
  | { readonly tipo: "cargando"; readonly provincias: ReadonlyArray<ProvinciaNombrada> }
  | { readonly tipo: "sin-datos"; readonly barridas: ReadonlyArray<string> }
  | {
      readonly tipo: "datos";
      readonly fecha: number;
      readonly hasta: number;
      readonly barrido: number | null;
    };

const centroDe = (vista: Vista): Coordenada => ({
  longitud: (vista.caja.suroeste.longitud + vista.caja.noreste.longitud) / 2,
  latitud: (vista.caja.suroeste.latitud + vista.caja.noreste.latitud) / 2,
});

/**
 * La marca de agua de lo que se ve: una función pura del resumen, de cómo va cada provincia pedida
 * y de la vista. Sin vista todavía, la del resumen.
 */
export const estadoDeLaVista = (
  resumen: ResumenLeido,
  provincias: ReadonlyMap<string, EstadoProvincia>,
  vista: Vista | undefined,
): EstadoDeLaVista => {
  const cerca = vista !== undefined && Math.floor(vista.zoom) >= NIVEL_DE_PROVINCIAS;
  const seVen = resumen.provincias.filter(
    (p) =>
      vista !== undefined &&
      ((p.caja !== undefined && seCortan(p.caja, vista.caja)) ||
        (!cerca && contiene(vista.caja, p.etiqueta))),
  );
  const conEstado = (tipo: EstadoProvincia["tipo"]) =>
    cerca
      ? seVen
          .filter((p) => provincias.get(p.codigo)?.tipo === tipo)
          .map((p) => ({ codigo: p.codigo, nombre: p.nombre }))
      : [];
  const fallidas = conEstado("fallo");
  if (fallidas.length > 0) return { tipo: "fallo", provincias: fallidas };
  const cargando = conEstado("cargando");
  if (cargando.length > 0) return { tipo: "cargando", provincias: cargando };
  if (cerca) {
    const distancia = distanciaALosDatos(centroDe(vista), resumen);
    if (distancia === undefined || distancia > MARGEN_DE_LOS_DATOS) {
      return {
        tipo: "sin-datos",
        barridas: resumen.cobertura.filter((z) => z.barrido !== null).map((z) => z.titulo),
      };
    }
  }
  const fechas = seVen.flatMap((p) => {
    const estado = provincias.get(p.codigo);
    return estado?.tipo === "lista" ? [estado.provincia.fecha] : [];
  });
  const barridos = seVen.flatMap((p) => (p.barrido === null ? [] : [p.barrido]));
  return {
    tipo: "datos",
    fecha: fechas.length === 0 ? resumen.fecha : Math.min(...fechas),
    hasta: fechas.length === 0 ? resumen.fecha : Math.max(...fechas),
    barrido: barridos.length === 0 ? null : Math.max(...barridos),
  };
};
