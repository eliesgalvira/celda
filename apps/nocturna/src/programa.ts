import type { Fuente } from "@celda/dominio/observacion";
import type { PaginaParaPublicar } from "@celda/dominio/moderacion";
import { SIN_CAMBIOS } from "@celda/ingesta/ejecucion";
import {
  BaseDeBarrido,
  ejecutarBarrido,
  type OpcionesBarrido,
  type PorLeer,
  type ZonaEnLaEjecucion,
  zonasPorBarrer,
} from "@celda/ingesta/barrido";
import type { ExtractorPorCajas } from "@celda/ingesta/extractor";
import { pendientesPorZona, PublicacionAMitad, resumirCola } from "@celda/ingesta/fichas";
import { AlmacenDeCopias, type AlmacenDeFicheros } from "@celda/publicacion/almacen";
import {
  DatosPublicables,
  describirFallo,
  type FalloPublicacion,
  publicar,
  type ResultadoPublicacion,
} from "@celda/publicacion/publicar";
import { ponerAlDiaVercel, type ResultadoVercel, SitioEnVercel } from "@celda/publicacion/vercel";
import type { ZonasDePublicacion } from "@celda/publicacion/zonas";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { type CopiaDelArchivo, copiarArchivo } from "./archivo.ts";
import { BaseNocturna } from "./base.ts";
import { AceptadasDelBuzon } from "./buzon.ts";
import {
  type Calendario,
  describirProgramada,
  type EjecucionProgramada,
  proximaEjecucion,
} from "./calendario.ts";
import { describirResumen, loQueQueda, type Turno } from "./estado.ts";

/**
 * Los extractores de la ejecución, uno por fuente que ya tiene extractor. Cada ejecución construye
 * el suyo desde su capa, así que su tope de peticiones cuenta desde el principio de la ejecución.
 */
export class Extractores extends Context.Service<
  Extractores,
  {
    readonly registroOficial: Layer.Layer<ExtractorPorCajas>;
    /**
     * Lo aceptado en la moderación, por la acción HTTP del buzón con la clave de publicación (la
     * comunidad, ADR 0020). `None` sin la conexión configurada.
     */
    readonly comunidad: Option.Option<Layer.Layer<AceptadasDelBuzon>>;
  }
>()("@celda/nocturna/programa/Extractores") {}

/** Un intento de publicar, y si merece la pena repetirlo al cabo de un rato. */
export interface Intento {
  readonly resultado: ResultadoPublicacion;
  readonly reintentar: boolean;
}

/**
 * Publica la base en el almacén de la configuración, o no hace nada si no hay almacén, y lanza el
 * build de Vercel si aún no sirve la versión vigente.
 */
export class Publicador extends Context.Service<
  Publicador,
  {
    readonly publicar: Effect.Effect<Intento>;
    /** Lanza el build de Vercel si no sirve ya la versión vigente del almacén (ADR 0018). */
    readonly ponerAlDiaVercel: Effect.Effect<ResultadoVercel>;
  }
>()("@celda/nocturna/programa/Publicador") {}

/**
 * Fallos que pueden desaparecer solos: el almacén o la base no responden (un bloqueo de LaLiga
 * corta R2) o los datos se movieron a mitad. Los demás darían lo mismo al cabo de una hora.
 */
const PASAJEROS: ReadonlySet<FalloPublicacion["_tag"]> = new Set([
  "AlmacenNoDisponible",
  "DatosNoDisponibles",
  "InstantaneaMovida",
]);

const SIN_HOOK: Effect.Effect<ResultadoVercel> = Effect.succeed({ tipo: "sin-hook" });

/**
 * El publicador sobre los `DatosPublicables` de la base y el almacén del contexto, con Vercel si
 * el contexto lo tiene.
 */
