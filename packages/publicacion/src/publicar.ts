import {
  codificarVigente,
  decodificarVigente,
  type EmplazamientoDeCapa,
  FICHERO_VIGENTE,
  versionDeCapa,
  type Vigente,
} from "@celda/dominio/capa";
import type { ZonaBarrida } from "@celda/dominio/cobertura";
import type { Ficha } from "@celda/dominio/ficha";
import { LICENCIAS } from "@celda/dominio/licencias";
import { EMPLAZAMIENTOS_POR_LOTE, repartirEnLotes } from "@celda/dominio/lotes";
import { municipiosConHabitantes } from "@celda/dominio/municipio";
import {
  cajaDeSituados,
  combinacionesDeSituados,
  companiasDeSituados,
  type DatosDeProvincia,
  decodificarManifiesto,
  ficheroDeCapaDeProvincia,
  ficheroDeIndiceDeClaves,
  ficheroDeLoteDeProvincia,
  ficheroDeManifiesto,
  ficheroDeResumen,
  type FuentesDeZonas,
  generarCapaDeProvincia,
  generarIndiceDeClaves,
  PARTES_DEL_INDICE,
  generarLoteDeProvincia,
  generarManifiesto,
  generarResumen,
  leerResumen,
  type LoteNombrado,
  selloDeVersion,
  situarEmplazamientos,
} from "@celda/dominio/provincias";
import { ficheroDePuntos, generarPuntos } from "@celda/dominio/puntos";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AlmacenDeFicheros, type AlmacenNoDisponible, type FicheroInmutable } from "./almacen.ts";
import { sha256 } from "./almacenes/firma.ts";
import type { ZonasDePublicacion } from "./zonas.ts";

/** Lo que ha hecho una publicación. */
export const Publicada = Schema.Struct({
  version: Schema.String,
  /**
   * - `publicada`: una versión nueva de los datos, con su resumen, sus capas y sus lotes.
   * - `barrido`: la versión ya estaba publicada y solo ha cambiado la cobertura, por ejemplo la
   *   fecha del último barrido. Se escriben el resumen y `vigente.json`.
   * - `al-dia`: el almacén ya tenía todo eso y no se ha escrito nada.
   */
  tipo: Schema.Literals(["publicada", "barrido", "al-dia"]),
  emplazamientos: Schema.Int,
  lotes: Schema.Int,
  /** Ficheros escritos ahora, contando `vigente.json`. Cero si no ha cambiado nada. */
  escritos: Schema.Int,
  /** Tamaño del resumen y de las capas de provincia, y del mayor lote de fichas, sin comprimir. */
  bytesCapa: Schema.Int,
  bytesLoteMayor: Schema.Int,
  /** Suma de los lotes de fichas, sin comprimir. */
  bytesFichas: Schema.Int,
});
export type Publicada = typeof Publicada.Type;

/** Lo que ha pasado al publicar tras una ingesta. Nunca es un fallo: la ingesta ya ha terminado. */
export const ResultadoPublicacion = Schema.Union([
  Publicada,
  /** No hay almacén de ficheros configurado: no se publica nada. */
  Schema.Struct({ tipo: Schema.Literal("sin-almacen") }),
  /** La publicación ha fallado; la próxima la vuelve a intentar. */
  Schema.Struct({ tipo: Schema.Literal("fallida"), motivo: Schema.String }),
]);
export type ResultadoPublicacion = typeof ResultadoPublicacion.Type;

/** Un fichero de una versión publicada, con su huella (SHA-256) y su tamaño sin comprimir. */
export const FicheroPublicado = Schema.Struct({
  fichero: Schema.String,
  huella: Schema.String,
  bytes: Schema.Int,
});
export type FicheroPublicado = typeof FicheroPublicado.Type;

/** Una versión recién publicada: su resumen, dónde está y todos sus ficheros. */
export interface VersionPublicada {
  readonly version: string;
  /** Fecha de la instantánea, en milisegundos. */
  readonly fecha: number;
  /** URL del resumen nacional. */
  readonly url: string;
  readonly emplazamientos: number;
  /** Tamaño del resumen sin comprimir. */
  readonly bytes: number;
  readonly publicadaEn: number;
  /** El resumen, el manifiesto, las capas de provincia y los lotes, sin `vigente.json`. */
  readonly ficheros: ReadonlyArray<FicheroPublicado>;
}

