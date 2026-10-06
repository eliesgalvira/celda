// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { archivar, type PaginaDelRegistro } from "@celda/ingesta/archivo";
import { ObservacionGuardada } from "@celda/ingesta/guardado";
import { leerMuestra } from "@celda/ingesta/pruebas/grabado";
import { clienteDePrueba, NO_HAY_ROBOTS, type Peticion } from "@celda/ingesta/pruebas/http";
import { capaPorCajas, OPCIONES } from "@celda/ingesta/registro-oficial/extractor";
import { lecturaDeFicha, VERSION_DE_LECTURA } from "@celda/ingesta/registro-oficial/normalizar";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import { AlmacenDelArchivo, AlmacenNoDisponible } from "@celda/publicacion/almacen";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
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
  ESQUEMA_DEL_ARCHIVO,
  releerArchivo,
  restaurarArchivo,
} from "./archivo.ts";
import { conBase, conEntorno, type Entorno, unaNoche } from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 9, 7, 2, 15);
const DIA = 86_400_000;

/** Bytes en ISO-8859-1, como los manda el geoportal. */
const latin1 = (texto: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(texto, (caracter) => caracter.charCodeAt(0));

const ElementoGrabado = Schema.Struct({
  id: Schema.String,
  geometry: Schema.Struct({ coordinates: Schema.Tuple([Schema.Finite, Schema.Finite]) }),
});
const decodificarListado = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ features: Schema.Array(Schema.Unknown) })),
);
const decodificarElemento = Schema.decodeUnknownEffect(ElementoGrabado);
const decodificarObservacion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ObservacionGuardada),
);

/** Lo que contesta el geoportal de prueba a cada ficha, por su código. */
type Fichas = (codigo: string) => Uint8Array<ArrayBuffer>;

/**
 * El geoportal con el listado grabado en el Campus Nord, que contesta cada caja con los elementos
 * que caen en ella, y cada ficha con lo que diga `fichas`. Apunta cada petición.
 */
const geoportal = (fichas: Ref.Ref<Fichas>) =>
  Effect.gen(function* () {
    const grabado = yield* decodificarListado(
      decodificarLatin1(yield* leerMuestra("geojson-campus-nord.iso-8859-1.json")),
    );
    const elementos = yield* Effect.forEach(grabado.features, (crudo) =>
      Effect.map(decodificarElemento(crudo), (e) => ({
        crudo,
        longitud: e.geometry.coordinates[0],
        latitud: e.geometry.coordinates[1],
      })),
    );
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    return {
      peticiones,
      /** El extractor real sobre ese geoportal, sin pausas, para que el reloj no tenga que andar. */
      extractor: Effect.map(Ref.get(fichas), (deFicha) =>
        capaPorCajas(
          { ...OPCIONES, pausa: Duration.zero },
          { ...OPCIONES, pausa: Duration.zero, maxPeticiones: 1000 },
        ).pipe(
          Layer.provide(
            clienteDePrueba(peticiones, (url) => {
              if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
              if (url.pathname === "/VCTEL/detalleEstacion.do") {
                return {
                  estado: 200,
                  cuerpo: deFicha(url.searchParams.get("emplazamiento") ?? ""),
                };
              }
              const [oeste = 0, sur = 0, este = 0, norte = 0] = (url.searchParams.get("bbox") ?? "")
                .split(",")
                .map(Number);
              const dentro = elementos
                .filter(
                  (e) =>
                    e.longitud >= oeste &&
                    e.longitud <= este &&
                    e.latitud >= sur &&
                    e.latitud <= norte,
                )
                .map((e) => e.crudo);
              return {
                estado: 200,
                cuerpo: latin1(dentro.length === 0 ? "{}" : JSON.stringify({ features: dentro })),
              };
            }),
          ),
        ),
      ),
    };
  });

