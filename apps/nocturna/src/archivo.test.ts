// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { archivar, type PaginaDelRegistro } from "@celda/ingesta/archivo";
import { ObservacionGuardada } from "@celda/ingesta/guardado";
import { lecturaDeFicha, VERSION_DE_LECTURA } from "@celda/ingesta/registro-oficial/normalizar";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import { AlmacenDelArchivo, AlmacenNoDisponible } from "@celda/publicacion/almacen";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ArchivoNocturno,
  archivoNocturno,
  copiarArchivo,
  ENTEROS,
  ESQUEMA_DEL_ARCHIVO,
  partir,
  releerArchivo,
  restaurarArchivo,
} from "./archivo.ts";
import {
  comprobarHistorial,
  conBase,
  conEntorno,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";
import { fichasGrabadas, geoportal, latin1 } from "./pruebas/geoportal.ts";

const NOCHE = Date.UTC(2026, 9, 7, 2, 15);
const DIA = 86_400_000;

const decodificarObservacion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ObservacionGuardada),
);

/** Las filas de cada tabla de un archivo, leídas con su propio cliente, para comparar dos. */
const tablasDelArchivo = (fichero: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      contenidos:
        yield* sql`SELECT id, huella, bytes, hex(gzip) AS gzip FROM contenidos ORDER BY id`,
      paginas: yield* sql`SELECT * FROM paginas ORDER BY id`,
      lecturas: yield* sql`SELECT * FROM lecturas ORDER BY id`,
    };
  }).pipe(Effect.provide(SqliteClient.layer({ filename: fichero })));

/**
 * Un R2 de prueba para los paquetes del archivo: los guarda en memoria, apunta cada subida que se
 * le pide y puede no contestar, o caerse tras `cupo` subidas.
 */
const archivoEnR2DePrueba = Effect.gen(function* () {
  const guardados = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map());
  const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
  const caido = yield* Ref.make(false);
  const cupo = yield* Ref.make(Number.POSITIVE_INFINITY);
  const siContesta = <A>(efecto: Effect.Effect<A, AlmacenNoDisponible>) =>
    Effect.andThen(
      Effect.yieldNow,
      Effect.flatMap(Ref.get(caido), (sinRed) =>
        sinRed ? Effect.fail(new AlmacenNoDisponible({ motivo: "R2 no contesta" })) : efecto,
      ),
    );
  const capa = Layer.succeed(
    AlmacenDelArchivo,
    AlmacenDelArchivo.of({
      guardar: (nombre, contenido) =>
        siContesta(
          Effect.gen(function* () {
            yield* Ref.update(pedidas, (p) => [...p, nombre]);
            if ((yield* Ref.getAndUpdate(cupo, (n) => n - 1)) <= 0) {
              return yield* new AlmacenNoDisponible({ motivo: "R2 se ha caído a media subida" });
            }
            yield* Ref.update(guardados, (g) => new Map([...g, [nombre, contenido]]));
          }),
        ),
      listar: siContesta(Effect.map(Ref.get(guardados), (g) => [...g.keys()])),
    }),
  );
  return { capa, guardados: Ref.get(guardados), pedidas: Ref.get(pedidas), caido, cupo };
});

/** Una página de una ficha para archivar a mano. */
const pagina = (url: string, texto: string): PaginaDelRegistro => ({
  tipo: "ficha",
  url,
  clave: `C - ${url}`,
  cuerpo: latin1(texto),
  resultado: "leida",
});

/**
 * Una ficha de `bytes` que no se comprimen, como una ficha del registro ya comprimida, de unos
 * 4,3 KB. Sale siempre igual para el mismo `numero`.
 */
const fichaQueOcupa = (numero: number, bytes = 4300): PaginaDelRegistro => {
  let semilla = numero + 1;
  const cuerpo = Uint8Array.from({ length: bytes }, () => {
    semilla = (semilla * 1_103_515_245 + 12_345) % 2_147_483_648;
    return semilla >>> 16;
  });
  const url =
    "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=" +
    `${String(numero).padStart(7, "0")}&codEmplazamiento=ORANGE%20ESPAGNE%2C%20S.A.U.%20-%20${numero}`;
  return {
    tipo: "ficha",
    url,
    clave: `ORANGE ESPAGNE, S.A.U. - ${numero}`,
    cuerpo,
    resultado: "leida",
  };
};