export const publicadorEn = (zonas: ZonasDePublicacion, porLote?: number) =>
  Layer.effect(
    Publicador,
    Effect.gen(function* () {
      const contexto = yield* Effect.context<DatosPublicables | AlmacenDeFicheros>();
      const sitio = yield* Effect.serviceOption(SitioEnVercel);
      return Publicador.of({
        publicar: publicar(zonas, porLote).pipe(
          Effect.map((publicada): Intento => ({ resultado: publicada, reintentar: false })),
          Effect.catch((fallo) =>
            Effect.succeed<Intento>({
              resultado: { tipo: "fallida", motivo: describirFallo(fallo) },
              reintentar: PASAJEROS.has(fallo._tag),
            }),
          ),
          Effect.provideContext(contexto),
        ),
        ponerAlDiaVercel: Option.match(sitio, {
          onNone: () => SIN_HOOK,
          onSome: (vercel) =>
            ponerAlDiaVercel.pipe(
              Effect.provideService(SitioEnVercel, vercel),
              Effect.provideContext(contexto),
            ),
        }),
      });
    }),
  );

/** Sin almacén configurado no se publica nada, y se apunta así. */
export const sinAlmacen = Layer.succeed(
  Publicador,
  Publicador.of({
    publicar: Effect.succeed({ resultado: { tipo: "sin-almacen" }, reintentar: false }),
    ponerAlDiaVercel: SIN_HOOK,
  }),
);

/** Dónde se guardan las copias de seguridad de la base y cuántas se conservan. */
export interface OpcionesCopias {
  readonly carpeta: string;
  readonly conservar: number;
}

/** Lo que hace la orden `noche`, aparte de los extractores. */
export interface OpcionesNoche {
  readonly proceso: OpcionesBarrido;
  /** Si publicar falla por algo pasajero, cuánto se espera para repetirlo una vez. */
  readonly reintento: Duration.Duration;
  readonly copias: OpcionesCopias;
  /** Cuándo lanza el temporizador cada ejecución, para decir en el diario quién sigue. */
  readonly calendario: Calendario;
}

/** Una ejecución de la orden `noche`, de una fuente. */
export interface EjecucionDeLaNoche {
  readonly fuente: Fuente;
  readonly ejecucion: string;
  readonly estado: "omitida" | "fallida" | "completada";
  readonly zonas: ReadonlyArray<ZonaEnLaEjecucion>;
  /** Lo que queda de la ronda, en el registro oficial. */
  readonly porLeer?: PorLeer;
  /** Si la ejecución se ha parado por un cambio masivo en la fuente, por qué. */
  readonly detenida?: string;
}

/** Una ejecución parada por un cambio masivo en una fuente: no publica ni lanza el build. */
export interface PublicacionDetenida {
  readonly tipo: "detenida";
  readonly motivo: string;
}

/** Lo que ha hecho la orden `noche`. */
export interface Noche {
  readonly ejecuciones: ReadonlyArray<EjecucionDeLaNoche>;
  readonly publicacion: ResultadoPublicacion | PublicacionDetenida;
  readonly vercel: ResultadoVercel;
  /** La copia de seguridad que se ha hecho, o `undefined` si ha fallado. */
  readonly copia: string | undefined;
  readonly copiaEnR2: CopiaEnR2;
  /** Lo que ha hecho la copia del archivo de páginas, o `undefined` sin archivo. */
  readonly archivo: CopiaDelArchivo | undefined;
}

/** La carpeta de los paquetes del archivo de páginas, dentro de la de copias (ADR 0027). */
export const carpetaDelArchivo = (copias: OpcionesCopias) =>
  Effect.map(Effect.service(Path.Path), (path) => path.join(copias.carpeta, "archivo"));

const COPIA = /^ingesta-.+\.sqlite$/u;

/**
 * Copia la base a la carpeta de copias (`ingesta-<fecha>.sqlite`) y borra las más viejas hasta
 * dejar `conservar`. Devuelve la ruta de la copia.
 */
export const copiarBase = Effect.fn("Nocturna.copiarBase")(function* (opciones: OpcionesCopias) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* BaseNocturna;
  const ahora = DateTime.makeUnsafe(yield* Clock.currentTimeMillis);
  const destino = path.join(
    opciones.carpeta,
    `ingesta-${DateTime.formatIso(ahora).replaceAll(":", "-")}.sqlite`,
  );
  yield* fs.makeDirectory(opciones.carpeta, { recursive: true });
  if (!(yield* fs.exists(destino))) {
    yield* base.copiar(destino);
  }
  // El nombre lleva la fecha ISO: en orden alfabético, las más nuevas van al final.
  const copias = (yield* fs.readDirectory(opciones.carpeta))
    .filter((nombre) => COPIA.test(nombre))
    .toSorted()
    .toReversed();
  yield* Effect.forEach(
    copias.slice(Math.max(opciones.conservar, 1)),
    (vieja) => fs.remove(path.join(opciones.carpeta, vieja)),
    { discard: true },
  );
  return destino;
});

