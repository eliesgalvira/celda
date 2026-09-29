// La medida es su propio punto de entrada y monta aquí sus capas, una vez.
// @effect-diagnostics strictEffectProvide:off
import { ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { OPCIONES_ZONAS, type OpcionesBarrido } from "@celda/ingesta/barrido";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import { OPCIONES_FICHAS, Provincias } from "@celda/ingesta/fichas";
import { capaDePuntosGrabada } from "@celda/ingesta/pruebas/antenasmoviles";
import { capaGrabadaPorCajas, type FuenteGrabada } from "@celda/ingesta/pruebas/grabado";
import { OPCIONES_PUNTOS } from "@celda/ingesta/barridoDePuntos";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { baseNocturna } from "../base.ts";
import { COPIAS_CONSERVADAS, REINTENTO_DE_PUBLICACION } from "../configuracion.ts";
import { Extractores, noche, provinciasDe, publicadorEn } from "../programa.ts";
import { espanaSintetica } from "../pruebas/espana.ts";

/**
 * Mide la ingesta nocturna con toda España (#50): una noche entera con la España sintética de
 * `pruebas/espana.ts`, sobre una base SQLite y un almacén en carpeta de verdad, con el programa
 * de la noche y la publicación de verdad. Solo cambia el geoportal, que contesta al momento y sin
 * pausas: el tiempo que sale es el de la máquina, sin las esperas entre peticiones.
 *
 *     pnpm run medir-espana <carpeta> <fase>
 *
 * Cada fase es un proceso, así que la memoria máxima que escribe al final es la suya. Las fases
 * van en este orden sobre la misma carpeta:
 *
 * - `primera`: toda España en una noche, sin fichas. Guarda los unos 70.000 registros y publica
 *   los unos 42.000 emplazamientos por primera vez.
 * - `fichas`: lee todas las fichas en una noche. Deja la base como tras la primera pasada de
 *   fichas, con las bandas de cada estación, y publica todos los lotes otra vez.
 * - `turno`: una noche con la configuración por defecto: una zona que se turna y 5.500 fichas
 *   por releer que traen otras bandas, así que cambia la mayor parte de los lotes.
 */

const FASES = ["primera", "fichas", "turno"] as const;
type Fase = (typeof FASES)[number];

/** Lo que cambia en cada fase: qué zonas se barren, qué fichas se leen y qué bandas traen. */
interface OpcionesDeFase {
  readonly proceso: OpcionesBarrido;
  /** Con 0, las bandas de siempre; con 1, las de la estación siguiente (`desfasar`). */
  readonly desfase: number;
}

const opcionesDe = (fase: Fase): OpcionesDeFase => {
  switch (fase) {
    case "primera":
      return {
        proceso: {
          zonas: { cadaNoche: ZONAS_DE_BARRIDO, enTurno: [], porNoche: 0 },
          fichas: { ...OPCIONES_FICHAS, maximo: 0 },
        },
        desfase: 0,
      };
    case "fichas":
      return {
        proceso: {
          zonas: { cadaNoche: ZONAS_DE_BARRIDO, enTurno: [], porNoche: 0 },
          fichas: OPCIONES_FICHAS,
        },
        desfase: 0,
      };
    case "turno":
      return {
        proceso: {
          zonas: OPCIONES_ZONAS,
          // Todas las leídas vuelven a la cola, como si hubiera pasado el mes de relectura.
          fichas: { ...OPCIONES_FICHAS, relectura: Duration.zero, maximo: 5500 },
        },
        desfase: 1,
      };
  }
};

/** Las fichas con otras bandas: la de la estación siguiente de la misma compañía. */
const desfasar = (espana: FuenteGrabada, desfase: number): FuenteGrabada => {
  if (desfase === 0) return espana;
  const claves = [...espana.fichas.keys()];
  return {
    ...espana,
    fichas: new Map(
      claves.map((clave, i) => [
        clave,
        espana.fichas.get(claves[(i + desfase) % claves.length] ?? clave) ?? [],
      ]),
    ),
  };
};

const megas = (bytes: number) => Math.round(bytes / 1e6);

const medir = Effect.gen(function* () {
  const [carpeta, fase] = process.argv.slice(2);
  const elegida = FASES.find((f) => f === fase);
  if (carpeta === undefined || elegida === undefined) {
    return yield* Effect.die(`Uso: medir-espana <carpeta> ${FASES.join("|")}`);
  }
  const path = yield* Path.Path;
  const raiz = path.resolve(carpeta);
  const almacen = path.join(raiz, "almacen");
  const zonas = yield* zonasDePublicacion;
  const { proceso, desfase } = opcionesDe(elegida);
  const espana = desfasar(yield* espanaSintetica(zonas), desfase);
  const trasGenerar = process.memoryUsage().rss;

  const entorno = Layer.mergeAll(
    publicadorEn(zonas).pipe(
      Layer.provide(almacenEnCarpeta({ carpeta: almacen, origen: "http://capas.prueba" })),
    ),
    Layer.succeed(
      Extractores,
      Extractores.of({
        registroOficial: capaGrabadaPorCajas("registro-oficial", espana),
        antenasMoviles: capaDePuntosGrabada({
          listado: { puntos: [], avisos: [] },
          detalles: new Map(),
        }),
      }),
    ),
    Layer.succeed(Provincias, provinciasDe(zonas.municipios)),
  ).pipe(
    Layer.provideMerge(
      baseNocturna({
        fichero: path.join(raiz, "ingesta.sqlite"),
        interruptores: INTERRUPTOR_POR_DEFECTO,
      }),
    ),
    Layer.provide(NodeServices.layer),
  );

  const inicio = performance.now();
  const hecha = yield* noche({
    proceso,
    puntos: OPCIONES_PUNTOS,
    reintento: REINTENTO_DE_PUBLICACION,
    copias: { carpeta: path.join(raiz, "copias"), conservar: COPIAS_CONSERVADAS },
  }).pipe(Effect.provide(entorno));
  const segundos = (performance.now() - inicio) / 1000;

  const registro = hecha.ejecuciones.find((e) => e.fuente === "registro-oficial");
  const escritos =
    hecha.publicacion.tipo === "fallida" || hecha.publicacion.tipo === "sin-almacen"
      ? hecha.publicacion.tipo
      : `${hecha.publicacion.tipo}, ${hecha.publicacion.emplazamientos} emplazamientos, ` +
        `${hecha.publicacion.lotes} lotes, ${hecha.publicacion.escritos} ficheros escritos`;
  yield* Effect.logInfo(
    [
      `Fase ${elegida}: ${espana.listado.registros.length} registros sintéticos`,
      `Peticiones de listado por zona: ${registro?.zonas.map((z) => `${z.zona} ${z.peticiones}`).join(", ")}`,
      `Publicación: ${escritos}`,
      `La noche, sin las pausas entre peticiones: ${segundos.toFixed(1)} s`,
      `RSS tras generar la España sintética: ${megas(trasGenerar)} MB`,
      // `maxRSS` va en kilobytes.
      `RSS máximo del proceso: ${megas(process.resourceUsage().maxRSS * 1000)} MB`,
    ].join("\n"),
  );
});

NodeRuntime.runMain(medir.pipe(Effect.provide(NodeServices.layer)));
