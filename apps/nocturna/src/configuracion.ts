import { limiteDeCambiosDesdeConfig, RECIENTE, zonasDesdeConfig } from "@celda/ingesta/barrido";
import type { OpcionesCliente } from "@celda/ingesta/cliente";
import { INTERRUPTOR_POR_DEFECTO, type Interruptores } from "@celda/ingesta/ejecucion";
import { opcionesClienteDeFichas, opcionesFichasDesdeConfig } from "@celda/ingesta/fichas";
import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import type * as Option from "effect/Option";

import { type ConexionDePublicacion, conexionDePublicacionDesdeConfig } from "./buzon.ts";
import { calendarioDesdeConfig } from "./calendario.ts";
import type { OpcionesNoche } from "./programa.ts";

/** Todo lo que la ingesta lee de fuera, con los valores de producción por defecto. */
export interface Configuracion {
  /** El fichero SQLite con el estado entre ejecuciones. */
  readonly base: string;
  /** El fichero SQLite del archivo de páginas del registro (ADR 0027). */
  readonly archivo: string;
  readonly noche: OpcionesNoche;
  readonly registroOficial: OpcionesCliente;
  /** Las del cliente de las fichas del registro oficial: su pausa es el ritmo de las fichas. */
  readonly fichasDelRegistro: OpcionesCliente;
  readonly interruptores: Interruptores;
  /** De dónde se lee lo aceptado en la moderación, si está configurado. */
  readonly buzon: Option.Option<ConexionDePublicacion>;
}

/** Cuánto se espera para repetir una publicación fallida en la misma ejecución. */
export const REINTENTO_DE_PUBLICACION = Duration.hours(1);

/** Copias de seguridad de la base que se conservan. */
export const COPIAS_CONSERVADAS = 14;

/**
 * La configuración, desde variables de entorno:
 *
 * - `CELDA_INGESTA_BASE`: el fichero SQLite (`datos/ingesta.sqlite`).
 * - `CELDA_INGESTA_ARCHIVO`: el fichero SQLite del archivo de páginas del registro
 *   (`datos/archivo.sqlite`, ADR 0027). Sus paquetes van a la carpeta `archivo` de la de copias.
 * - `CELDA_INGESTA_COPIAS` y `CELDA_INGESTA_COPIAS_CONSERVADAS`: la carpeta de copias
 *   (`datos/copias`) y cuántas se conservan (14).
 * - `CELDA_PUBLICAR_REINTENTO_MINUTOS`: espera antes de repetir una publicación fallida (60).
 * - `CELDA_REGISTRO_ACTIVO` y `CELDA_REGISTRO_MOTIVO`: el interruptor del registro oficial
 *   (encendido) y el motivo que se apunta si está apagado.
 * - `CELDA_INGESTA_HORA` (`00:30`) y `CELDA_INGESTA_ZONA_HORARIA` (`Europe/Madrid`): a qué hora
 *   lanza el temporizador cada ejecución, el primer sábado de cada mes y el domingo siguiente
 *   (`calendarioDesdeConfig`, ADR 0029). Solo sirven para decir cuándo es la próxima.
 * - Las zonas de barrido de cada ronda del registro oficial: `CELDA_REGISTRO_ZONAS` (las siete)
 *   (`zonasDesdeConfig`).
 * - Las de las fichas del registro oficial: `CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS` (1),
 *   `CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS` (1320) y `CELDA_INGESTA_MAX_FICHAS` (sin tope)
 *   (`opcionesFichasDesdeConfig`).
 * - `CELDA_REGISTRO_CAMBIO_MASIVO_POR_CIENTO` (20) y `CELDA_REGISTRO_CAMBIO_MASIVO_MINIMO` (50):
 *   cuánto puede cambiar el registro en un cuadro o en una zona antes de parar la noche sin
 *   publicar (`limiteDeCambiosDesdeConfig`, ADR 0027).
 * - Las del extractor del registro oficial: `CELDA_REGISTRO_PAUSA_SEGUNDOS`,
 *   `CELDA_REGISTRO_MAX_PETICIONES`, `CELDA_REGISTRO_USER_AGENT`, `CELDA_REGISTRO_REINTENTOS` y
 *   `CELDA_REGISTRO_ESPERA_SEGUNDOS` (`RegistroOficial.opcionesClienteDesdeConfig`).
 *
 * - `CELDA_CONVEX_SITE_URL` y `CELDA_PUBLICACION_CLAVE`: las acciones HTTP del buzón de Convex y
 *   la clave de publicación, con las que la noche lee lo aceptado en la moderación (ADR 0020). Sin
 *   ellas no lo lee. Nunca una clave de despliegue.
 *
 * El registro oficial es la única fuente con extractor (ADR 0019), y la comunidad llega por el
 * buzón. Dónde se publica lo dice `almacenDesdeConfig` (`@celda/publicacion`).
 */
export const configuracion: Config.Config<Configuracion> = Config.all({
  base: Config.String("CELDA_INGESTA_BASE").pipe(Config.withDefault("datos/ingesta.sqlite")),
  archivo: Config.String("CELDA_INGESTA_ARCHIVO").pipe(Config.withDefault("datos/archivo.sqlite")),
  carpetaDeCopias: Config.String("CELDA_INGESTA_COPIAS").pipe(Config.withDefault("datos/copias")),
  conservar: Config.Int("CELDA_INGESTA_COPIAS_CONSERVADAS").pipe(
    Config.withDefault(COPIAS_CONSERVADAS),
  ),
  calendario: calendarioDesdeConfig,
  fichas: opcionesFichasDesdeConfig,
  zonas: zonasDesdeConfig,
  cambioMasivo: limiteDeCambiosDesdeConfig,
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
  buzon: conexionDePublicacionDesdeConfig,
}).pipe(
  Config.map((c): Configuracion => ({
    base: c.base,
    archivo: c.archivo,
    noche: {
      proceso: {
        zonas: c.zonas,
        fichas: c.fichas,
        reciente: RECIENTE,
        cambioMasivo: c.cambioMasivo,
      },
      reintento: Duration.minutes(Math.max(c.reintentoMinutos, 0)),
      copias: { carpeta: c.carpetaDeCopias, conservar: Math.max(c.conservar, 1) },
      calendario: c.calendario,
    },
    registroOficial: c.registroOficial,
    fichasDelRegistro: opcionesClienteDeFichas(c.registroOficial, c.fichas),
    interruptores: {
      "registro-oficial": c.registroActivo
        ? INTERRUPTOR_POR_DEFECTO["registro-oficial"]
        : { activo: false, motivo: c.registroMotivo },
    },
    buzon: c.buzon,
  })),
);