/** Hace algo con el archivo de un fichero abierto, como en la noche. */
const conArchivo = <A, E, R>(fichero: string, efecto: Effect.Effect<A, E, R>, tamano?: number) =>
  efecto.pipe(Effect.provide(archivoNocturno(fichero, tamano)));

/** Los ficheros de una carpeta que son paquetes, por su nombre. */
const paquetesDe = (carpeta: string) =>
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readDirectory(carpeta)),
    (nombres) => nombres.filter((nombre) => nombre.endsWith(".sqlite")).toSorted(),
  );

/** Lo que ocupa un fichero. */
const tamanoDe = (ruta: string) =>
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.stat(ruta)),
    (info) => Number(info.size),
  );

/** Los paquetes de la carpeta de copias del entorno. */
const paquetesEn = (entorno: Entorno) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = path.join(entorno.copias, "archivo");
    return (yield* fs.exists(carpeta)) ? (yield* fs.readDirectory(carpeta)).toSorted() : [];
  });

describe("archivo de páginas del registro (ADR 0027)", () => {
  it.effect(
    "guarda cada contenido una vez y cada lectura, y cada paquete lleva solo lo nuevo",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const carpeta = path.join(entorno.copias, "archivo");
          yield* TestClock.setTime(NOCHE);
          const primero = yield* conArchivo(
            entorno.archivo,
            Effect.gen(function* () {
              const archivo = yield* ArchivoNocturno;
              // La misma URL lee A, A, B y otra vez A; otra URL lee A.
              for (const texto of ["A", "A", "B", "A"]) {
                yield* archivar(pagina("https://registro/1", texto));
                yield* TestClock.adjust(1000);
              }
              yield* archivar(pagina("https://registro/2", "A"));
              const resumen = yield* archivo.resumen;
              assert.deepStrictEqual(resumen, {
                paginas: 2,
                lecturas: 5,
                contenidos: 2,
                bytes: 2,
                comprimidos: resumen.comprimidos,
              });
              const paquete = yield* archivo.empaquetar(carpeta);
              assert.deepStrictEqual(
                { ...paquete, rutas: paquete?.rutas.map((ruta) => path.basename(ruta)) },
                {
                  rutas: ["archivo-2026-10-07T02-15-04.000Z-001.sqlite"],
                  contenidos: 2,
                  paginas: 2,
                  lecturas: 5,
                },
              );
              // Sin nada nuevo no sale otro paquete.
              assert.isUndefined(yield* archivo.empaquetar(carpeta));
              return paquete;
            }),
          );

          // Otra noche, con el archivo cerrado y abierto otra vez: el paquete lleva solo lo nuevo.
          yield* TestClock.adjust(DIA);
          const segundo = yield* conArchivo(
            entorno.archivo,
            Effect.gen(function* () {
              const archivo = yield* ArchivoNocturno;
              yield* archivar(pagina("https://registro/1", "A"));
              yield* archivar(pagina("https://registro/3", "C"));
              return yield* archivo.empaquetar(carpeta);
            }),
          );
          assert.deepStrictEqual(
            { ...segundo, rutas: segundo?.rutas.map((ruta) => path.basename(ruta)) },
            {
              rutas: ["archivo-2026-10-08T02-15-04.000Z-001.sqlite"],
              contenidos: 1,
              paginas: 1,
              lecturas: 2,
            },
          );

          // Con los dos paquetes se rehace el mismo archivo, y repetirlos no duplica nada.
          const otro = path.join(path.dirname(entorno.archivo), "restaurado.sqlite");
          const restaurados = yield* conArchivo(
            otro,
            Effect.gen(function* () {
              const leidos = yield* restaurarArchivo(carpeta);
              yield* restaurarArchivo(carpeta);
              const archivo = yield* ArchivoNocturno;
              // El restaurado sabe qué paquetes tiene: no vuelve a sacar lo mismo.
              assert.isUndefined(yield* archivo.empaquetar(path.join(carpeta, "otra")));
              return leidos;
            }),
          );
          assert.deepStrictEqual(
            restaurados,
            [...(primero?.rutas ?? []), ...(segundo?.rutas ?? [])].map((ruta) =>
              path.basename(ruta),
            ),
          );
          assert.deepStrictEqual(
            yield* tablasDelArchivo(otro),
            yield* tablasDelArchivo(entorno.archivo),
          );
        }),
      ),
  );

  it.effect("el esquema del archivo lleva su versión, y un paquete de otra no se restaura", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const carpeta = path.join(entorno.copias, "archivo");
        const paquete = yield* conArchivo(
          entorno.archivo,
          Effect.gen(function* () {
            yield* archivar(pagina("https://registro/1", "A"));
            return yield* (yield* ArchivoNocturno).empaquetar(carpeta);
          }),
        );
        const version = (fichero: string) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const [fila] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
            return fila?.user_version;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: fichero })));
        assert.strictEqual(yield* version(entorno.archivo), ESQUEMA_DEL_ARCHIVO.length);
        const ruta = paquete?.rutas[0] ?? "";
        assert.strictEqual(yield* version(ruta), ESQUEMA_DEL_ARCHIVO.length);

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.unsafe(`PRAGMA user_version = ${ESQUEMA_DEL_ARCHIVO.length + 1}`);
        }).pipe(Effect.provide(SqliteClient.layer({ filename: ruta })));
        const fallo = yield* conArchivo(
          path.join(path.dirname(entorno.archivo), "otro.sqlite"),
          Effect.flip(restaurarArchivo(carpeta)),
        );
        assert.strictEqual(fallo._tag, "PaqueteIncompatible");
      }),
    ),
  );

  it.effect(
    "una noche archiva lo que lee del registro, saca su paquete y lo sube a R2; una subida fallida se repite la noche siguiente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const registro = yield* geoportal(fichas);
          const r2 = yield* archivoEnR2DePrueba;
          yield* TestClock.setTime(NOCHE);
          yield* Ref.set(r2.caido, true);
          const primera = yield* unaNoche(entorno, yield* registro.extractor, {
            archivoEnR2: r2.capa,
          });
          assert.strictEqual(primera.publicacion.tipo, "publicada");
          assert.deepStrictEqual(primera.archivo?.enR2, {
            tipo: "fallido",
            motivo: "R2 no contesta",
            paquetes: [],
          });
          const peticiones = (yield* Ref.get(registro.peticiones)).filter(
            (p) => p.ruta !== "/robots.txt",
          );
          const listados = peticiones.filter((p) => p.ruta.includes("infoantenasGeoJSON"));
          // Los 9 cuadros de Cataluña y las 40 fichas.
          assert.lengthOf(listados, 9);
          assert.lengthOf(peticiones, 49);
          assert.deepStrictEqual(
            { ...primera.archivo?.paquetes, rutas: primera.archivo?.paquetes?.rutas.length },
            { rutas: 1, lecturas: 49, paginas: 49, contenidos: 7 },
          );

          // Lo archivado es lo que llegó, byte a byte, con lo que sacó la lectura.
          const archivadas = yield* Effect.gen(function* () {
            const cliente = yield* SqlClient.SqlClient;
            return yield* cliente<{
              readonly clave: string | null;
              readonly resultado: string;
              readonly huella: string;
            }>`SELECT p.clave, l.resultado, c.huella FROM lecturas l
                JOIN paginas p ON p.id = l.pagina JOIN contenidos c ON c.id = l.contenido
                WHERE p.tipo = 'ficha' ORDER BY p.clave`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.archivo })));
          const de = (clave: string) => archivadas.find((a) => a.clave === clave);
          const huella = (bytes: Uint8Array) =>
            Effect.promise(async () =>
              Buffer.from(
                await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
              ).toString("hex"),
            );
          assert.deepStrictEqual(de("TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942"), {
            clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942",
            resultado: "leida",
            huella: yield* huella(grabadas.telefonica),
          });
          assert.strictEqual(de("VODAFONE ESPAÑA, S.A.U. - 079808")?.resultado, "sin-ficha");
          assert.strictEqual(
            de("TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800199")?.resultado,
            "ilegible",
          );
          // Las 36 fichas de Digi son un solo contenido: hay cinco, con Telefónica, Orange, el
          // aviso y la ilegible. Los 8 listados vacíos son otro, y el del Campus Nord, el séptimo.
          assert.strictEqual(new Set(archivadas.map((a) => a.huella)).size, 5);

          // La noche siguiente R2 contesta: sube los dos paquetes, el de ayer y el de hoy.
          yield* Ref.set(r2.caido, false);
          yield* TestClock.adjust(DIA);
          const segunda = yield* unaNoche(entorno, yield* registro.extractor, {
            archivoEnR2: r2.capa,
          });
          const locales = yield* paquetesEn(entorno);
          assert.lengthOf(locales, 2);
          assert.deepStrictEqual(segunda.archivo?.enR2, { tipo: "subido", paquetes: locales });
          // Sin cambios en el registro, la segunda noche solo trae lecturas: las fichas que vuelven
          // a la cola (las que fallaron no, porque esperan) y los listados.
          assert.strictEqual(segunda.archivo?.paquetes?.contenidos, 0);
          assert.strictEqual(segunda.archivo?.paquetes?.paginas, 0);
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          for (const nombre of locales) {
            assert.deepStrictEqual(
              [...((yield* r2.guardados).get(nombre) ?? [])],
              [...(yield* fs.readFile(path.join(entorno.copias, "archivo", nombre)))],
            );
          }
          // Con todo subido, la tercera no sube nada que ya esté.
          yield* TestClock.adjust(DIA);
          const tercera = yield* unaNoche(entorno, yield* registro.extractor, {
            archivoEnR2: r2.capa,
          });
          assert.deepStrictEqual(tercera.archivo?.enR2, {
            tipo: "subido",
            paquetes: (yield* paquetesEn(entorno)).slice(2),
          });
          // Las copias de la base siguen siendo solo las suyas.
          const copias = (yield* fs.readDirectory(entorno.copias)).filter((n) => n !== "archivo");
          assert.isTrue(copias.every((n) => /^ingesta-.+\.sqlite$/u.test(n)));
        }),
      ),
  );

  it.effect(
    "relee las fichas del archivo sin pedir nada al registro y, con aplicar, lleva a la base las que hacen falta",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const registro = yield* geoportal(fichas);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor);
          const pedidas = (yield* Ref.get(registro.peticiones)).length;

          // Las fichas leídas antes de la versión de hoy, como tras subir `VERSION_DE_LECTURA`.
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE observaciones SET ficha_leida_con = ${VERSION_DE_LECTURA - 1}
              WHERE ficha_leida_en IS NOT NULL`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          // Un arreglo de la lectura: la página que no se leía la entiende la de hoy. Se simula
          // archivando como ilegible, más tarde, una página que sí se lee.
          const ilegible =
            "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0800199&codEmplazamiento=TELEFONICA%20MOVILES%20ESPA%C3%91A%2C%20S.A.U.%20-%200800199";
          yield* TestClock.adjust(60_000);
          yield* conArchivo(
            entorno.archivo,
            archivar({
              tipo: "ficha",
              url: ilegible,
              clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800199",
              cuerpo: grabadas.telefonica,
              resultado: "ilegible",
            }),
          );

          const sinAplicar = yield* conBase(
            entorno.base,
            conArchivo(entorno.archivo, releerArchivo(false)),
          );
          assert.deepStrictEqual(
            { ...sinAplicar, ilegibles: sinAplicar.ilegibles.length },
            {
              fichas: 40,
              leidas: 39,
              sinFicha: 1,
              ajenas: 0,
              ilegibles: 0,
              arregladas: 1,
              aplicadas: { aplicada: 0, "al-dia": 0, posterior: 0, "sin-observacion": 0 },
            },
          );

          const aplicada = yield* conBase(
            entorno.base,
            conArchivo(entorno.archivo, releerArchivo(true)),
          );
          // Las 38 leídas con la versión anterior y la que no se leía.
          assert.deepStrictEqual(aplicada.aplicadas, {
            aplicada: 39,
            "al-dia": 0,
            posterior: 0,
            "sin-observacion": 0,
          });
          // Nada se ha pedido al registro.
          assert.strictEqual((yield* Ref.get(registro.peticiones)).length, pedidas);
          const filas = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              readonly clave: string;
              readonly ficha_leida_con: number;
              readonly ficha_fallos: number;
              readonly datos: string;
            }>`SELECT clave, ficha_leida_con, ficha_fallos, datos FROM observaciones
                WHERE ficha_leida_en IS NOT NULL OR ficha_fallos > 0 ORDER BY clave`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          const arreglada = filas.find(
            (f) => f.clave === "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800199",
          );
          assert.strictEqual(arreglada?.ficha_fallos, 0);
          assert.strictEqual(arreglada?.ficha_leida_con, VERSION_DE_LECTURA);
          const guardada = yield* decodificarObservacion(arreglada?.datos ?? "");
          const leida = lecturaDeFicha(decodificarLatin1(grabadas.telefonica));
          assert.deepStrictEqual(
            guardada.bandas,
            leida.resultado === "leida" ? leida.ficha.bandas : [],
          );
          assert.isTrue(
            filas
              .filter((f) => f.clave !== "VODAFONE ESPAÑA, S.A.U. - 079808")
              .every((f) => f.ficha_leida_con === VERSION_DE_LECTURA),
          );
          // Releer otra vez no cambia nada: ya están al día.
          const otraVez = yield* conBase(
            entorno.base,
            conArchivo(entorno.archivo, releerArchivo(true)),
          );
          assert.strictEqual(otraVez.aplicadas["al-dia"], 39);
          assert.strictEqual(otraVez.aplicadas.aplicada, 0);
          // Lo aplicado va también al historial de cada registro (ADR 0027).
          const comprobacion = yield* comprobarHistorial(entorno);
          assert.deepStrictEqual(comprobacion.primeras, []);
        }),
      ),
  );

  it.effect("una ficha releída no pisa una observación que ha cambiado después", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabadas = yield* fichasGrabadas;
        const fichas = yield* Ref.make(grabadas.fichas);
        const registro = yield* geoportal(fichas);
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, yield* registro.extractor);
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE observaciones SET ficha_leida_con = ${VERSION_DE_LECTURA - 1}`;
          // El listado de una cambia después de su ficha: su fecha es posterior.
          yield* sql`UPDATE observaciones
            SET datos = json_set(datos, '$.fecha', ${NOCHE + DIA}, '$.fichaLeidaEn', NULL),
              ficha_leida_en = NULL
            WHERE clave = 'ORANGE ESPAGNE, S.A.U. - CATR0228A'`;
          // Otra está retirada.
          yield* sql`UPDATE observaciones SET retirada_en = ${NOCHE + DIA}
            WHERE clave = 'ORANGE ESPAGNE, S.A.U. - CATR0508Z'`;
        }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
        const releida = yield* conBase(
          entorno.base,
          conArchivo(entorno.archivo, releerArchivo(true)),
        );
        assert.deepStrictEqual(releida.aplicadas, {
          aplicada: 36,
          "al-dia": 0,
          posterior: 1,
          "sin-observacion": 1,
        });
      }),
    ),
  );

  it.effect(
    "si el archivo no se puede abrir o escribir, la noche sigue, publica y lo dice el diario",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const registro = yield* geoportal(fichas);
          yield* TestClock.setTime(NOCHE);
          // Una carpeta donde iría el fichero: SQLite no lo puede abrir.
          yield* fs.makeDirectory(entorno.archivo, { recursive: true });
          const hecha = yield* unaNoche(entorno, yield* registro.extractor);
          assert.strictEqual(hecha.publicacion.tipo, "publicada");
          assert.deepStrictEqual(
            hecha.ejecuciones.map((e) => e.estado),
            ["completada"],
          );
          assert.deepStrictEqual(hecha.archivo, {
            paquetes: undefined,
            enR2: { tipo: "sin-subir" },
          });

          // Un archivo abierto que deja de poder escribir: la lectura sigue sin archivar.
          const otro = `${entorno.archivo}-2`;
          yield* conArchivo(otro, Effect.void);
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DROP TABLE lecturas`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: otro })));
          yield* TestClock.adjust(DIA);
          const otraNoche = yield* unaNoche(entorno, yield* registro.extractor, { archivo: otro });
          assert.notStrictEqual(otraNoche.publicacion.tipo, "fallida");
          assert.deepStrictEqual(
            otraNoche.ejecuciones.map((e) => e.estado),
            ["completada"],
          );
          assert.isUndefined(otraNoche.archivo?.paquetes);
        }),
      ),
  );

  it.effect(
    "saca lo nuevo en paquetes de su tamaño como mucho, cada uno entero, y con ellos se rehace el mismo archivo",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const carpeta = path.join(entorno.copias, "archivo");
          const tamano = 1024 * 1024;
          yield* TestClock.setTime(NOCHE);
          const hechos = yield* conArchivo(
            entorno.archivo,
            Effect.gen(function* () {
              for (let numero = 0; numero < 700; numero++) yield* archivar(fichaQueOcupa(numero));
              // Algunas se leen otra vez sin cambiar, y solo añaden una lectura.
              for (let numero = 0; numero < 50; numero++) yield* archivar(fichaQueOcupa(numero));
              return yield* (yield* ArchivoNocturno).empaquetar(carpeta);
            }),
            tamano,
          );
          assert.deepStrictEqual(
            { ...hechos, rutas: undefined },
            { rutas: undefined, contenidos: 700, paginas: 700, lecturas: 750 },
          );
          const nombres = (hechos?.rutas ?? []).map((ruta) => path.basename(ruta));
          assert.deepStrictEqual(nombres, [
            "archivo-2026-10-07T02-15-00.000Z-001.sqlite",
            "archivo-2026-10-07T02-15-00.000Z-002.sqlite",
            "archivo-2026-10-07T02-15-00.000Z-003.sqlite",
            "archivo-2026-10-07T02-15-00.000Z-004.sqlite",
          ]);
          assert.deepStrictEqual(yield* paquetesDe(carpeta), nombres);
          // Ninguno pasa del tamaño, y todos menos el último lo aprovechan.
          const tamanos = yield* Effect.forEach(hechos?.rutas ?? [], tamanoDe);
          assert.isTrue(
            tamanos.every((bytes) => bytes <= tamano),
            `${tamanos.join(", ")} bytes`,
          );
          assert.isTrue(
            tamanos.slice(0, -1).every((bytes) => bytes >= tamano * 0.8),
            `${tamanos.join(", ")} bytes`,
          );

          // Cada paquete es un archivo entero con su esquema, y con todos se rehace el mismo.
          const otro = path.join(path.dirname(entorno.archivo), "restaurado.sqlite");
          yield* conArchivo(
            otro,
            Effect.gen(function* () {
              const archivo = yield* ArchivoNocturno;
              yield* archivo.restaurar(hechos?.rutas[2] ?? "");
              assert.isAbove((yield* archivo.resumen).contenidos, 0);
              assert.deepStrictEqual(yield* restaurarArchivo(carpeta), nombres);
              // El restaurado sabe qué paquetes tiene y no vuelve a sacar lo mismo.
              assert.isUndefined(yield* archivo.empaquetar(path.join(carpeta, "otra")));
            }),
          );
          assert.deepStrictEqual(
            yield* tablasDelArchivo(otro),
            yield* tablasDelArchivo(entorno.archivo),
          );
        }),
      ),
  );

  it.effect(
    "un paquete de antes que es demasiado grande se parte para subirlo y queda entero aparte; con lo subido se rehace el archivo",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const carpeta = path.join(entorno.copias, "archivo");
          const tamano = 512 * 1024;
          const r2 = yield* archivoEnR2DePrueba;
          // Dos noches de antes de partir los paquetes, con un solo fichero por noche y sin número.
          const deAntes = (desde: number, hasta: number) =>
            Effect.gen(function* () {
              const hechos = yield* conArchivo(
                entorno.archivo,
                Effect.gen(function* () {
                  for (let numero = desde; numero < hasta; numero++) {
                    yield* archivar(fichaQueOcupa(numero));
                  }
                  return yield* (yield* ArchivoNocturno).empaquetar(carpeta);
                }),
                Number.POSITIVE_INFINITY,
              );
              const [ruta = ""] = hechos?.rutas ?? [];
              const nombre = path.basename(ruta).replace(/-001\.sqlite$/u, ".sqlite");
              yield* fs.rename(ruta, path.join(carpeta, nombre));
              return nombre;
            });
          yield* TestClock.setTime(NOCHE);
          const pequeno = yield* deAntes(0, 100);
          yield* TestClock.adjust(DIA);
          const grande = yield* deAntes(100, 500);
          const bytesDelGrande = yield* fs.readFile(path.join(carpeta, grande));
          assert.isAbove(bytesDelGrande.byteLength, 2 * tamano);
          assert.isBelow(yield* tamanoDe(path.join(carpeta, pequeno)), 2 * tamano);

          // La noche de hoy, ya en paquetes, y la subida de todo lo que falta.
          yield* TestClock.adjust(DIA);
          const copia = yield* conArchivo(
            entorno.archivo,
            Effect.gen(function* () {
              for (let numero = 500; numero < 600; numero++) yield* archivar(fichaQueOcupa(numero));
              return yield* copiarArchivo(carpeta);
            }),
            tamano,
          ).pipe(Effect.provide(r2.capa));
          const raiz = grande.replace(/\.sqlite$/u, "-");
          const partes = (yield* paquetesDe(carpeta)).filter((nombre) => nombre.startsWith(raiz));
          assert.isAtLeast(partes.length, 4);
          assert.strictEqual(partes[0], `${raiz}001.sqlite`);
          // El grande no se sube; sí el pequeño, sus partes y los paquetes de hoy, en orden.
          assert.deepStrictEqual(copia?.enR2, {
            tipo: "subido",
            paquetes: [
              pequeno,
              ...partes,
              ...(copia?.paquetes?.rutas ?? []).map((ruta) => path.basename(ruta)),
            ],
          });
          for (const parte of partes) {
            assert.isAtMost(yield* tamanoDe(path.join(carpeta, parte)), tamano);
          }
          // El grande queda entero, igual que estaba, fuera de los paquetes.
          assert.isFalse(yield* fs.exists(path.join(carpeta, grande)));
          assert.deepStrictEqual(
            [...(yield* fs.readFile(path.join(carpeta, ENTEROS, grande)))],
            [...bytesDelGrande],
          );

          // Con lo que hay en R2, el paquete de antes y los partidos, se rehace el mismo archivo.
          const bajados = path.join(path.dirname(entorno.archivo), "bajados");
          yield* fs.makeDirectory(bajados);
          for (const [nombre, contenido] of yield* r2.guardados) {
            yield* fs.writeFile(path.join(bajados, nombre), contenido);
          }
          const otro = path.join(path.dirname(entorno.archivo), "restaurado.sqlite");
          yield* conArchivo(otro, restaurarArchivo(bajados));
          assert.deepStrictEqual(
            yield* tablasDelArchivo(otro),
            yield* tablasDelArchivo(entorno.archivo),
          );
          // Y también con los de la carpeta de copias, donde el grande ya no está.
          const otroMas = path.join(path.dirname(entorno.archivo), "restaurado-2.sqlite");
          yield* conArchivo(otroMas, restaurarArchivo(carpeta));
          assert.deepStrictEqual(
            yield* tablasDelArchivo(otroMas),
            yield* tablasDelArchivo(entorno.archivo),
          );

          // La noche siguiente no hay nada que partir ni que subir.
          const siguiente = yield* conArchivo(entorno.archivo, copiarArchivo(carpeta), tamano).pipe(
            Effect.provide(r2.capa),
          );
          assert.deepStrictEqual(siguiente, {
            paquetes: undefined,
            enR2: { tipo: "subido", paquetes: [] },
          });
        }),
      ),
  );

  it.effect(
    "una subida que se corta deja en R2 los paquetes que llegaron, y la siguiente sube solo los que faltan",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const carpeta = path.join(entorno.copias, "archivo");
          const r2 = yield* archivoEnR2DePrueba;
          yield* TestClock.setTime(NOCHE);
          // R2 deja subir uno y se cae con el segundo, y los demás ya no se intentan.
          yield* Ref.set(r2.cupo, 1);
          const primera = yield* conArchivo(
            entorno.archivo,
            Effect.gen(function* () {
              for (let numero = 0; numero < 300; numero++) yield* archivar(fichaQueOcupa(numero));
              return yield* copiarArchivo(carpeta);
            }),
            512 * 1024,
          ).pipe(Effect.provide(r2.capa));
          const nombres = (primera?.paquetes?.rutas ?? []).map((ruta) => path.basename(ruta));
          assert.isAtLeast(nombres.length, 3);
          assert.deepStrictEqual(primera?.enR2, {
            tipo: "fallido",
            motivo: "R2 se ha caído a media subida",
            paquetes: nombres.slice(0, 1),
          });
          assert.deepStrictEqual(yield* r2.pedidas, nombres.slice(0, 2));

          yield* Ref.set(r2.cupo, Number.POSITIVE_INFINITY);
          yield* TestClock.adjust(DIA);
          const segunda = yield* conArchivo(
            entorno.archivo,
            copiarArchivo(carpeta),
            512 * 1024,
          ).pipe(Effect.provide(r2.capa));
          assert.deepStrictEqual(segunda, {
            paquetes: undefined,
            enR2: { tipo: "subido", paquetes: nombres.slice(1) },
          });
          // El primero no se ha vuelto a subir.
          assert.deepStrictEqual(yield* r2.pedidas, [...nombres.slice(0, 2), ...nombres.slice(1)]);
          assert.deepStrictEqual([...(yield* r2.guardados).keys()].toSorted(), nombres);
        }),
      ),
  );
});

describe("reparto de las filas nuevas en paquetes", () => {
  const filas = {
    contenidos: [
      [1, 40],
      [2, 60],
      [3, 50],
    ],
    paginas: [
      [1, 50],
      [2, 10],
    ],
    lecturas: [
      [7, 30],
      [9, 30],
    ],
  } as const;
  const desde = { contenidos: 0, paginas: 0, lecturas: 6 };
  const hasta = { contenidos: 3, paginas: 2, lecturas: 10 };

  it("llena cada paquete hasta el presupuesto justo y sigue de una tabla a la siguiente", () => {
    assert.deepStrictEqual(partir(filas, desde, hasta, 100), [
      { de: desde, a: { contenidos: 2, paginas: 0, lecturas: 6 } },
      {
        de: { contenidos: 2, paginas: 0, lecturas: 6 },
        a: { contenidos: 3, paginas: 1, lecturas: 6 },
      },
      // El último llega hasta el final, aunque su última fila sea anterior.
      { de: { contenidos: 3, paginas: 1, lecturas: 6 }, a: hasta },
    ]);
  });

  it("con un byte menos de presupuesto, corta antes de la fila que ya no cabe", () => {
    assert.deepStrictEqual(partir(filas, desde, hasta, 99), [
      { de: desde, a: { contenidos: 1, paginas: 0, lecturas: 6 } },
      {
        de: { contenidos: 1, paginas: 0, lecturas: 6 },
        a: { contenidos: 2, paginas: 0, lecturas: 6 },
      },
      {
        de: { contenidos: 2, paginas: 0, lecturas: 6 },
        a: { contenidos: 3, paginas: 0, lecturas: 6 },
      },
      {
        de: { contenidos: 3, paginas: 0, lecturas: 6 },
        a: { contenidos: 3, paginas: 2, lecturas: 7 },
      },
      { de: { contenidos: 3, paginas: 2, lecturas: 7 }, a: hasta },
    ]);
  });

  it("una fila que no cabe en ningún paquete va sola en uno, y si sobra sitio todo va en uno", () => {
    const cero = { contenidos: 0, paginas: 0, lecturas: 0 };
    const final = { contenidos: 1, paginas: 1, lecturas: 0 };
    assert.deepStrictEqual(
      partir({ contenidos: [[1, 500]], paginas: [[1, 5]], lecturas: [] }, cero, final, 100),
      [
        { de: cero, a: { contenidos: 1, paginas: 0, lecturas: 0 } },
        { de: { contenidos: 1, paginas: 0, lecturas: 0 }, a: final },
      ],
    );
    assert.deepStrictEqual(partir(filas, desde, hasta, Number.POSITIVE_INFINITY), [
      { de: desde, a: hasta },
    ]);
  });
});