/** Lo que ha pasado con la copia de la base en R2. Nunca es un fallo de la ejecución. */
export type CopiaEnR2 =
  /** No hay cubo de R2 configurado, o no hay copia local que subir. */
  | { readonly tipo: "sin-subir" }
  | { readonly tipo: "subida"; readonly nombre: string; readonly retiradas: number }
  | { readonly tipo: "fallida"; readonly motivo: string };

/** La copia no se ha podido leer o comprimir para subirla. */
class CopiaIlegible extends Schema.TaggedError<CopiaIlegible>()("CopiaIlegible", {
  motivo: Schema.String,
}) {}

const COPIA_COMPRIMIDA = /^ingesta-.+\.sqlite\.gz$/u;

/** Una copia de la base comprimida con gzip, leída a trozos del disco. */
const comprimir = (ruta: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // Cada trozo en su propio búfer, que es lo que acepta `CompressionStream`.
    const legible = yield* Stream.toReadableStreamEffect(
      Stream.map(fs.stream(ruta), (trozo) => new Uint8Array(trozo)),
    );
    return yield* Effect.tryPromise({
      try: async () =>
        new Uint8Array(
          await new Response(legible.pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
        ),
      catch: (causa) => new CopiaIlegible({ motivo: `${ruta}: ${String(causa)}` }),
    });
  });

/**
 * Sube a R2 la copia de la base que acaba de hacer `copiarBase`, comprimida
 * (`ingesta-<fecha>.sqlite.gz`), y borra allí las más viejas hasta dejar `conservar`, como en el
 * disco (ADR 0018). Sin cubo de R2 no hace nada. Si algo falla, lo apunta en el diario y la
 * ejecución sigue.
 */
export const subirCopia = Effect.fn("Nocturna.subirCopia")(function* (
  ruta: string,
  conservar: number,
) {
  const almacen = yield* Effect.serviceOption(AlmacenDeCopias);
  if (Option.isNone(almacen)) {
    const sinSubir: CopiaEnR2 = { tipo: "sin-subir" };
    return sinSubir;
  }
  const copias = almacen.value;
  const path = yield* Path.Path;
  const nombre = `${path.basename(ruta)}.gz`;
  const subida = yield* Effect.gen(function* () {
    yield* copias.guardar(nombre, yield* comprimir(ruta));
    // El nombre lleva la fecha ISO: en orden alfabético, las más nuevas van al final.
    const viejas = (yield* copias.listar)
      .filter((guardada) => COPIA_COMPRIMIDA.test(guardada))
      .toSorted()
      .toReversed()
      .slice(Math.max(conservar, 1));
    yield* Effect.forEach(viejas, copias.borrar, { discard: true });
    const hecha: CopiaEnR2 = { tipo: "subida", nombre, retiradas: viejas.length };
    return hecha;
  }).pipe(
    Effect.catchTags({
      AlmacenNoDisponible: (error) =>
        Effect.succeed<CopiaEnR2>({ tipo: "fallida", motivo: error.motivo }),
      CopiaIlegible: (error) =>
        Effect.succeed<CopiaEnR2>({ tipo: "fallida", motivo: error.motivo }),
    }),
  );
  if (subida.tipo === "subida") {
    yield* Effect.logInfo(
      `Copia de la base en R2: ${subida.nombre}` +
        (subida.retiradas === 0 ? "" : `, ${subida.retiradas} retiradas`),
    );
  } else if (subida.tipo === "fallida") {
    yield* Effect.logWarning(`No se ha podido subir la copia de la base a R2: ${subida.motivo}`);
  }
  return subida;
});

