// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import {
  carpetaDeFichas,
  decodificarVigente,
  type EmplazamientoLeido,
  FICHERO_VIGENTE,
  type Vigente,
  versionDeCapa,
} from "@celda/dominio/capa";
import { indexarMunicipios, type LimitesDeMunicipios } from "@celda/dominio/municipio";
import {
  type CapaDeProvincia,
  decodificarManifiesto,
  ficheroDeManifiesto,
  leerCapaDeProvincia,
  leerLoteDeProvincia,
  leerResumen,
  type ResumenLeido,
} from "@celda/dominio/provincias";
import { capaDePuntosGrabada, muestraAntenasMoviles } from "@celda/ingesta/pruebas/antenasmoviles";
import { capaGrabada, type FuenteGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { retirarVersionesViejas, VERSIONES_ANTERIORES } from "@celda/publicacion/publicar";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import refs from "../confect/_generated/refs";
import {
  Publicacion,
  publicacionDirecta,
  publicar as publicarInstantanea,
} from "../src/publicacion";
import { convexEnMemoria, ejecutar, ejecutarDePuntos } from "./ayudas";
import * as TestConfect from "./TestConfect";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;
const ORIGEN = "http://capas.prueba";
/** Lotes pequeños, para que la muestra del Campus Nord ocupe varios. */
const POR_LOTE = 4;

/** Un barrio que recoge la mitad oeste de la muestra del Campus Nord, al oeste de 2,115°. */
const LIMITES: LimitesDeBarrios = {
  fuente: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
    fecha: "2024-11-12",
  },
  barrios: [
    {
      codigo: "21",
      nombre: "Pedralbes",
      etiqueta: { longitud: 2.1, latitud: 41.39 },
      poligonos: [
        [
          [
            [2, 41],
            [2.115, 41],
            [2.115, 42],
            [2, 42],
          ],
        ],
      ],
    },
  ],
};

/** Un vértice en cien milésimas de grado, como en los arcos de los límites de municipios. */
const v = (grados: number) => Math.round(grados * 100_000);

/**
 * Dos municipios que parten la muestra por el mismo meridiano que el barrio: al oeste, uno de
 * Lleida, inventado para tener dos provincias; al este, Barcelona. El arco 0 es el límite que
 * comparten. Tarragona no tiene ningún recinto ni ningún emplazamiento.
 */
const MUNICIPIOS: LimitesDeMunicipios = {
  fuente: {
    atribucion: "Instituto Geográfico Nacional",
    producto: "Base de Datos de Límites Jurisdiccionales de España",
    licencia: "CC BY 4.0",
    enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
    fecha: "2026-08-10",
    huella: "sha256:prueba",
  },
  toleranciaMetros: 50,
  unidadesPorGrado: 100_000,
  provincias: [
    { codigo: "08", nombre: "Barcelona", etiqueta: { longitud: 2.5, latitud: 41.5 } },
    { codigo: "25", nombre: "Lleida", etiqueta: { longitud: 2.05, latitud: 41.5 } },
    { codigo: "43", nombre: "Tarragona", etiqueta: { longitud: 1, latitud: 41 } },
  ],
  territorios: [
    {
      codigo: "08019",
      tipo: "municipio",
      nombre: "Barcelona",
      provincia: "08",
      etiqueta: { longitud: 2.5, latitud: 41.5 },
      areaKm2: 101,
      poligonos: [[[~0, 2]]],
    },
    {
      codigo: "25001",
      tipo: "municipio",
      nombre: "Oeste",
      provincia: "25",
      etiqueta: { longitud: 2.05, latitud: 41.5 },
      areaKm2: 12,
      poligonos: [[[0, 1]]],
    },
  ],
  arcos: [
    [v(2.115), v(41), 0, v(1)],
    [v(2.115), v(42), -v(0.115), 0, 0, -v(1), v(0.115), 0],
    [v(2.115), v(41), v(0.885), 0, 0, v(1), -v(0.885), 0],
  ],
};
const ZONAS = {
  barrios: LIMITES,
  municipios: indexarMunicipios(MUNICIPIOS),
  padron: {
    fuente: {
      atribucion: "INE",
      licencia: "CC BY 4.0",
      enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
      referencia: "2025-01-01",
      publicada: "2025-12-11",
    },
    municipios: [{ codigo: "08019", habitantes: 1_702_547 }],
  },
};

