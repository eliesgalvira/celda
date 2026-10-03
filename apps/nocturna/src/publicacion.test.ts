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
  leerParteDelIndice,
  leerResumen,
  parteDeClave,
  PARTES_DEL_INDICE,
  type ResumenLeido,
} from "@celda/dominio/provincias";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import {
  DatosPublicables,
  publicar as publicarDatos,
  retirarVersionesViejas,
  VERSIONES_ANTERIORES,
} from "@celda/publicacion/publicar";
import { conCuadros } from "@celda/publicacion/zonas";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { conBase, conEntorno, type Entorno, unaNoche } from "./pruebas/entorno.ts";

/**
 * La publicación compartida (`packages/publicacion`) sobre los datos de la base SQLite de la
 * ingesta nocturna y el almacén en una carpeta temporal: qué escribe, en qué orden, qué reutiliza,
 * cuándo se niega a escribir y qué versiones retira. La noche y cuándo publica se prueban en
 * `programa.test.ts`; aquí la noche solo llena la base y se publica a mano.
 */

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

const ZONAS = conCuadros({
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
});

/** Una noche que lee la fuente grabada y guarda en la base, sin publicar. */
const ingerir = (entorno: Entorno, grabada: FuenteGrabada) =>
  unaNoche(entorno, capaGrabadaPorCajas("registro-oficial", grabada), { sinPublicar: true });

/** Publica a mano lo que hay en la base, en el almacén vigilado del entorno. */
const publicar = (entorno: Entorno) =>
  conBase(
    entorno.base,
    publicarDatos(ZONAS, POR_LOTE).pipe(Effect.provide(entorno.almacenVigilado)),
  );

/** Un fichero del almacén, o `undefined` si no está. */
const leer = (entorno: Entorno, fichero: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs
      .readFileString(path.join(entorno.almacen, fichero))
      .pipe(Effect.orElseSucceed(() => undefined));
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
    const vigente = decodificarVigente((yield* leer(entorno, FICHERO_VIGENTE)) ?? "");
    if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
    const resumen = leerResumen(
      (yield* leer(entorno, vigente.success.resumen ?? "")) ?? "",
      vigente.success.version,
    );
    if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
    const capas = new Map<string, CapaDeProvincia>();
    for (const provincia of resumen.success.provincias) {
      if (provincia.fichero === undefined) continue;
      const capa = leerCapaDeProvincia(
        (yield* leer(entorno, provincia.fichero)) ?? "",
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
    const fichas = leerLoteDeProvincia((yield* leer(entorno, fichero)) ?? "", e.provincia ?? "");
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

/** El índice de claves dice la provincia de cada emplazamiento, en la parte que le toca. */
const comprobarIndice = (entorno: Entorno, leida: Leida) =>
  Effect.gen(function* () {
    const partes = leida.resumen.claves ?? [];
    for (const e of leida.emplazamientos) {
      const parte = partes[parteDeClave(e.clave, partes.length)] ?? "";
      const indice = leerParteDelIndice((yield* leer(entorno, parte)) ?? "");
      assert.strictEqual(Result.getOrUndefined(indice)?.get(e.clave), e.provincia, e.clave);
    }
  });

/**
 * Cada emplazamiento publicado tiene su ficha en su lote, igual que la da la base, con el lugar en
 * que cae y sin ser posterior a la noche de la ingesta.
 */
const comprobarFichas = (entorno: Entorno, leida: Leida) =>
  Effect.gen(function* () {
    const deLaBase = yield* conBase(
      entorno.base,
      Effect.gen(function* () {
        const datos = yield* DatosPublicables;
        return yield* datos.fichas(leida.emplazamientos.map((e) => e.clave));
      }),
    );
    for (const e of leida.emplazamientos) {
      const ficha = (yield* fichasDelLote(entorno, leida, e)).find((f) => f.clave === e.clave);
      const guardada = deLaBase.find((f) => f.clave === e.clave);
      assert.isDefined(guardada, e.clave);
      assert.deepStrictEqual(ficha, guardada && { ...guardada, lugar: lugarEsperado(e) }, e.clave);
      assert.isAtMost(ficha?.version ?? Infinity, NOCHE, e.clave);
    }
  });

/** Las versiones que la base tiene apuntadas como publicadas, con su URL. */
const versionesRegistradas = (entorno: Entorno) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{
      readonly version: string;
      readonly url: string;
    }>`SELECT version, url FROM versiones ORDER BY fecha`;
  }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

/**
 * Una estación de Orange se mueve hacia el norte, por defecto 0,0018° (unos 200 m): cambia un
 * emplazamiento de Barcelona.
 */
const conOrangeMovida = (grabada: FuenteGrabada, grados = 0.0018): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.map((r) =>
      r.clave === "ORANGE ESPAGNE, S.A.U. - CATR0508Z"
        ? { ...r, posicion: { ...r.posicion, latitud: r.posicion.latitud + grados } }
        : r,
    ),
  },
});