/** Publica una vez y lo apunta en la base, con las ejecuciones que la piden. */
const publicarYApuntar = Effect.fn("Nocturna.publicar")(function* (
  ejecuciones: ReadonlyArray<string>,
) {
  const publicador = yield* Publicador;
  const base = yield* BaseNocturna;
  const intento = yield* publicador.publicar;
  const { resultado } = intento;
  yield* base.apuntarPublicacion({ fecha: yield* Clock.currentTimeMillis, resultado }, ejecuciones);
  if (resultado.tipo === "fallida") {
    yield* Effect.logWarning(`Publicación fallida: ${resultado.motivo}`);
  } else if (resultado.tipo === "sin-almacen") {
    yield* Effect.logInfo("Sin almacén de ficheros: no se publica nada");
  } else {
    yield* Effect.logInfo(
      `${resultado.version}: ${resultado.tipo}, ${resultado.escritos} ficheros escritos`,
    );
  }
  return intento;
});

/** Lanza el build de Vercel si hace falta y lo apunta en el diario, haya hecho falta o no. */
const ponerAlDiaYApuntarVercel = Effect.gen(function* () {
  const publicador = yield* Publicador;
  const vercel = yield* publicador.ponerAlDiaVercel;
  switch (vercel.tipo) {
    case "sin-hook":
      yield* Effect.logInfo("Sin deploy hook de Vercel: no se lanza ningún build");
      break;
    case "sin-publicar":
      yield* Effect.logInfo("Vercel: no hay nada publicado que montar");
      break;
    case "al-dia":
      yield* Effect.logInfo(`Vercel ya sirve ${vercel.version}: no hace falta otro build`);
      break;
    case "desplegada":
      yield* Effect.logInfo(`Vercel no sirve ${vercel.version}: build lanzado`);
      break;
    case "fallida":
      yield* Effect.logWarning(`Vercel sin poner al día: ${vercel.motivo}`);
      break;
  }
  return vercel;
}).pipe(Effect.withSpan("Nocturna.ponerAlDiaVercel"));

/** Una ejecución con el extractor que da `capa`, construido para ella sola. */
const ejecutarCon = <I, A, E, R>(capa: Layer.Layer<I>, ejecucion: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.flatMap(Layer.build(capa), (extractor) =>
      ejecucion.pipe(Effect.provideContext(extractor)),
    ),
  );

/**
 * Lee del buzón lo aceptado en la moderación desde la última vez y lo guarda en la base, página a
 * página, como una ejecución de la comunidad (ADR 0020). Sigue desde la última aceptada que tiene
 * la base, y una que ya tenía no se guarda dos veces, así que leer dos veces lo mismo no duplica
 * nada. Si el buzón no contesta, la ejecución queda fallida con lo que haya guardado, lo dice el
 * diario y la orden sigue: lo que falte llega en la ejecución siguiente.
 */