interface Escrituras {
  /** Ficheros escritos de nuevo, en orden, con `vigente.json` cada vez que cambia. */
  readonly escritos: ReadonlyArray<string>;
}

/**
 * El almacén en una carpeta temporal, como el de desarrollo, apuntando cada fichero que escribe.
 * Así se comprueba desde fuera que publicar sin cambios no escribe nada.
 */
const almacenVigilado = (carpeta: string, registro: Ref.Ref<Escrituras>) =>
  Layer.effect(
    AlmacenDeFicheros,
    Effect.map(AlmacenDeFicheros, (almacen) =>
      AlmacenDeFicheros.of({
        ...almacen,
        guardar: (fichero, contenido) =>
          Effect.tap(almacen.guardar(fichero, contenido), (nuevo) =>
            nuevo
              ? Ref.update(registro, (r) => ({ escritos: [...r.escritos, fichero] }))
              : Effect.void,
          ),
        cambiarVigente: (contenido) =>
          Effect.tap(almacen.cambiarVigente(contenido), () =>
            Ref.update(registro, (r) => ({ escritos: [...r.escritos, FICHERO_VIGENTE] })),
          ),
      }),
    ),
  ).pipe(Layer.provide(almacenEnCarpeta({ carpeta, origen: ORIGEN })));

interface Entorno {
  readonly carpeta: string;
  readonly almacen: Layer.Layer<AlmacenDeFicheros>;
  /** Lo escrito desde el principio de la prueba. */
  readonly escritos: Effect.Effect<ReadonlyArray<string>>;
  /** Lee un fichero del almacén, o `undefined` si no está. */
  readonly leer: (fichero: string) => Effect.Effect<string | undefined>;
}

/** Un Convex en memoria y un almacén en una carpeta temporal nuevos para cada prueba. */
const conEntorno = <A, E, R>(prueba: (entorno: Entorno) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = path.join(yield* fs.makeTempDirectoryScoped(), "almacen");
    const registro = yield* Ref.make<Escrituras>({ escritos: [] });
    return yield* prueba({
      carpeta,
      almacen: almacenVigilado(carpeta, registro).pipe(Layer.provide(NodeServices.layer)),
      escritos: Effect.map(Ref.get(registro), (r) => r.escritos),
      leer: (fichero) =>
        fs.readFileString(path.join(carpeta, fichero)).pipe(Effect.orElseSucceed(() => undefined)),
    });
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(TestConfect.layer, NodeServices.layer)));

/** Publica a mano, con el Convex en memoria y el almacén de la prueba. */
const publicar = (entorno: Entorno) =>
  Effect.gen(function* () {
    return yield* publicarInstantanea(ZONAS, POR_LOTE).pipe(
      Effect.provide(Layer.merge(entorno.almacen, yield* convexEnMemoria)),
    );
  });

/** La publicación automática tras la ingesta, como la monta la acción, contando sus llamadas. */
const publicacionContada = (entorno: Entorno, llamadas: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const directa = yield* Effect.service(Publicacion).pipe(
      Effect.provide(
        publicacionDirecta(ZONAS, POR_LOTE).pipe(
          Layer.provide(Layer.merge(entorno.almacen, yield* convexEnMemoria)),
        ),
      ),
    );
    return Layer.succeed(
      Publicacion,
      Publicacion.of({
        publicar: Effect.andThen(
          Ref.update(llamadas, (n) => n + 1),
          directa.publicar,
        ),
      }),
    );
  });

/** Lo que la web leería del almacén: la vigente, su resumen y la capa de cada provincia. */
interface Leida {
  readonly vigente: Vigente;
  readonly resumen: ResumenLeido;
  readonly capas: ReadonlyMap<string, CapaDeProvincia>;
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
}

