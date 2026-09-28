import type { Fuente } from "@celda/dominio/observacion";
import * as AntenasMoviles from "@celda/ingesta/antenasmoviles/extractor";
import { opcionesZonasDesdeConfig, zonasDesdeConfig } from "@celda/ingesta/barrido";
import { OPCIONES_PUNTOS } from "@celda/ingesta/barridoDePuntos";
import type { OpcionesCliente } from "@celda/ingesta/cliente";
import { INTERRUPTOR_POR_DEFECTO, type Interruptor } from "@celda/ingesta/ejecucion";
import { opcionesProcesoDesdeConfig } from "@celda/ingesta/proceso";
import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import type { OpcionesNoche } from "./programa.ts";

/** Todo lo que la ingesta nocturna lee de fuera, con los valores de hoy por defecto. */
export interface Configuracion {
  /** El fichero SQLite con el estado entre noches. */
  readonly base: string;
  readonly noche: OpcionesNoche;
  readonly registroOficial: OpcionesCliente;
  /** El cliente de antenasmoviles.es. Qué puntos guarda lo dicen sus zonas, en `noche.puntos`. */
  readonly antenasMoviles: OpcionesCliente;
  readonly interruptores: Readonly<Record<Fuente, Interruptor>>;
}

/** Cada cuánto se reintenta una publicación fallida la misma noche. */
export const REINTENTO_DE_PUBLICACION = Duration.hours(1);

/** Copias de seguridad de la base que se conservan. */
export const COPIAS_CONSERVADAS = 14;

/**
 * La configuración, desde variables de entorno:
 *
 * - `CELDA_INGESTA_BASE`: el fichero SQLite (`datos/ingesta.sqlite`).
 * - `CELDA_INGESTA_COPIAS` y `CELDA_INGESTA_COPIAS_CONSERVADAS`: la carpeta de copias
 *   (`datos/copias`) y cuántas se conservan (14).
 * - `CELDA_INGESTA_MAX_FICHAS`: fichas por noche (250).
 * - `CELDA_PUBLICAR_REINTENTO_MINUTOS`: espera antes de repetir una publicación fallida (60).
 * - `CELDA_REGISTRO_ACTIVO` y `CELDA_REGISTRO_MOTIVO`: el interruptor del registro oficial
 *   (encendido) y el motivo que se apunta si está apagado.
 * - Las zonas de barrido del registro oficial: `CELDA_REGISTRO_ZONAS` (`cataluna`),
 *   `CELDA_REGISTRO_ZONAS_EN_TURNO` (ninguna) y `CELDA_REGISTRO_ZONAS_POR_NOCHE` (1)
 *   (`opcionesZonasDesdeConfig`).
 * - Las del extractor del registro oficial: `CELDA_REGISTRO_PAUSA_SEGUNDOS`,
 *   `CELDA_REGISTRO_MAX_PETICIONES`, `CELDA_REGISTRO_USER_AGENT`, `CELDA_REGISTRO_REINTENTOS` y
 *   `CELDA_REGISTRO_ESPERA_SEGUNDOS` (`RegistroOficial.opcionesClienteDesdeConfig`).
 *
 * - antenasmoviles.es: `CELDA_ANTENASMOVILES_ACTIVO` (apagado hasta escribir a su administrador)
 *   y `CELDA_ANTENASMOVILES_MOTIVO`; sus zonas, `CELDA_ANTENASMOVILES_ZONAS` (por defecto, las del
 *   registro oficial, las de cada noche y las que se turnan); los detalles por noche,
 *   `CELDA_ANTENASMOVILES_MAX_DETALLES` (100); la pausa entre peticiones,
 *   `CELDA_ANTENASMOVILES_PAUSA_SEGUNDOS` (5, nunca menos); el tope de peticiones,
 *   `CELDA_ANTENASMOVILES_MAX_PETICIONES` (los detalles más 10), y el `User-Agent`,
 *   `CELDA_ANTENASMOVILES_USER_AGENT` (el del registro oficial).
 *
 * OpenCelliD no tiene extractor en la ingesta nocturna todavía: queda apagado. Dónde se publica
 * lo dice `almacenDesdeConfig` (`@celda/publicacion`).
 */