export const recogerAceptadas = Effect.fn("Nocturna.recogerAceptadas")(function* (
  buzon: Layer.Layer<AceptadasDelBuzon>,
) {
  const base = yield* BaseDeBarrido;
  const nocturna = yield* BaseNocturna;
  const inicio = yield* Clock.currentTimeMillis;
  const arranque = yield* base.iniciar("comunidad", inicio);
  const sinZonas: ReadonlyArray<ZonaEnLaEjecucion> = [];
  if (arranque.tipo === "omitida") {
    const omitida: EjecucionDeLaNoche = {
      fuente: "comunidad",
      ejecucion: arranque.ejecucion,
      estado: "omitida",
      zonas: sinZonas,
    };
    return omitida;
  }
  const cuentas = { leidas: 0, nuevas: 0 };
  const recogida = Effect.gen(function* () {
    const cliente = yield* AceptadasDelBuzon;
    let despuesDe = yield* nocturna.ultimaAceptada;
    for (;;) {
      const pagina: PaginaParaPublicar = yield* cliente.leer(despuesDe);
      cuentas.leidas += pagina.aportaciones.length;
      cuentas.nuevas += yield* nocturna.guardarAceptadas(pagina.aportaciones, inicio);
      if (pagina.ultima === null) return;
      despuesDe = pagina.ultima;
    }
    // La conexión con el buzón se monta solo para la recogida: si falla, se publica lo demás.
    // @effect-diagnostics-next-line strictEffectProvide:off
  }).pipe(Effect.provide(buzon));
  const fallo = yield* recogida.pipe(
    Effect.match({
      onSuccess: () => Option.none<string>(),
      onFailure: (error) => Option.some(error.message),
    }),
  );
  const cierre = {
    fin: yield* Clock.currentTimeMillis,
    cambios: {
      ...SIN_CAMBIOS,
      observaciones: { creados: cuentas.nuevas, cambiados: 0, retirados: 0 },
    },
    zonas: sinZonas,
  };
  if (Option.isSome(fallo)) {
    yield* base.fallar(arranque.ejecucion, { ...cierre, errores: [fallo.value] });
    yield* Effect.logWarning(
      `${fallo.value}. Se publica lo demás; lo aceptado que falta llega en la ejecución siguiente` +
        ` (${cuentas.nuevas} aceptadas nuevas guardadas antes del fallo)`,
    );
  } else {
    yield* base.completar(arranque.ejecucion, {
      ...cierre,
      registros: cuentas.leidas,
      errores: [],
    });
    yield* Effect.logInfo(
      `Buzón de Convex: ${cuentas.leidas} aceptadas leídas, ${cuentas.nuevas} nuevas`,
    );
  }
  const hecha: EjecucionDeLaNoche = {
    fuente: "comunidad",
    ejecucion: arranque.ejecucion,
    estado: Option.isSome(fallo) ? "fallida" : "completada",
    zonas: sinZonas,
  };
  return hecha;
});

const describirZona = (z: ZonaEnLaEjecucion): string =>
  `Zona ${z.zona}: ${z.estado}, ${z.cuadros} cuadros, ${z.peticiones} peticiones, ` +
  `${Math.round(z.bytes / 1000)} kB, ${z.registros} registros, observaciones ` +
  `+${z.observaciones.creados} ~${z.observaciones.cambiados} -${z.observaciones.retirados}` +
  (z.error === undefined ? "" : ` (${z.error})`);

/** Una línea del diario, y si va como aviso. */
export interface LineaDelDiario {
  readonly aviso: boolean;
  readonly texto: string;
}

/**
 * Lo que dice el diario al acabar una ejecución del registro: lo que queda de la ronda y qué
 * ejecución del calendario lo lee. La del domingo retoma la ronda; la del primer sábado del mes
 * siguiente empieza otra y lo vuelve a leer todo, así que lo que quede para ella se ha quedado
 * sin leer este mes.
 */
export const describirLoQueQueda = (
  porLeer: PorLeer,
  proxima: EjecucionProgramada,
  calendario: Calendario,
): LineaDelDiario => {
  const cuando = describirProgramada(calendario, proxima);
  const queda = loQueQueda(porLeer.zonas, porLeer.fichas);
  if (queda === undefined) {
    return {
      aviso: false,
      texto:
        proxima.dia === "domingo"
          ? `La ronda está entera, así que la ejecución del ${cuando} no pedirá nada al registro`
          : `La ronda está entera. La próxima ejecución es la del ${cuando}, que empieza otra`,
    };
  }
  return proxima.dia === "domingo"
    ? {
        aviso: false,
        texto: `Lo que queda de la ronda, ${queda}, lo lee la ejecución del ${cuando}`,
      }
    : {
        aviso: true,
        texto:
          `Lo que queda de la ronda, ${queda}, se queda sin leer este mes, porque no hay otra ` +
          `ejecución hasta la del ${cuando}, que empieza otra ronda`,
      };
};