/** La base de la que sale la instantánea no ha respondido o ha respondido algo inesperado. */
export class DatosNoDisponibles extends Schema.TaggedError<DatosNoDisponibles>()(
  "DatosNoDisponibles",
  { motivo: Schema.String },
) {}

/**
 * De dónde saca la publicación lo que publica: la base de la ingesta. La publicación no sabe
 * cómo guarda sus datos; solo le pide la versión de los datos, la instantánea, las fichas y hasta
 * dónde llegan. Es la base SQLite de la ingesta nocturna, o datos sintéticos en las pruebas y en
 * `tools/capas`.
 */
export class DatosPublicables extends Context.Service<
  DatosPublicables,
  {
    /**
     * La fecha de la versión de los datos: la de la última ejecución que cambió o retiró algún
     * emplazamiento. `null` si no hay ninguno.
     */
    readonly version: Effect.Effect<number | null, DatosNoDisponibles>;
    /** Todos los emplazamientos de la instantánea, con lo que guarda la capa de cada uno. */
    readonly emplazamientos: Effect.Effect<ReadonlyArray<EmplazamientoDeCapa>, DatosNoDisponibles>;
    /** Las fichas de unos emplazamientos. Una clave sin emplazamiento no da ficha. */
    readonly fichas: (
      claves: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Ficha>, DatosNoDisponibles>;
    /**
     * Las zonas de barrido del registro oficial que se han empezado a barrer, con la fecha de su
     * último barrido completo (ADR 0014): hasta dónde llegan los datos.
     */
    readonly cobertura: Effect.Effect<ReadonlyArray<ZonaBarrida>, DatosNoDisponibles>;
    /**
     * Las claves de emplazamientos que desaparecieron al juntarse con otro, con la clave del que
     * los sustituye (ADR 0027). El índice de claves las publica para que sus enlaces sigan
     * abriendo una ficha.
     */
    readonly clavesAnteriores: Effect.Effect<ReadonlyMap<string, string>, DatosNoDisponibles>;
    /** Apunta una versión publicada. Registrar otra vez la misma no la duplica. */
    readonly registrar: (publicada: VersionPublicada) => Effect.Effect<void, DatosNoDisponibles>;
  }
>()("@celda/publicacion/publicar/DatosPublicables") {}

/** No hay emplazamientos de los que sacar una capa. */
export class SinEmplazamientos extends Schema.TaggedError<SinEmplazamientos>()(
  "SinEmplazamientos",
  {},
) {}

/** Los datos cambiaron mientras se leía la instantánea; hay que volver a empezar. */
export class InstantaneaMovida extends Schema.TaggedError<InstantaneaMovida>()(
  "InstantaneaMovida",
  { antes: Schema.Finite, despues: Schema.NullOr(Schema.Finite) },
) {}

/**
 * El almacén ya tiene publicada una versión posterior a los datos: otra ingesta publica en el
 * mismo sitio, o se ha restaurado una copia antigua de la base. No se retrocede.
 */
export class VigentePosterior extends Schema.TaggedError<VigentePosterior>()("VigentePosterior", {
  vigente: Schema.String,
  datos: Schema.String,
}) {}

/** `vigente.json` existe pero no se entiende: no se sabe qué hay publicado. */
export class VigenteIlegible extends Schema.TaggedError<VigenteIlegible>()("VigenteIlegible", {
  motivo: Schema.String,
}) {}

export type FalloPublicacion =
  | DatosNoDisponibles
  | FicheroInmutable
  | AlmacenNoDisponible
  | SinEmplazamientos
  | InstantaneaMovida
  | VigentePosterior
  | VigenteIlegible;

/** Lotes que se leen y se escriben a la vez. */
const A_LA_VEZ = 4;

const bytesDe = (texto: string): number => new TextEncoder().encode(texto).length;

/** Lo que dice `vigente.json` del almacén, si existe. */
const vigenteDelAlmacen = Effect.gen(function* () {
  const almacen = yield* AlmacenDeFicheros;
  const contenido = yield* almacen.leer(FICHERO_VIGENTE);
  if (Option.isNone(contenido)) return Option.none<Vigente>();
  const leido = decodificarVigente(contenido.value);
  if (Result.isFailure(leido)) {
    return yield* new VigenteIlegible({ motivo: leido.failure.message });
  }
  return Option.some(leido.success);
});

/**
 * Cuántas versiones anteriores a la vigente se quedan en el almacén (issue #14). Una pestaña que
 * lleva días abierta sigue leyendo las capas y las fichas de su versión; si ya no están, lee las
 * de la vigente y lo dice (ADR 0004).
 */
export const VERSIONES_ANTERIORES = 7;

/**
 * El sello de la versión de un fichero que es de una sola versión (`2026-09-26T02:15:03Z`): su
 * resumen y su manifiesto, y la capa y los lotes del formato 4. Las capas de provincia y sus lotes
 * no llevan versión: las comparten las versiones que los listan en su manifiesto.
 */
const selloDe = (fichero: string): string | undefined =>
  /^(?:sitios|fichas|resumen|ficheros)@(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)(?:\.[0-9a-f]+)?(?:\.json|\/\d+\.json)$/u.exec(
    fichero,
  )?.[1];

/** Lo que abre una versión en la web: su resumen o, en el formato 4, su capa. */
const esEntrada = (fichero: string): boolean =>
  fichero.startsWith("resumen@") || fichero.startsWith("sitios@");

/** Los ficheros que lista el manifiesto de una versión, o `undefined` si no se puede leer. */
const listadosEn = (fichero: string) =>
  Effect.gen(function* () {
    const almacen = yield* AlmacenDeFicheros;
    const contenido = yield* almacen.leer(fichero);
    if (Option.isNone(contenido)) return [];
    const leido = decodificarManifiesto(contenido.value);
    return Result.isSuccess(leido) ? leido.success.ficheros : undefined;
  });

/**
 * Borra del almacén las versiones que sobran: se quedan la vigente, las `VERSIONES_ANTERIORES`
 * anteriores y cualquier versión posterior a la vigente, que puede ser otra publicación a medias.
 * De cada versión retirada se borra primero lo que la abre (su resumen, o su capa en el formato
 * 4), para que nadie empiece a leerla; luego las capas de provincia y los lotes de su manifiesto
 * que ninguna versión que se queda lista, sus lotes del formato 4 y, al final, el manifiesto. Si
 * el manifiesto de alguna versión que se queda no se entiende, no se borra ninguna capa ni ningún
 * lote compartido. Devuelve las versiones retiradas.
 */
export const retirarVersionesViejas = Effect.fn("Publicacion.retirarVersionesViejas")(function* (
  vigente: string,
) {
  const almacen = yield* AlmacenDeFicheros;
  const sello = selloDeVersion(vigente);
  const ficheros = yield* almacen.listar;
  const sellos = [...new Set(ficheros.flatMap((f) => selloDe(f) ?? []))];
  const anteriores = sellos.filter((s) => s < sello).sort((a, b) => (a < b ? 1 : -1));
  const viejas = new Set(anteriores.slice(VERSIONES_ANTERIORES));
  if (viejas.size === 0) return [];
  const deViejas = ficheros.filter((f) => viejas.has(selloDe(f) ?? ""));
  const manifiestos = deViejas.filter((f) => f.startsWith("ficheros@"));
  yield* Effect.forEach(deViejas.filter(esEntrada), almacen.borrar, {
    concurrency: A_LA_VEZ,
    discard: true,
  });

  const quedan = yield* Effect.forEach(
    sellos.filter((s) => !viejas.has(s)),
    (s) => listadosEn(`ficheros@${s}.json`),
    { concurrency: A_LA_VEZ },
  );
  if (quedan.every((lista) => lista !== undefined)) {
    const enUso = new Set(quedan.flat());
    const deRetiradas = yield* Effect.forEach(manifiestos, listadosEn, { concurrency: A_LA_VEZ });
    const sobran = [...new Set(deRetiradas.flatMap((lista) => lista ?? []))].filter(
      (f) => !enUso.has(f),
    );
    yield* Effect.forEach(sobran, almacen.borrar, { concurrency: A_LA_VEZ, discard: true });
  } else {
    yield* Effect.logWarning(
      "Un manifiesto no se entiende: no se borran capas ni lotes compartidos",
    );
  }
  yield* Effect.forEach(
    deViejas.filter((f) => !esEntrada(f) && !f.startsWith("ficheros@")),
    almacen.borrar,
    { concurrency: A_LA_VEZ, discard: true },
  );
  yield* Effect.forEach(manifiestos, almacen.borrar, { concurrency: A_LA_VEZ, discard: true });
  return [...viejas].map((s) => `sitios@${s}`);
});

/**
 * La retirada tras publicar. Si falla, la publicación sigue siendo buena: se apunta en el
 * registro y la siguiente lo vuelve a intentar.
 */
const retirarTrasPublicar = (vigente: string) =>
  retirarVersionesViejas(vigente).pipe(
    Effect.tap((retiradas) =>
      retiradas.length === 0
        ? Effect.void
        : Effect.logInfo(`Versiones retiradas del almacén: ${retiradas.join(", ")}`),
    ),
    Effect.catch((fallo) =>
      Effect.logWarning(`No se han podido retirar las versiones viejas: ${fallo.motivo}`),
    ),
  );

/** Un fichero generado, con su huella y su tamaño. */
const ficheroPublicado = (fichero: string, contenido: string) =>
  Effect.map(huellaDe(contenido), (huella): FicheroPublicado => ({
    fichero,
    huella,
    bytes: bytesDe(contenido),
  }));

// Web Crypto no falla con un texto: si lo hace, es un defecto del entorno.
const huellaDe = (contenido: string) => Effect.orDie(sha256(contenido));

/** El resumen de una versión, nombrado por su contenido. */
const resumenNombrado = (
  resumen: Omit<Parameters<typeof generarResumen>[0], "cuadros">,
  zonas: ZonasDePublicacion,
) =>
  Effect.gen(function* () {
    const contenido = generarResumen({ ...resumen, cuadros: zonas.cuadros });
    const fichero = ficheroDeResumen(resumen.version, yield* huellaDe(contenido));
    return { fichero, contenido };
  });

/** Las fuentes de las zonas, que el resumen cita. */
const fuentesDe = (zonas: ZonasDePublicacion): FuentesDeZonas => ({
  barrios: zonas.barrios.fuente,
  municipios: zonas.municipios.fuente,
  padron: zonas.padron.fuente,
  capitales: zonas.capitales.fuente,
});

/**
 * Publica la instantánea actual en el formato 8 (ADR 0016 y 0028): el resumen nacional, una capa
 * por provincia, las fichas en lotes dentro de cada provincia y los puntos de toda España, y
 * después `vigente.json` apuntando al resumen.
 *
 * 1. Lee la versión de los datos y la cobertura. Si `vigente.json` ya apunta a esa versión, rehace
 *    su resumen con la cobertura de ahora sin leer la instantánea: si sale el mismo fichero, no
 *    escribe nada (`al-dia`); si no, escribe el resumen nuevo y `vigente.json` (`barrido`).
 * 2. Lee todos los emplazamientos, comprueba que la versión no se ha movido y los sitúa en su
 *    municipio y su provincia.
 * 3. En cada provincia, reparte sus emplazamientos en lotes por la curva de Hilbert, lee las
 *    fichas de cada lote, les pone su lugar y guarda el lote con su huella en el nombre. Si falta
 *    alguna ficha, los datos han cambiado.
 * 4. Guarda la capa de cada provincia, que dice el lote de cada emplazamiento, también con su
 *    huella en el nombre. Una provincia sin cambios da los mismos ficheros, que ya están: no se
 *    vuelven a escribir. Guarda también las partes del índice de claves, que dicen la provincia de
 *    cada emplazamiento para abrir un enlace que no la lleva, y los puntos de toda España, que
 *    dibujan la vista de puntos (ADR 0028).
 * 5. Vuelve a comprobar la versión, guarda el manifiesto y el resumen, y registra la versión.
 * 6. Cambia `vigente.json`, salvo que otra publicación haya dejado ya una versión posterior.
 * 7. Retira las versiones que sobran (`retirarVersionesViejas`), también si estaba al día.
 *
 * Ningún fichero se pisa con otro contenido, y la web no ve la versión nueva hasta el paso 6,
 * cuando todo lo que necesita ya está en el almacén. Repetirla sin cambios no escribe nada.
 */
export const publicar = Effect.fn("Publicacion.publicar")(function* (
  zonas: ZonasDePublicacion,
  porLote: number = EMPLAZAMIENTOS_POR_LOTE,
) {
  const datos = yield* DatosPublicables;
  const almacen = yield* AlmacenDeFicheros;

  const fecha = yield* datos.version;
  if (fecha === null) {
    return yield* new SinEmplazamientos();
  }
  const version = versionDeCapa(fecha);
  const cobertura = yield* datos.cobertura;
  const previa = yield* vigenteDelAlmacen;
  if (Option.isSome(previa)) {
    if (previa.value.version === version) {
      const soloCobertura = yield* rehacerCobertura(previa.value, cobertura, zonas);
      if (soloCobertura !== undefined) {
        yield* retirarTrasPublicar(version);
        return soloCobertura;
      }
    }
    if (previa.value.fecha > fecha) {
      return yield* new VigentePosterior({ vigente: previa.value.version, datos: version });
    }
  }

  const emplazamientos = yield* datos.emplazamientos;
  const comprobarVersion = Effect.gen(function* () {
    const ahora = yield* datos.version;
    if (ahora !== fecha) {
      return yield* new InstantaneaMovida({ antes: fecha, despues: ahora });
    }
  });
  yield* comprobarVersion;

  const situados = situarEmplazamientos(emplazamientos, zonas.municipios);
  const yaEstan = new Set(yield* almacen.listar);
  const escritos = yield* Ref.make(0);
  const guardar = (fichero: string, contenido: string) =>
    Effect.tap(almacen.guardar(fichero, contenido), (nuevo) =>
      nuevo ? Ref.update(escritos, (n) => n + 1) : Effect.void,
    );
  /** Un fichero con nombre por contenido que ya está en el almacén no se vuelve a escribir. */
  const guardarSiFalta = (fichero: string, contenido: string) =>
    yaEstan.has(fichero) ? Effect.void : Effect.asVoid(guardar(fichero, contenido));

  const repartos = [...situados].flatMap(([provincia, suyos]) =>
    repartirEnLotes(
      suyos.map((s) => s.emplazamiento),
      porLote,
    ).map((claves) => ({ provincia, claves })),
  );
  const lugares = new Map(
    [...situados.values()].flat().map((s) => [s.emplazamiento.clave, s.lugar] as const),
  );
  const lotes = yield* Effect.forEach(
    repartos,
    ({ provincia, claves }) =>
      Effect.gen(function* () {
        const fichas = yield* datos.fichas(claves);
        if (fichas.length !== claves.length) {
          return yield* new InstantaneaMovida({ antes: fecha, despues: null });
        }
        const contenido = generarLoteDeProvincia(
          provincia,
          fichas,
          lugares,
          zonas.municipios.fuente,
        );
        const fichero = ficheroDeLoteDeProvincia(provincia, yield* huellaDe(contenido));
        yield* guardarSiFalta(fichero, contenido);
        return { provincia, claves, publicado: yield* ficheroPublicado(fichero, contenido) };
      }),
    { concurrency: A_LA_VEZ },
  );

  const municipios = municipiosConHabitantes(zonas.municipios, zonas.padron, zonas.capitales);
  const capas = yield* Effect.forEach([...situados], ([provincia, suyos]) =>
    Effect.gen(function* () {
      const suyosLotes: ReadonlyArray<LoteNombrado> = lotes
        .filter((l) => l.provincia === provincia)
        .map((l) => ({ fichero: l.publicado.fichero, claves: l.claves }));
      const contenido = generarCapaDeProvincia({
        provincia,
        situados: suyos,
        barrios: zonas.barrios,
        municipios: municipios.filter((m) => m.provincia === provincia),
        lotes: suyosLotes,
      });
      const fichero = ficheroDeCapaDeProvincia(provincia, yield* huellaDe(contenido));
      yield* guardarSiFalta(fichero, contenido);
      return { provincia, publicado: yield* ficheroPublicado(fichero, contenido) };
    }),
  );
  const anteriores = yield* datos.clavesAnteriores;
  const indice = yield* Effect.forEach(
    generarIndiceDeClaves(situados, PARTES_DEL_INDICE, anteriores),
    (contenido) =>
      Effect.gen(function* () {
        const fichero = ficheroDeIndiceDeClaves(yield* huellaDe(contenido));
        yield* guardarSiFalta(fichero, contenido);
        return yield* ficheroPublicado(fichero, contenido);
      }),
  );
  const contenidoPuntos = generarPuntos(situados);
  const ficheroPuntos = ficheroDePuntos(yield* huellaDe(contenidoPuntos));
  yield* guardarSiFalta(ficheroPuntos, contenidoPuntos);
  const puntos = yield* ficheroPublicado(ficheroPuntos, contenidoPuntos);
  yield* comprobarVersion;

  const ficheroDe = new Map(capas.map((c) => [c.provincia, c.publicado.fichero]));
  const provincias = [...zonas.municipios.provincias.values()].map((p): DatosDeProvincia => {
    const suyos = situados.get(p.codigo) ?? [];
    return {
      codigo: p.codigo,
      nombre: p.nombre,
      etiqueta: p.etiqueta,
      caja: cajaDeSituados(suyos),
      emplazamientos: suyos.length,
      companias: companiasDeSituados(suyos),
      fichero: ficheroDe.get(p.codigo),
      combinaciones: combinacionesDeSituados(suyos),
    };
  });
  const compartidos = [
    ...capas.map((c) => c.publicado),
    ...lotes.map((l) => l.publicado),
    ...indice,
    puntos,
  ];
  const manifiesto = generarManifiesto(
    version,
    compartidos.map((f) => f.fichero),
  );
  const ficheroManifiesto = ficheroDeManifiesto(version);
  yield* guardar(ficheroManifiesto, manifiesto);
  const resumen = yield* resumenNombrado(
    {
      version,
      fuentes: fuentesDe(zonas),
      cobertura,
      provincias,
      claves: indice.map((parte) => parte.fichero),
      puntos: puntos.fichero,
    },
    zonas,
  );
  yield* guardar(resumen.fichero, resumen.contenido);
  const publicadoResumen = yield* ficheroPublicado(resumen.fichero, resumen.contenido);
  yield* datos.registrar({
    version,
    fecha,
    url: almacen.url(resumen.fichero),
    emplazamientos: emplazamientos.length,
    bytes: publicadoResumen.bytes,
    publicadaEn: yield* Clock.currentTimeMillis,
    ficheros: [
      publicadoResumen,
      yield* ficheroPublicado(ficheroManifiesto, manifiesto),
      ...compartidos,
    ],
  });

  // Otra publicación puede haber terminado mientras tanto: solo se avanza, nunca se retrocede.
  const antes = yield* vigenteDelAlmacen;
  if (
    Option.isNone(antes) ||
    antes.value.fecha < fecha ||
    (antes.value.fecha === fecha && antes.value.resumen !== resumen.fichero)
  ) {
    yield* almacen.cambiarVigente(
      codificarVigente({
        version,
        fecha,
        emplazamientos: emplazamientos.length,
        lotes: lotes.length,
        resumen: resumen.fichero,
        licencias: LICENCIAS,
      }),
    );
    yield* Ref.update(escritos, (n) => n + 1);
  }
  // La vigente es esta o una posterior que ha dejado otra publicación.
  yield* retirarTrasPublicar(
    Option.isSome(antes) && antes.value.fecha > fecha ? antes.value.version : version,
  );

  return {
    version,
    tipo: "publicada",
    emplazamientos: emplazamientos.length,
    lotes: lotes.length,
    escritos: yield* Ref.get(escritos),
    bytesCapa: publicadoResumen.bytes + capas.reduce((suma, c) => suma + c.publicado.bytes, 0),
    bytesLoteMayor: Math.max(0, ...lotes.map((l) => l.publicado.bytes)),
    bytesFichas: lotes.reduce((suma, l) => suma + l.publicado.bytes, 0),
  } satisfies Publicada;
});

/**
 * Con `vigente.json` ya en la versión de los datos, rehace su resumen con la cobertura de ahora,
 * sin leer la instantánea. Si sale el mismo, no escribe nada; si no, escribe el nuevo resumen y
 * `vigente.json`. `undefined` si la vigente no tiene un resumen legible: entonces hay que
 * publicarla entera. Las capas y los lotes salen iguales y no se vuelven a escribir; cambian el
 * resumen y `vigente.json`.
 */
const rehacerCobertura = Effect.fn("Publicacion.rehacerCobertura")(function* (
  vigente: Vigente,
  cobertura: ReadonlyArray<ZonaBarrida>,
  zonas: ZonasDePublicacion,
) {
  const almacen = yield* AlmacenDeFicheros;
  const contenido = yield* almacen.leer(vigente.resumen);
  if (Option.isNone(contenido)) return undefined;
  const leido = leerResumen(contenido.value, vigente.version);
  if (Result.isFailure(leido)) return undefined;
  const resumen = yield* resumenNombrado(
    {
      version: vigente.version,
      fuentes: leido.success.fuentes,
      cobertura,
      provincias: leido.success.provincias,
      claves: leido.success.claves,
      puntos: leido.success.puntos,
    },
    zonas,
  );
  const igual = resumen.fichero === vigente.resumen;
  if (!igual) {
    yield* almacen.guardar(resumen.fichero, resumen.contenido);
    yield* almacen.cambiarVigente(
      codificarVigente({ ...vigente, resumen: resumen.fichero, licencias: LICENCIAS }),
    );
  }
  const publicada: Publicada = {
    version: vigente.version,
    tipo: igual ? "al-dia" : "barrido",
    emplazamientos: vigente.emplazamientos,
    lotes: vigente.lotes,
    escritos: igual ? 0 : 2,
    bytesCapa: igual ? 0 : bytesDe(resumen.contenido),
    bytesLoteMayor: 0,
    bytesFichas: 0,
  };
  return publicada;
});

/** Texto de un fallo de la publicación para el registro. */
export const describirFallo = (fallo: FalloPublicacion): string => {
  switch (fallo._tag) {
    case "DatosNoDisponibles":
      return `la base no responde: ${fallo.motivo}`;
    case "FicheroInmutable":
      return `${fallo.fichero} ya existe con otro contenido`;
    case "AlmacenNoDisponible":
      return `el almacén no responde: ${fallo.motivo}`;
    case "SinEmplazamientos":
      return "no hay emplazamientos";
    case "InstantaneaMovida":
      return "los datos han cambiado mientras se publicaba";
    case "VigentePosterior":
      return `el almacén ya tiene ${fallo.vigente}, posterior a ${fallo.datos}`;
    case "VigenteIlegible":
      return `vigente.json no se entiende: ${fallo.motivo}`;
  }
};

/**
 * Publica, y convierte un fallo en un resultado que lo cuenta. Una publicación fallida no deshace
 * la ingesta, y la siguiente la repite.
 */
export const publicarYContar = (zonas: ZonasDePublicacion, porLote?: number) =>
  publicar(zonas, porLote).pipe(
    Effect.catch((fallo) =>
      Effect.succeed<ResultadoPublicacion>({ tipo: "fallida", motivo: describirFallo(fallo) }),
    ),
  );