export const configuracion: Config.Config<Configuracion> = Config.all({
  base: Config.String("CELDA_INGESTA_BASE").pipe(Config.withDefault("datos/ingesta.sqlite")),
  carpetaDeCopias: Config.String("CELDA_INGESTA_COPIAS").pipe(Config.withDefault("datos/copias")),
  conservar: Config.Int("CELDA_INGESTA_COPIAS_CONSERVADAS").pipe(
    Config.withDefault(COPIAS_CONSERVADAS),
  ),
  proceso: opcionesProcesoDesdeConfig,
  zonas: opcionesZonasDesdeConfig,
  reintentoMinutos: Config.Int("CELDA_PUBLICAR_REINTENTO_MINUTOS").pipe(
    Config.withDefault(Duration.toMinutes(REINTENTO_DE_PUBLICACION)),
  ),
  registroOficial: RegistroOficial.opcionesClienteDesdeConfig,
  registroActivo: Config.Boolean("CELDA_REGISTRO_ACTIVO").pipe(
    Config.withDefault(INTERRUPTOR_POR_DEFECTO["registro-oficial"].activo),
  ),
  registroMotivo: Config.String("CELDA_REGISTRO_MOTIVO").pipe(
    Config.withDefault("apagado en la configuración de la ingesta"),
  ),
  antenasActivo: Config.Boolean("CELDA_ANTENASMOVILES_ACTIVO").pipe(
    Config.withDefault(INTERRUPTOR_POR_DEFECTO.antenasmoviles.activo),
  ),
  antenasMotivo: Config.String("CELDA_ANTENASMOVILES_MOTIVO").pipe(
    Config.withDefault(INTERRUPTOR_POR_DEFECTO.antenasmoviles.motivo),
  ),
  antenasZonas: zonasDesdeConfig("CELDA_ANTENASMOVILES_ZONAS"),
  antenasMaxDetalles: Config.Int("CELDA_ANTENASMOVILES_MAX_DETALLES").pipe(
    Config.withDefault(OPCIONES_PUNTOS.maxDetalles),
  ),
  antenasPausaSegundos: Config.Int("CELDA_ANTENASMOVILES_PAUSA_SEGUNDOS").pipe(
    Config.withDefault(Duration.toSeconds(AntenasMoviles.PAUSA_MINIMA)),
  ),
  antenasMaxPeticiones: Config.option(Config.Int("CELDA_ANTENASMOVILES_MAX_PETICIONES")),
  antenasUserAgent: Config.option(Config.String("CELDA_ANTENASMOVILES_USER_AGENT")),
}).pipe(
  Config.map((c): Configuracion => ({
    base: c.base,
    noche: {
      proceso: { ...c.proceso, zonas: c.zonas },
      puntos: {
        ...OPCIONES_PUNTOS,
        // Sin zonas propias, las del registro oficial: el listado es de toda España y se pide
        // una vez, así que las que se turnan también caben cada noche.
        zonas: Option.getOrElse(c.antenasZonas, () => [
          ...new Set([...c.zonas.cadaNoche, ...c.zonas.enTurno]),
        ]),
        maxDetalles: Math.max(c.antenasMaxDetalles, 0),
      },
      reintento: Duration.minutes(Math.max(c.reintentoMinutos, 0)),
      copias: { carpeta: c.carpetaDeCopias, conservar: Math.max(c.conservar, 1) },
    },
    registroOficial: c.registroOficial,
    antenasMoviles: {
      ...AntenasMoviles.OPCIONES_CLIENTE,
      userAgent: Option.getOrElse(c.antenasUserAgent, () => c.registroOficial.userAgent),
      pausa: AntenasMoviles.pausaDesdeSegundos(c.antenasPausaSegundos),
      // `robots.txt`, el listado, los detalles y margen para reintentos.
      maxPeticiones: Option.getOrElse(
        c.antenasMaxPeticiones,
        () => Math.max(c.antenasMaxDetalles, 0) + 10,
      ),
    },
    interruptores: {
      ...INTERRUPTOR_POR_DEFECTO,
      "registro-oficial": c.registroActivo
        ? INTERRUPTOR_POR_DEFECTO["registro-oficial"]
        : { activo: false, motivo: c.registroMotivo },
      antenasmoviles: { activo: c.antenasActivo, motivo: c.antenasMotivo },
    },
  })),
);