/**
 * Una ejecución de la ingesta, la que lanza la orden `noche`:
 *
 * 0. Con la conexión con el buzón de Convex, lee lo aceptado en la moderación desde la última vez
 *    (`recogerAceptadas`), para que la publicación lo lleve a las fichas. Si Convex no contesta,
 *    lo dice el diario y la ejecución sigue.
 * 1. Una ejecución de ingesta por fuente con extractor, con su interruptor. El registro oficial
 *    barre las zonas de barrido y lee las fichas que faltan en la ronda hasta cerrar su ventana,
 *    publicando a mitad, y fusiona (`ejecutarBarrido`). El diario dice lo que queda de la ronda y
 *    qué ejecución lo lee (`describirLoQueQueda`).
 * 2. Publica la capa y las fichas. Sin cambios no escribe nada, y si la ejecución anterior no pudo
 *    publicar, lo hace ahora. Si falla por algo pasajero, lo apunta, espera `reintento` y lo
 *    intenta otra vez; si vuelve a fallar, queda para la ejecución siguiente. Los datos ya están
 *    en la base.
 * 3. Si Vercel no sirve la versión vigente del almacén, lanza su build con el deploy hook, y el
 *    build monta las capas desde R2 (ADR 0018). Se hace también si la publicación ha fallado:
 *    Vercel sigue a lo que haya en el almacén.
 * 4. Copia la base a la carpeta de copias y deja las `conservar` últimas. Con un cubo de R2,
 *    sube también la copia comprimida y deja allí otras tantas.
 * 5. Saca del archivo de páginas un paquete con lo nuevo de la ejecución, en la carpeta `archivo`
 *    de la de copias, y sube a R2 los paquetes que aún no están allí (ADR 0027). Si falla, la
 *    ejecución acaba bien y lo que falta va con el paquete siguiente.
 *
 * Una ejecución cortada a mitad se queda en curso; la siguiente la da por interrumpida y rehace lo
 * que faltaba, porque cada paso es idempotente. Un barrido de zona cortado se retoma por el primer
 * cuadro que no llegó a guardarse.
 */
export const noche = Effect.fn("Nocturna.noche")(function* (opciones: OpcionesNoche) {
  const extractores = yield* Extractores;
  const comunidad = Option.isSome(extractores.comunidad)
    ? [yield* recogerAceptadas(extractores.comunidad.value)]
    : [];
  // A mitad de la ventana de fichas se publica lo que haya, sin esperar ni repetir si falla: al
  // final de la ejecución se vuelve a publicar.
  const contexto = yield* Effect.context<Publicador | BaseNocturna>();
  const aMitad = PublicacionAMitad.of({
    publicar: publicarYApuntar([]).pipe(Effect.asVoid, Effect.provideContext(contexto)),
  });
  const registro = yield* ejecutarCon(
    extractores.registroOficial,
    ejecutarBarrido(opciones.proceso).pipe(Effect.provideService(PublicacionAMitad, aMitad)),
  );
  const ejecuciones: ReadonlyArray<EjecucionDeLaNoche> = [
    ...comunidad,
    { fuente: "registro-oficial", ...registro },
  ];
  for (const { fuente, estado, zonas } of ejecuciones) {
    yield* Effect.logInfo(`Ejecución de ${fuente}: ${estado}`);
    for (const zona of zonas) {
      yield* Effect.logInfo(describirZona(zona));
    }
  }
  if (registro.porLeer !== undefined && registro.detenida === undefined) {
    const queda = describirLoQueQueda(
      registro.porLeer,
      proximaEjecucion(opciones.calendario, yield* Clock.currentTimeMillis),
      opciones.calendario,
    );
    yield* queda.aviso ? Effect.logWarning(queda.texto) : Effect.logInfo(queda.texto);
  }
  const completadas = ejecuciones.filter((e) => e.estado === "completada").map((e) => e.ejecucion);

  // Un cambio masivo en el registro para la ejecución antes de publicar (ADR 0027): lo publicado
  // y lo que sirve Vercel se quedan como estaban hasta que alguien lo mire.
  const detenida = ejecuciones.find((e) => e.detenida !== undefined)?.detenida;
  let publicacion: ResultadoPublicacion | PublicacionDetenida;
  let vercel: ResultadoVercel;
  if (detenida === undefined) {
    let intento = yield* publicarYApuntar(completadas);
    if (intento.reintentar) {
      yield* Effect.logInfo(
        `Se vuelve a publicar dentro de ${Duration.format(opciones.reintento)}`,
      );
      yield* Effect.sleep(opciones.reintento);
      intento = yield* publicarYApuntar(completadas);
    }
    publicacion = intento.resultado;
    vercel = yield* ponerAlDiaYApuntarVercel;
  } else {
    yield* Effect.logError(`La ejecución no publica: ${detenida}`);
    publicacion = { tipo: "detenida", motivo: detenida };
    vercel = { tipo: "sin-hook" };
  }

  const copia = yield* copiarBase(opciones.copias).pipe(
    Effect.tap((destino) => Effect.logInfo(`Copia de la base en ${destino}`)),
    Effect.catch((fallo) =>
      Effect.as(Effect.logWarning(`No se ha podido copiar la base: ${fallo.message}`), undefined),
    ),
  );
  const copiaEnR2: CopiaEnR2 =
    copia === undefined
      ? { tipo: "sin-subir" }
      : yield* subirCopia(copia, opciones.copias.conservar);
  const archivo = yield* copiarArchivo(yield* carpetaDelArchivo(opciones.copias));
  const hecha: Noche = {
    ejecuciones,
    publicacion,
    vercel,
    copia,
    copiaEnR2,
    archivo,
  };
  return hecha;
});