describe("publicación de la capa y las fichas (base SQLite, almacén en carpeta)", () => {
  it.effect(
    "publica el resumen, una capa y unos lotes por provincia, y vigente.json el último",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(NOCHE);
          yield* ingerir(entorno, yield* muestraCampusNord);

          yield* TestClock.adjust(60_000);
          const publicada = yield* publicar(entorno);
          const version = "sitios@2026-09-26T02:15:00Z";
          assert.strictEqual(publicada.version, version);
          assert.strictEqual(publicada.tipo, "publicada");
          assert.isAbove(publicada.lotes, 2);

          // Los lotes, las capas y el índice de claves, luego el manifiesto y el resumen, y al
          // final vigente.json: la web no ve la versión hasta tenerlo todo. Las partes del índice
          // que salen iguales (vacías) son un mismo fichero.
          const escritos = yield* entorno.escritos;
          const leida = yield* leerVigente(entorno);
          const partes = leida.resumen.claves ?? [];
          assert.lengthOf(partes, PARTES_DEL_INDICE);
          assert.strictEqual(escritos.length, publicada.lotes + 2 + new Set(partes).size + 3);
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
          // La noche ha barrido Cataluña, y Lleida solo toca cuadros de Cataluña: está cubierta.
          // El recinto de prueba de Barcelona llega por su esquina sureste al cuadro 3,40, el de
          // Menorca, que es de `levante` y no se ha barrido: no está cubierta. Las dos llevan la
          // fecha del barrido de Cataluña.
          assert.deepStrictEqual(
            leida.resumen.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
            [
              ["08", false, NOCHE],
              ["25", true, NOCHE],
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

          yield* comprobarFichas(entorno, leida);

          // El manifiesto lista las capas y los lotes, que no llevan la versión en el nombre.
          const manifiesto = decodificarManifiesto(
            (yield* leer(entorno, ficheroDeManifiesto(version))) ?? "",
          );
          assert.deepStrictEqual(
            Result.getOrUndefined(manifiesto)?.ficheros,
            escritos
              .filter(
                (f) =>
                  f.startsWith("provincias/") || f.startsWith("fichas/") || f.startsWith("claves/"),
              )
              .toSorted(),
          );

          yield* comprobarIndice(entorno, leida);

          assert.deepStrictEqual(yield* versionesRegistradas(entorno), [
            { version, url: `${ORIGEN}/${leida.vigente.resumen ?? ""}` },
          ]);
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
          yield* ingerir(entorno, grabada);
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
          yield* ingerir(entorno, conOrangeMovida(grabada));
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
          assert.isDefined(yield* leer(entorno, leidaAntes.vigente.resumen ?? ""));
          for (const capa of leidaAntes.capas.values()) {
            for (const lote of capa.lotes) assert.isDefined(yield* leer(entorno, lote), lote);
          }
        }),
      ),
  );

  it.effect("no pisa un fichero con otro contenido y no cambia la vigente", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const ocupado = path.join(entorno.almacen, ficheroDeManifiesto(versionDeCapa(NOCHE)));
        yield* fs.makeDirectory(entorno.almacen, { recursive: true });
        yield* fs.writeFileString(ocupado, '{"version":"otra cosa"}');

        yield* TestClock.setTime(NOCHE);
        yield* ingerir(entorno, yield* muestraCampusNord);
        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "FicheroInmutable");
        assert.strictEqual(yield* fs.readFileString(ocupado), '{"version":"otra cosa"}');
        assert.isUndefined(yield* leer(entorno, FICHERO_VIGENTE));
        assert.isFalse(
          (yield* fs.readDirectory(entorno.almacen)).some((f) => f.startsWith("resumen@")),
        );
      }),
    ),
  );

  it.effect("no retrocede si el almacén ya tiene una versión posterior", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        yield* ingerir(entorno, yield* muestraCampusNord);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(entorno.almacen, { recursive: true });
        const posterior = `{"version":"${versionDeCapa(NOCHE + DIA)}","fecha":${NOCHE + DIA},"emplazamientos":1,"lotes":1}`;
        yield* fs.writeFileString(path.join(entorno.almacen, FICHERO_VIGENTE), posterior);

        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "VigentePosterior");
        assert.strictEqual(yield* leer(entorno, FICHERO_VIGENTE), posterior);
        assert.lengthOf(yield* entorno.escritos, 0);
      }),
    ),
  );

  it.effect("una vigente del formato 4 con la misma versión se vuelve a publicar en el 5", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        yield* ingerir(entorno, yield* muestraCampusNord);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(entorno.almacen, { recursive: true });
        const version = versionDeCapa(NOCHE);
        yield* fs.writeFileString(
          path.join(entorno.almacen, FICHERO_VIGENTE),
          `{"version":"${version}","fecha":${NOCHE},"emplazamientos":19,"lotes":3}`,
        );
        yield* fs.writeFileString(path.join(entorno.almacen, `${version}.json`), "{}");

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

  describe("ficha", () => {
    it.effect(
      "trae la dirección, cada compañía con sus bandas ordenadas y de dónde sale cada dato",
      () =>
        conEntorno((entorno) =>
          Effect.gen(function* () {
            yield* TestClock.setTime(NOCHE);
            yield* ingerir(entorno, yield* muestraCampusNord);
            yield* publicar(entorno);
            const leida = yield* leerVigente(entorno);
            const campusNord = leida.emplazamientos.find((e) => e.clave === "movistar-0802532");
            assert.isDefined(campusNord);
            if (campusNord === undefined) return;
            const ficha = (yield* fichasDelLote(entorno, leida, campusNord)).find(
              (f) => f.clave === campusNord.clave,
            );
            assert.isDefined(ficha);
            if (ficha === undefined) return;

            assert.strictEqual(ficha.direccion, "CL JORDI GIRONA, 1. BARCELONA, BARCELONA");
            assert.strictEqual(ficha.municipio, "BARCELONA");
            assert.strictEqual(ficha.estado, "verificado");
            // La marca de agua: la noche que lo escribió.
            assert.strictEqual(ficha.version, NOCHE);
            assert.deepStrictEqual(
              ficha.estaciones.map((e) => [e.compania, e.codigos]),
              [
                ["movistar", ["0802532"]],
                ["orange", ["CATR0228A"]],
                ["vodafone", ["086040", "86040"]],
              ],
            );
            const movistar = ficha.estaciones[0];
            assert.deepStrictEqual(
              movistar?.bandas.map((b) => b.mhz),
              [700, 800, 900, 900, 1800, 2100, 2600, 3500],
            );
            // Cada código tiene su observación, con la fecha en que la fuente empezó a decirlo y
            // el enlace a su ficha en el registro.
            assert.deepStrictEqual(
              ficha.estaciones.map((e) => e.origenes.length),
              [1, 1, 2],
            );
            for (const origen of ficha.estaciones.flatMap((e) => e.origenes)) {
              assert.strictEqual(origen.fuente, "registro-oficial");
              assert.strictEqual(origen.fecha, NOCHE);
              assert.strictEqual(origen.afirma, "presente");
              assert.isTrue(
                origen.url.startsWith("https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?"),
              );
            }
            assert.match(movistar?.origenes[0]?.clave ?? "", / - 0802532$/u);
          }),
        ),
    );

    it.effect("sin emplazamiento con esa clave exacta, no hay ficha", () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fichas = (claves: ReadonlyArray<string>) =>
            conBase(
              entorno.base,
              Effect.gen(function* () {
                const datos = yield* DatosPublicables;
                return yield* datos.fichas(claves);
              }),
            );
          assert.lengthOf(yield* fichas(["movistar-0802532"]), 0);
          yield* TestClock.setTime(NOCHE);
          yield* ingerir(entorno, yield* muestraCampusNord);
          assert.lengthOf(yield* fichas(["movistar-0802532"]), 1);
          // Sin el cero no es la misma clave (ADR 0012).
          assert.lengthOf(yield* fichas(["movistar-802532"]), 0);
        }),
      ),
    );
  });

  describe("retención", () => {
    /** Escribe a mano en el almacén una versión del formato 4, como si se hubiera publicado. */
    const versionEscrita = (entorno: Entorno, fecha: number) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const version = versionDeCapa(fecha);
        yield* fs.makeDirectory(path.join(entorno.almacen, carpetaDeFichas(version)), {
          recursive: true,
        });
        yield* fs.writeFileString(path.join(entorno.almacen, `${version}.json`), "{}");
        for (const lote of [0, 1]) {
          yield* fs.writeFileString(
            path.join(entorno.almacen, `${carpetaDeFichas(version)}/${lote}.json`),
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
            (yield* fs.readDirectory(entorno.almacen)).flatMap((f) => {
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
              path.join(entorno.almacen, FICHERO_VIGENTE),
              contenidoVigente,
            );

            assert.strictEqual(VERSIONES_ANTERIORES, 7);
            const retiradas = yield* retirarVersionesViejas(vigente).pipe(
              Effect.provide(entorno.almacenVigilado),
            );
            assert.sameMembers([...retiradas], viejas.slice(7));
            assert.deepStrictEqual(yield* versionesEnElAlmacen(entorno), [
              aMedias,
              vigente,
              ...viejas.slice(0, 7),
            ]);
            for (const retirada of viejas.slice(7)) {
              assert.isFalse(
                yield* fs.exists(path.join(entorno.almacen, carpetaDeFichas(retirada))),
              );
            }
            for (const guardada of [aMedias, vigente, ...viejas.slice(0, 7)]) {
              assert.isDefined(yield* leer(entorno, `${carpetaDeFichas(guardada)}/1.json`));
            }
            assert.strictEqual(yield* leer(entorno, FICHERO_VIGENTE), contenidoVigente);

            // Otra vez no hay nada que retirar.
            assert.deepStrictEqual(
              yield* retirarVersionesViejas(vigente).pipe(Effect.provide(entorno.almacenVigilado)),
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
            yield* ingerir(entorno, grabada);
            yield* publicar(entorno);
            const primera = yield* leerVigente(entorno);
            // Ocho versiones más, cada una con Orange en otro sitio: Barcelona cambia y Lleida no.
            for (let noche = 1; noche <= 8; noche += 1) {
              yield* TestClock.adjust(DIA);
              yield* ingerir(entorno, conOrangeMovida(grabada, noche * 0.0018));
              yield* publicar(entorno);
            }
            const ultima = yield* leerVigente(entorno);
            assert.deepStrictEqual(yield* versionesEnElAlmacen(entorno), [
              ultima.vigente.version,
              ...Array.from({ length: 7 }, (_, k) => versionDeCapa(NOCHE - (k + 1) * DIA)),
            ]);
            // La primera ya no está, ni su capa de Barcelona; la de Lleida es la misma y sigue.
            assert.isUndefined(yield* leer(entorno, primera.vigente.resumen ?? ""));
            assert.isUndefined(yield* leer(entorno, ficheroDeManifiesto(primera.vigente.version)));
            const barcelona = primera.resumen.provincias.find((p) => p.codigo === "08")?.fichero;
            const lleida = primera.resumen.provincias.find((p) => p.codigo === "25")?.fichero;
            assert.isUndefined(yield* leer(entorno, barcelona ?? ""));
            assert.isDefined(yield* leer(entorno, lleida ?? ""));
            for (const lote of primera.capas.get("25")?.lotes ?? []) {
              assert.isDefined(yield* leer(entorno, lote), lote);
            }
            // Lo que la vigente necesita sigue entero.
            for (const capa of ultima.capas.values()) {
              for (const lote of capa.lotes) assert.isDefined(yield* leer(entorno, lote), lote);
            }
          }),
        ),
      // Nueve noches y nueve publicaciones seguidas: con la máquina cargada pasa de los 5 s.
      60_000,
    );

    it.effect("publicar retira la más vieja cuando la nueva deja ocho anteriores", () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const viejas: Array<string> = [];
          for (let dias = 1; dias <= 8; dias += 1) {
            viejas.push(yield* versionEscrita(entorno, NOCHE - dias * DIA));
          }
          yield* TestClock.setTime(NOCHE);
          yield* ingerir(entorno, yield* muestraCampusNord);
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