/** Lee la versión vigente como la leería la web, y falla la prueba si algo no se entiende. */
const leerVigente = (entorno: Entorno) =>
  Effect.gen(function* () {
    const vigente = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
    if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
    const resumen = leerResumen(
      (yield* entorno.leer(vigente.success.resumen ?? "")) ?? "",
      vigente.success.version,
    );
    if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
    const capas = new Map<string, CapaDeProvincia>();
    for (const provincia of resumen.success.provincias) {
      if (provincia.fichero === undefined) continue;
      const capa = leerCapaDeProvincia(
        (yield* entorno.leer(provincia.fichero)) ?? "",
        provincia.codigo,
      );
      if (Result.isFailure(capa)) return assert.fail(capa.failure.message);
      capas.set(provincia.codigo, capa.success);
    }
    const leida: Leida = {
      vigente: vigente.success,
      resumen: resumen.success,
      capas,
      emplazamientos: [...capas.values()].flatMap((c) => c.emplazamientos),
    };
    return leida;
  });

/** Las fichas del lote de un emplazamiento leído. */
const fichasDelLote = (entorno: Entorno, leida: Leida, e: EmplazamientoLeido) =>
  Effect.gen(function* () {
    const capa = leida.capas.get(e.provincia ?? "");
    const fichero = capa?.lotes[e.lote ?? -1] ?? "";
    const fichas = leerLoteDeProvincia((yield* entorno.leer(fichero)) ?? "", e.provincia ?? "");
    if (Result.isFailure(fichas)) return assert.fail(`${e.clave}: ${fichas.failure.message}`);
    return fichas.success;
  });

/** El lugar que tiene que llevar la ficha de un emplazamiento de la muestra. */
const lugarEsperado = (e: EmplazamientoLeido) =>
  e.posicion.longitud < 2.115
    ? {
        municipio: { codigo: "25001", nombre: "Oeste" },
        provincia: { codigo: "25", nombre: "Lleida" },
        fuente: MUNICIPIOS.fuente,
      }
    : {
        municipio: { codigo: "08019", nombre: "Barcelona" },
        provincia: { codigo: "08", nombre: "Barcelona" },
        fuente: MUNICIPIOS.fuente,
      };

/**
 * Cada emplazamiento publicado tiene su ficha en su lote, igual que la da Convex, con el lugar en
 * que cae y sin ser posterior a la noche de la ingesta.
 */
const comprobarFichas = (entorno: Entorno, leida: Leida) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    for (const e of leida.emplazamientos) {
      const ficha = (yield* fichasDelLote(entorno, leida, e)).find((f) => f.clave === e.clave);
      const deConvex = yield* convex.query(refs.internal.datos.ficha, { clave: e.clave });
      assert.deepStrictEqual(
        Option.some(ficha),
        Option.map(deConvex, (f) => ({ ...f, lugar: lugarEsperado(e) })),
        e.clave,
      );
      assert.isAtMost(ficha?.version ?? Infinity, NOCHE, e.clave);
    }
  });

/** Una estación de Orange se mueve 200 m: cambia un emplazamiento y sale otra versión. */
const conOrangeMovida = (grabada: FuenteGrabada): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.map((r) =>
      r.clave === "ORANGE ESPAGNE, S.A.U. - CATR0508Z"
        ? { ...r, posicion: { ...r.posicion, latitud: r.posicion.latitud + 0.0018 } }
        : r,
    ),
  },
});