/**
 * Una ejecución parada por un cambio masivo en el registro (ADR 0027). La orden `noche` acaba con
 * este error, y con él con un código distinto de cero, para que systemd dé el servicio por fallido
 * y se vea en `systemctl` y en las alertas.
 */
export class NocheDetenida extends Schema.TaggedError<NocheDetenida>()("NocheDetenida", {
  motivo: Schema.String,
}) {
  override get message() {
    return `La ejecución se ha parado sin publicar: ${this.motivo}`;
  }
}

/** Falla con `NocheDetenida` si la ejecución se paró por un cambio masivo. */
export const comprobarNoche = (hecha: Noche): Effect.Effect<void, NocheDetenida> =>
  hecha.publicacion.tipo === "detenida"
    ? Effect.fail(new NocheDetenida({ motivo: hecha.publicacion.motivo }))
    : Effect.void;

/** Publica a mano, sin ingerir nada, lo apunta en la base y lanza el build de Vercel si hace falta. */
export const publicarAMano = Effect.gen(function* () {
  const { resultado } = yield* publicarYApuntar([]);
  const vercel = yield* ponerAlDiaYApuntarVercel;
  return { publicacion: resultado, vercel };
});

/**
 * Escribe el estado de la base: cada fuente y, del registro oficial, cuántas fichas le quedan a
 * la ronda, también durante una ejecución; sus zonas de barrido, cuándo se barrió cada una y
 * cuántas fichas le quedan; y la próxima ejecución del calendario, con lo que barrerá. Después, lo
 * publicado y el último intento de publicar.
 */
export const estado = Effect.fn("Nocturna.estado")(function* (
  opciones: OpcionesBarrido,
  calendario: Calendario,
) {
  const base = yield* BaseNocturna;
  const barrido = yield* BaseDeBarrido;
  const ahora = yield* Clock.currentTimeMillis;
  // Lo leído desde aquí es de la ronda de ahora.
  const desde = ahora - Duration.toMillis(opciones.reciente);
  const resumen = yield* base.resumen(desde);
  const pendientes = yield* barrido.colaDeFichas("registro-oficial", desde);
  const cola = resumirCola(pendientes, ahora);
  const porZona = pendientesPorZona(pendientes, opciones.zonas, ahora);
  const proxima = proximaEjecucion(calendario, ahora);
  const estadoDeZonas = yield* barrido.estadoDeZonas("registro-oficial");
  const turno: Turno = {
    zonas: [...porZona].map(([zona, fichas]) => ({ zona, fichas })),
    porLeer: cola.nuevas + cola.porReleer,
    proxima: {
      cuando: describirProgramada(calendario, proxima),
      dia: proxima.dia,
      configuradas: opciones.zonas.length,
      zonas: zonasPorBarrer(
        opciones.zonas,
        estadoDeZonas,
        proxima.instante - Duration.toMillis(opciones.reciente),
      ).map((zona) => zona.nombre),
    },
  };
  yield* Console.log(describirResumen(base.fichero, resumen, turno));
  return { resumen, cola, turno };
});