/** Las fichas grabadas: tres en HTML, el aviso de código no válido y una que no se puede leer. */
const fichasGrabadas = Effect.gen(function* () {
  const muestra = (nombre: string) => Effect.map(leerMuestra(nombre), (b) => new Uint8Array(b));
  const telefonica = yield* muestra("detalle-telefonica-0800942.iso-8859-1.html");
  const orange = yield* muestra("detalle-orange-CATR0228A.iso-8859-1.html");
  const digi = yield* muestra("detalle-digi-0800143.iso-8859-1.html");
  const sinFicha = yield* muestra("detalle-codigo-no-valido.iso-8859-1.html");
  const ilegible = latin1('<table class="tablaDetalleEstacion"><tr><td>Obras</td></tr>');
  const fichas: Fichas = (codigo) => {
    switch (codigo) {
      case "0800942":
        return telefonica;
      case "CATR0228A":
        return orange;
      case "079808":
        return sinFicha;
      case "0800199":
        return ilegible;
      default:
        return digi;
    }
  };
  return { fichas, telefonica, orange, digi, sinFicha, ilegible };
});

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

/** Un R2 de prueba para los paquetes del archivo: los guarda en memoria y puede no contestar. */
const archivoEnR2DePrueba = Effect.gen(function* () {
  const guardados = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map());
  const caido = yield* Ref.make(false);
  const siContesta = <A>(efecto: Effect.Effect<A>) =>
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
        siContesta(Ref.update(guardados, (g) => new Map([...g, [nombre, contenido]]))),
      listar: siContesta(Effect.map(Ref.get(guardados), (g) => [...g.keys()])),
    }),
  );
  return { capa, guardados: Ref.get(guardados), caido };
});

/** Una página de una ficha para archivar a mano. */
const pagina = (url: string, texto: string): PaginaDelRegistro => ({
  tipo: "ficha",
  url,
  clave: `C - ${url}`,
  cuerpo: latin1(texto),
  resultado: "leida",
});

/** Hace algo con el archivo de un fichero abierto, como en la noche. */
const conArchivo = <A, E, R>(fichero: string, efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(archivoNocturno(fichero)));

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
                { ...paquete, ruta: path.basename(paquete?.ruta ?? "") },
                {
                  ruta: "archivo-2026-10-07T02-15-04.000Z.sqlite",
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
            { ...segundo, ruta: path.basename(segundo?.ruta ?? "") },
            {
              ruta: "archivo-2026-10-08T02-15-04.000Z.sqlite",
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
          assert.deepStrictEqual(restaurados, [
            path.basename(primero?.ruta ?? ""),
            path.basename(segundo?.ruta ?? ""),
          ]);
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
        assert.strictEqual(yield* version(paquete?.ruta ?? ""), ESQUEMA_DEL_ARCHIVO.length);

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.unsafe(`PRAGMA user_version = ${ESQUEMA_DEL_ARCHIVO.length + 1}`);
        }).pipe(Effect.provide(SqliteClient.layer({ filename: paquete?.ruta ?? "" })));
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
          });
          const peticiones = (yield* Ref.get(registro.peticiones)).filter(
            (p) => p.ruta !== "/robots.txt",
          );
          const listados = peticiones.filter((p) => p.ruta.includes("infoantenasGeoJSON"));
          // Los 9 cuadros de Cataluña y las 40 fichas.
          assert.lengthOf(listados, 9);
          assert.lengthOf(peticiones, 49);
          assert.deepStrictEqual(
            { ...primera.archivo?.paquete, ruta: undefined },
            { ruta: undefined, lecturas: 49, paginas: 49, contenidos: 7 },
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
          assert.strictEqual(segunda.archivo?.paquete?.contenidos, 0);
          assert.strictEqual(segunda.archivo?.paquete?.paginas, 0);
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
            paquete: undefined,
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
          assert.isUndefined(otraNoche.archivo?.paquete);
        }),
      ),
  );
});