describe("publicación de la capa y las fichas (Convex en memoria, almacén en carpeta)", () => {
  it.effect(
    "publica el resumen, una capa y unos lotes por provincia, y vigente.json el último",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          yield* TestClock.setTime(NOCHE);
          yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));

          yield* TestClock.adjust(60_000);
          const publicada = yield* publicar(entorno);
          const version = "sitios@2026-09-26T02:15:00Z";
          assert.strictEqual(publicada.version, version);
          assert.strictEqual(publicada.tipo, "publicada");
          assert.isAbove(publicada.lotes, 2);

          // Los lotes y las capas, luego el manifiesto y el resumen, y al final vigente.json: la
          // web no ve la versión hasta tenerlo todo.
          const escritos = yield* entorno.escritos;
          const leida = yield* leerVigente(entorno);
          assert.strictEqual(escritos.length, publicada.lotes + 2 + 3);
          assert.strictEqual(escritos.at(-3), ficheroDeManifiesto(version));
          assert.strictEqual(escritos.at(-2), leida.vigente.resumen);
          assert.strictEqual(escritos.at(-1), FICHERO_VIGENTE);
          assert.strictEqual(publicada.escritos, escritos.length);
          assert.deepStrictEqual(
            { ...leida.vigente, resumen: undefined },
            {
              version,
              fecha: NOCHE,
              emplazamientos: publicada.emplazamientos,
              lotes: publicada.lotes,
              resumen: undefined,
            },
          );

          // Una fila por provincia; Tarragona no tiene ninguno y no tiene capa.
          assert.deepStrictEqual(
            leida.resumen.provincias.map((p) => [
              p.codigo,
              p.emplazamientos,
              p.fichero !== undefined,
            ]),
            [
              ["08", leida.capas.get("08")?.emplazamientos.length, true],
              ["25", leida.capas.get("25")?.emplazamientos.length, true],
              ["43", 0, false],
            ],
          );
          // La caja del extractor no barre entera ninguna provincia: ninguna está cubierta, pero
          // Barcelona y Lleida tienen la fecha del barrido de esa caja.
          assert.deepStrictEqual(
            leida.resumen.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
            [
              ["08", false, NOCHE],
              ["25", false, NOCHE],
              ["43", false, null],
            ],
          );
          assert.lengthOf(leida.emplazamientos, publicada.emplazamientos);
          const campusNord = leida.emplazamientos.find((e) => e.clave === "movistar-0802532");
          assert.deepStrictEqual(campusNord?.companias, ["movistar", "vodafone", "orange"]);
          assert.deepStrictEqual(
            campusNord?.bandas?.find((b) => b.compania === "movistar")?.mhz,
            [700, 800, 900, 1800, 2100, 2600, 3500],
          );
          for (const e of leida.emplazamientos) {
            const oeste = e.posicion.longitud < 2.115;
            assert.strictEqual(e.barrio, oeste ? "21" : null, e.clave);
            assert.strictEqual(e.provincia, oeste ? "25" : "08", e.clave);
            assert.strictEqual(e.municipio, oeste ? "25001" : "08019", e.clave);
          }
          // La tabla de municipios dice cuántos tiene cada uno y sus habitantes.
          const barcelona = leida.capas.get("08")?.municipios.find((m) => m.codigo === "08019");
          assert.strictEqual(barcelona?.habitantes, 1_702_547);
          assert.strictEqual(
            barcelona?.emplazamientos,
            leida.capas.get("08")?.emplazamientos.length,
          );

          // Cada emplazamiento tiene su ficha en su lote, igual que la da Convex y con el
          // municipio y la provincia en que cae.
          yield* comprobarFichas(entorno, leida);

          // El manifiesto lista las capas y los lotes, que no llevan la versión en el nombre.
          const manifiesto = decodificarManifiesto(
            (yield* entorno.leer(ficheroDeManifiesto(version))) ?? "",
          );
          assert.deepStrictEqual(
            Result.getOrUndefined(manifiesto)?.ficheros,
            escritos
              .filter((f) => f.startsWith("provincias/") || f.startsWith("fichas/"))
              .toSorted(),
          );

          const registrada = yield* convex.query(refs.internal.capas.vigente);
          assert.deepStrictEqual(
            Option.map(registrada, (r) => [r.version, r.url]),
            Option.some([version, `${ORIGEN}/${leida.vigente.resumen ?? ""}`]),
          );
        }),
      ),
  );

  it.effect(
    "sin cambios no escribe nada; con cambios en una provincia, la otra reutiliza su capa y sus lotes",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* ejecutar(capaGrabada("registro-oficial", grabada));
          const primera = yield* publicar(entorno);
          const antes = yield* entorno.escritos;
          const leidaAntes = yield* leerVigente(entorno);

          const repetida = yield* publicar(entorno);
          assert.strictEqual(repetida.tipo, "al-dia");
          assert.strictEqual(repetida.version, primera.version);
          assert.strictEqual(repetida.escritos, 0);
          assert.deepStrictEqual(yield* entorno.escritos, antes);

          // Orange se mueve dentro de Barcelona: Lleida no cambia.
          yield* TestClock.adjust(DIA);
          yield* ejecutar(capaGrabada("registro-oficial", conOrangeMovida(grabada)));
          const segunda = yield* publicar(entorno);
          assert.strictEqual(segunda.version, versionDeCapa(NOCHE + DIA));
          assert.strictEqual(segunda.tipo, "publicada");
          const leida = yield* leerVigente(entorno);
          const nuevos = (yield* entorno.escritos).slice(antes.length);
          assert.isFalse(
            nuevos.some((f) => f.startsWith("provincias/25/") || f.startsWith("fichas/25/")),
          );
          assert.isTrue(nuevos.some((f) => f.startsWith("provincias/08/")));
          assert.strictEqual(
            leida.resumen.provincias.find((p) => p.codigo === "25")?.fichero,
            leidaAntes.resumen.provincias.find((p) => p.codigo === "25")?.fichero,
          );
          assert.deepStrictEqual(leida.capas.get("25")?.lotes, leidaAntes.capas.get("25")?.lotes);
          assert.notStrictEqual(
            leida.resumen.provincias.find((p) => p.codigo === "08")?.fichero,
            leidaAntes.resumen.provincias.find((p) => p.codigo === "08")?.fichero,
          );
          // La versión anterior sigue entera: las pestañas abiertas con ella pueden seguir leyendo.
          assert.isDefined(yield* entorno.leer(leidaAntes.vigente.resumen ?? ""));
          for (const capa of leidaAntes.capas.values()) {
            for (const lote of capa.lotes) assert.isDefined(yield* entorno.leer(lote), lote);
          }
        }),
      ),
  );

  it.effect(
    "se publica sola tras cada ingesta completada; un barrido sin cambios solo rehace el resumen",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          const grabada = yield* muestraCampusNord;
          const llamadas = yield* Ref.make(0);
          const publicacion = yield* publicacionContada(entorno, llamadas);
          const registro = capaGrabada("registro-oficial", grabada);
          yield* TestClock.setTime(NOCHE);

          yield* ejecutar(registro, undefined, publicacion);
          assert.strictEqual(yield* Ref.get(llamadas), 1);
          const primera = yield* leerVigente(entorno);
          assert.strictEqual(primera.vigente.version, versionDeCapa(NOCHE));
          const tras = (yield* entorno.escritos).length;

          // La noche siguiente la fuente dice lo mismo: la versión de los datos es la misma, pero
          // el barrido es de hoy. Solo se escriben un resumen nuevo y vigente.json.
          yield* TestClock.adjust(DIA);
          const igual = yield* ejecutar(registro, undefined, publicacion);
          assert.strictEqual(igual.estado, "completada");
          assert.strictEqual(yield* Ref.get(llamadas), 2);
          const nuevos = (yield* entorno.escritos).slice(tras);
          const segunda = yield* leerVigente(entorno);
          assert.deepStrictEqual(nuevos, [segunda.vigente.resumen, FICHERO_VIGENTE]);
          assert.strictEqual(segunda.vigente.version, versionDeCapa(NOCHE));
          assert.strictEqual(segunda.resumen.provincias[0]?.barrido, NOCHE + DIA);
          assert.deepStrictEqual(
            segunda.resumen.provincias.map((p) => p.fichero),
            primera.resumen.provincias.map((p) => p.fichero),
          );

          // Con el interruptor apagado la ejecución queda omitida y no publica.
          yield* convex.mutation(refs.internal.ingesta.cambiarInterruptor, {
            fuente: "registro-oficial",
            activo: false,
            motivo: "prueba",
          });
          yield* TestClock.adjust(DIA);
          const omitida = yield* ejecutar(registro, undefined, publicacion);
          assert.strictEqual(omitida.estado, "omitida");
          assert.strictEqual(yield* Ref.get(llamadas), 2);

          // Con cambios, la ejecución siguiente publica la versión nueva.
          yield* convex.mutation(refs.internal.ingesta.cambiarInterruptor, {
            fuente: "registro-oficial",
            activo: true,
            motivo: "prueba",
          });
          yield* ejecutar(
            capaGrabada("registro-oficial", conOrangeMovida(grabada)),
            undefined,
            publicacion,
          );
          const nueva = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
          assert.strictEqual(Result.getOrUndefined(nueva)?.version, versionDeCapa(NOCHE + 2 * DIA));
        }),
      ),
  );

  it.effect("tras la ingesta de la comunidad publica sus estados en una versión nueva", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const llamadas = yield* Ref.make(0);
        const publicacion = yield* publicacionContada(entorno, llamadas);
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(
          capaGrabada("registro-oficial", yield* muestraCampusNord),
          undefined,
          publicacion,
        );
        yield* convex.mutation(refs.internal.ingesta.cambiarInterruptor, {
          fuente: "antenasmoviles",
          activo: true,
          motivo: "prueba",
        });
        yield* TestClock.adjust(3_600_000);
        yield* ejecutarDePuntos(
          capaDePuntosGrabada(yield* muestraAntenasMoviles),
          undefined,
          publicacion,
        );
        assert.strictEqual(yield* Ref.get(llamadas), 2);

        const leida = yield* leerVigente(entorno);
        assert.strictEqual(leida.vigente.version, "sitios@2026-09-26T03:15:00Z");
        const estadoDe = (clave: string) =>
          leida.emplazamientos.find((e) => e.clave === clave)?.estado;
        assert.strictEqual(estadoDe("movistar-0802532"), "corregido");
        assert.strictEqual(estadoDe("movistar-MV-BCN-82383"), "nuevo");
        assert.strictEqual(estadoDe("orange-CATR0508Z"), "verificado");

        // La ficha del corregido sale en su lote con el mismo estado que el marcador.
        const corregido = leida.emplazamientos.find((e) => e.clave === "movistar-0802532");
        if (corregido === undefined) return assert.fail("falta el corregido");
        const fichas = yield* fichasDelLote(entorno, leida, corregido);
        assert.strictEqual(fichas.find((f) => f.clave === "movistar-0802532")?.estado, "corregido");
      }),
    ),
  );

  it.effect("no pisa un fichero con otro contenido, no cambia la vigente y la ingesta acaba", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const llamadas = yield* Ref.make(0);
        const publicacion = yield* publicacionContada(entorno, llamadas);
        const version = versionDeCapa(NOCHE);
        const ocupado = path.join(entorno.carpeta, ficheroDeManifiesto(version));
        yield* fs.makeDirectory(entorno.carpeta, { recursive: true });
        yield* fs.writeFileString(ocupado, '{"version":"otra cosa"}');

        yield* TestClock.setTime(NOCHE);
        const ejecucion = yield* ejecutar(
          capaGrabada("registro-oficial", yield* muestraCampusNord),
          undefined,
          publicacion,
        );
        assert.strictEqual(ejecucion.estado, "completada");
        assert.strictEqual(yield* Ref.get(llamadas), 1);
        assert.strictEqual(yield* fs.readFileString(ocupado), '{"version":"otra cosa"}');
        assert.isUndefined(yield* entorno.leer(FICHERO_VIGENTE));
        assert.isFalse(
          (yield* fs.readDirectory(entorno.carpeta)).some((f) => f.startsWith("resumen@")),
        );

        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "FicheroInmutable");
      }),
    ),
  );

  it.effect("no retrocede si el almacén ya tiene una versión posterior", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(entorno.carpeta, { recursive: true });
        const posterior = `{"version":"${versionDeCapa(NOCHE + DIA)}","fecha":${NOCHE + DIA},"emplazamientos":1,"lotes":1}`;
        yield* fs.writeFileString(path.join(entorno.carpeta, FICHERO_VIGENTE), posterior);

        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "VigentePosterior");
        assert.strictEqual(yield* entorno.leer(FICHERO_VIGENTE), posterior);
        assert.lengthOf(yield* entorno.escritos, 0);
      }),
    ),
  );

  it.effect("una vigente del formato 4 con la misma versión se vuelve a publicar en el 5", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(entorno.carpeta, { recursive: true });
        const version = versionDeCapa(NOCHE);
        yield* fs.writeFileString(
          path.join(entorno.carpeta, FICHERO_VIGENTE),
          `{"version":"${version}","fecha":${NOCHE},"emplazamientos":19,"lotes":3}`,
        );
        yield* fs.writeFileString(path.join(entorno.carpeta, `${version}.json`), "{}");

        const publicada = yield* publicar(entorno);
        assert.strictEqual(publicada.tipo, "publicada");
        const leida = yield* leerVigente(entorno);
        assert.strictEqual(leida.vigente.version, version);
        assert.isAbove(leida.emplazamientos.length, 0);
      }),
    ),
  );

  it.effect("sin emplazamientos no hay nada que publicar", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "SinEmplazamientos");
        assert.lengthOf(yield* entorno.escritos, 0);
      }),
    ),
  );

  describe("retención", () => {
    /** Escribe a mano en el almacén una versión del formato 4, como si se hubiera publicado. */
    const versionEscrita = (entorno: Entorno, fecha: number) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const version = versionDeCapa(fecha);
        yield* fs.makeDirectory(path.join(entorno.carpeta, carpetaDeFichas(version)), {
          recursive: true,
        });
        yield* fs.writeFileString(path.join(entorno.carpeta, `${version}.json`), "{}");
        for (const lote of [0, 1]) {
          yield* fs.writeFileString(
            path.join(entorno.carpeta, `${carpetaDeFichas(version)}/${lote}.json`),
            "{}",
          );
        }
        return version;
      });

    /** Las versiones con algo que las abre en el almacén, de la más nueva a la más vieja. */
    const versionesEnElAlmacen = (entorno: Entorno) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return [
          ...new Set(
            (yield* fs.readDirectory(entorno.carpeta)).flatMap((f) => {
              const sello = /^(?:sitios|resumen)@([^.]+Z)/u.exec(f)?.[1];
              return sello === undefined ? [] : [`sitios@${sello}`];
            }),
          ),
        ]
          .sort()
          .toReversed();
      });

    it.effect(
      "deja la vigente, sus 7 anteriores y las posteriores, y borra el resto con sus lotes",
      () =>
        conEntorno((entorno) =>
          Effect.gen(function* () {
            const viejas: Array<string> = [];
            for (let dias = 1; dias <= 10; dias += 1) {
              viejas.push(yield* versionEscrita(entorno, NOCHE - dias * DIA));
            }
            const vigente = yield* versionEscrita(entorno, NOCHE);
            // Otra publicación a medias, que aún no ha cambiado vigente.json.
            const aMedias = yield* versionEscrita(entorno, NOCHE + DIA);
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const contenidoVigente = `{"version":"${vigente}","fecha":${NOCHE},"emplazamientos":1,"lotes":2}`;
            yield* fs.writeFileString(
              path.join(entorno.carpeta, FICHERO_VIGENTE),
              contenidoVigente,
            );

            assert.strictEqual(VERSIONES_ANTERIORES, 7);
            const retiradas = yield* retirarVersionesViejas(vigente).pipe(
              Effect.provide(entorno.almacen),
            );
            assert.sameMembers([...retiradas], viejas.slice(7));
            assert.deepStrictEqual(yield* versionesEnElAlmacen(entorno), [
              aMedias,
              vigente,
              ...viejas.slice(0, 7),
            ]);
            for (const retirada of viejas.slice(7)) {
              assert.isFalse(
                yield* fs.exists(path.join(entorno.carpeta, carpetaDeFichas(retirada))),
              );
            }
            for (const guardada of [aMedias, vigente, ...viejas.slice(0, 7)]) {
              assert.isDefined(yield* entorno.leer(`${carpetaDeFichas(guardada)}/1.json`));
            }
            assert.strictEqual(yield* entorno.leer(FICHERO_VIGENTE), contenidoVigente);

            // Otra vez no hay nada que retirar.
            assert.deepStrictEqual(
              yield* retirarVersionesViejas(vigente).pipe(Effect.provide(entorno.almacen)),
              [],
            );
          }),
        ),
    );

    it.effect(
      "al retirar una versión del formato 5 solo borra las capas y los lotes que nadie más usa",
      () =>
        conEntorno((entorno) =>
          Effect.gen(function* () {
            const grabada = yield* muestraCampusNord;
            yield* TestClock.setTime(NOCHE - 8 * DIA);
            yield* ejecutar(capaGrabada("registro-oficial", grabada));
            yield* publicar(entorno);
            const primera = yield* leerVigente(entorno);
            // Ocho versiones más, cada una con Orange en otro sitio: Barcelona cambia y Lleida no.
            for (let noche = 1; noche <= 8; noche += 1) {
              yield* TestClock.adjust(DIA);
              const movida: FuenteGrabada = {
                ...grabada,
                listado: {
                  ...grabada.listado,
                  registros: grabada.listado.registros.map((r) =>
                    r.clave === "ORANGE ESPAGNE, S.A.U. - CATR0508Z"
                      ? {
                          ...r,
                          posicion: { ...r.posicion, latitud: r.posicion.latitud + noche * 0.0018 },
                        }
                      : r,
                  ),
                },
              };
              yield* ejecutar(capaGrabada("registro-oficial", movida));
              yield* publicar(entorno);
            }
            const ultima = yield* leerVigente(entorno);
            assert.deepStrictEqual(yield* versionesEnElAlmacen(entorno), [
              ultima.vigente.version,
              ...Array.from({ length: 7 }, (_, k) => versionDeCapa(NOCHE - (k + 1) * DIA)),
            ]);
            // La primera ya no está, ni su capa de Barcelona; la de Lleida es la misma y sigue.
            assert.isUndefined(yield* entorno.leer(primera.vigente.resumen ?? ""));
            assert.isUndefined(yield* entorno.leer(ficheroDeManifiesto(primera.vigente.version)));
            const barcelona = primera.resumen.provincias.find((p) => p.codigo === "08")?.fichero;
            const lleida = primera.resumen.provincias.find((p) => p.codigo === "25")?.fichero;
            assert.isUndefined(yield* entorno.leer(barcelona ?? ""));
            assert.isDefined(yield* entorno.leer(lleida ?? ""));
            for (const lote of primera.capas.get("25")?.lotes ?? []) {
              assert.isDefined(yield* entorno.leer(lote), lote);
            }
            // Lo que la vigente necesita sigue entero.
            for (const capa of ultima.capas.values()) {
              for (const lote of capa.lotes) assert.isDefined(yield* entorno.leer(lote), lote);
            }
          }),
        ),
    );

    it.effect("publicar retira la más vieja cuando la nueva deja ocho anteriores", () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const viejas: Array<string> = [];
          for (let dias = 1; dias <= 8; dias += 1) {
            viejas.push(yield* versionEscrita(entorno, NOCHE - dias * DIA));
          }
          yield* TestClock.setTime(NOCHE);
          yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));
          const publicada = yield* publicar(entorno);
          assert.strictEqual(publicada.tipo, "publicada");
          assert.deepStrictEqual(yield* versionesEnElAlmacen(entorno), [
            publicada.version,
            ...viejas.slice(0, 7),
          ]);

          // Al día, tampoco borra nada más.
          assert.strictEqual((yield* publicar(entorno)).tipo, "al-dia");
          assert.lengthOf(yield* versionesEnElAlmacen(entorno), 8);
        }),
      ),
    );
  });
});
