// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { leerResumen, type ProvinciaDelResumen } from "@celda/dominio/provincias";
import { OPCIONES_BARRIDO, type OpcionesBarrido } from "@celda/ingesta/barrido";
import { OPCIONES_FICHAS, Provincias } from "@celda/ingesta/fichas";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  listadoGrabado,
} from "@celda/ingesta/pruebas/grabado";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { configuracion } from "./configuracion.ts";
import { describirResumen } from "./estado.ts";
import { estado, type EjecucionDeLaNoche, provinciasDe } from "./programa.ts";
import { conBase, conEntorno, contenidoDe, type Entorno, unaNoche } from "./pruebas/entorno.ts";
import { espanaSintetica } from "./pruebas/espana.ts";

const NOCHE = Date.UTC(2026, 9, 5, 2, 15);
const DIA = 86_400_000;

/** Las zonas de barrido en el orden de la configuración por defecto. */
const ZONAS = ZONAS_DE_BARRIDO.map((zona) => zona.nombre);

/** La configuración por defecto, sin fichas: estas pruebas miran el listado y la cobertura. */
const SIN_FICHAS: OpcionesBarrido = {
  ...OPCIONES_BARRIDO,
  fichas: { ...OPCIONES_FICHAS, maximo: 0 },
};

const registroOficial = (grabada: FuenteGrabada) =>
  capaGrabadaPorCajas("registro-oficial", grabada);

/** Lo que el registro oficial hizo en una noche. */
const delRegistro = (ejecuciones: ReadonlyArray<EjecucionDeLaNoche>) => {
  const registro = ejecuciones.find((e) => e.fuente === "registro-oficial");
  assert.isDefined(registro);
  return registro;
};

/** El resumen nacional vigente del almacén del entorno, por provincia. */
const resumenPublicado = (entorno: Entorno) =>
  Effect.gen(function* () {
    const almacen = yield* contenidoDe(entorno.almacen);
    const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
    if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
    const resumen = leerResumen(
      almacen.get(vigente.success.resumen ?? "") ?? "",
      vigente.success.version,
    );
    if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
    return new Map(resumen.success.provincias.map((p) => [p.codigo, p]));
  });

const cubiertas = (provincias: ReadonlyMap<string, ProvinciaDelResumen>) =>
  [...provincias.values()].filter((p) => p.cubierta).map((p) => p.codigo);

/** El texto de la orden `estado` y lo que cuenta, a la hora del reloj. */
const estadoDe = (entorno: Entorno, opciones: OpcionesBarrido = OPCIONES_BARRIDO) =>
  Effect.gen(function* () {
    const provincias = provinciasDe((yield* zonasDePublicacion).municipios);
    const hecho = yield* conBase(
      entorno.base,
      estado(opciones).pipe(Effect.provideService(Provincias, provincias)),
    );
    const texto = describirResumen(
      entorno.base,
      hecho.resumen,
      hecho.cola,
      provincias.nombreDe,
      hecho.turno,
    );
    return { ...hecho, texto };
  });

describe("toda España en la ingesta nocturna (#50)", () => {
  it.effect(
    "por defecto barre una zona cada noche, y cada provincia queda cubierta cuando se ha barrido entera",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const zonas = yield* zonasDePublicacion;
          // Una décima parte de los registros: aquí solo importa qué se ha barrido.
          const espana = yield* espanaSintetica(zonas, { escala: 0.1 });
          const barridas: Array<ReadonlyArray<string>> = [];
          const noche = (n: number) =>
            Effect.gen(function* () {
              yield* TestClock.setTime(NOCHE + n * DIA);
              const hecha = yield* unaNoche(entorno, registroOficial(espana), {
                proceso: SIN_FICHAS,
                porLote: 128,
              });
              const registro = delRegistro(hecha.ejecuciones);
              assert.strictEqual(registro.estado, "completada");
              barridas.push(registro.zonas.map((z) => z.zona));
            });

          yield* noche(0);
          const primera = yield* resumenPublicado(entorno);
          assert.deepStrictEqual(cubiertas(primera), ["08", "17", "25", "43"]);
          // Huesca tiene barrido el cuadro que comparte con Lleida: sus emplazamientos de ahí
          // están, pero su número no es el de la provincia.
          const huesca = primera.get("22");
          assert.isFalse(huesca?.cubierta);
          assert.isAbove(huesca?.emplazamientos ?? 0, 0);
          assert.strictEqual(huesca?.barrido, NOCHE);
          // Madrid no tiene nada barrido: sin número, sin capa y sin barrido.
          const madrid = primera.get("28");
          assert.isFalse(madrid?.cubierta);
          assert.strictEqual(madrid?.emplazamientos, 0);
          assert.isUndefined(madrid?.fichero);
          assert.isNull(madrid?.barrido);

          const antes = yield* estadoDe(entorno);
          assert.include(antes.texto, "Zonas de barrido, en el orden de la configuración:");
          assert.match(
            antes.texto,
            /- cataluna: último barrido completado [^\n]*; fichas por leer: \d+ sin leer, 0 por releer/u,
          );
          assert.include(
            antes.texto,
            "- centro: ningún barrido completado; fichas por leer: ninguna",
          );
          assert.include(antes.texto, "La próxima noche barre: centro");

          yield* noche(1);
          const segunda = yield* resumenPublicado(entorno);
          // Madrid llega al cuadro de Somosierra, que es de la zona del Ebro y el Duero.
          assert.isFalse(segunda.get("28")?.cubierta);
          assert.isAbove(segunda.get("28")?.emplazamientos ?? 0, 0);
          assert.includeMembers(cubiertas(segunda), ["08", "17", "25", "43"]);

          for (let n = 2; n < 7; n++) yield* noche(n);
          // Una zona cada noche, en el orden de la configuración.
          assert.deepStrictEqual(
            barridas,
            ZONAS.map((zona) => [zona]),
          );
          const todas = yield* resumenPublicado(entorno);
          assert.strictEqual(todas.size, 52);
          assert.deepStrictEqual(cubiertas(todas), [...todas.keys()]);
          // Cada provincia con el último barrido de las zonas que la tocan.
          assert.strictEqual(todas.get("08")?.barrido, NOCHE);
          assert.strictEqual(todas.get("28")?.barrido, NOCHE + 5 * DIA);
          assert.strictEqual(todas.get("38")?.barrido, NOCHE + 6 * DIA);

          const despues = yield* estadoDe(entorno);
          assert.include(despues.texto, "La próxima noche barre: cataluna");
        }),
      ),
    120_000,
  );

  it.effect(
    "toda España cabe en una noche cambiando solo la configuración, y sus fichas van por prioridad",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const c = yield* configuracion.parse(
            ConfigProvider.fromEnv({
              env: { CELDA_REGISTRO_ZONAS_POR_NOCHE: "7", CELDA_INGESTA_MAX_FICHAS: "0" },
            }),
          );
          const espana = yield* espanaSintetica(yield* zonasDePublicacion);
          yield* TestClock.setTime(NOCHE);
          const hecha = yield* unaNoche(entorno, registroOficial(espana), {
            proceso: c.noche.proceso,
            porLote: 128,
          });

          const registro = delRegistro(hecha.ejecuciones);
          assert.deepStrictEqual(
            registro.zonas.map((z) => [z.zona, z.estado]),
            ZONAS.map((zona) => [zona, "completado"]),
          );
          // La primera pasada de cada zona es la de su noche con la configuración por defecto:
          // unas 35 peticiones de media, y unas 29 las siguientes, con las cajas guardadas. La
          // primera noche real, el 29/09/2026, levante necesitó 46.
          for (const zona of registro.zonas) {
            assert.isAtLeast(zona.peticiones, 15, zona.zona);
            assert.isAtMost(zona.peticiones, 50, zona.zona);
            assert.strictEqual(zona.registros, espana.porZona.get(zona.zona), zona.zona);
          }
          const peticiones = registro.zonas.reduce((suma, z) => suma + z.peticiones, 0);
          // 247 en la primera noche real de toda España; la España sintética da 242.
          assert.isAtLeast(peticiones, 200);
          assert.isAtMost(peticiones, 280);
          // Con `robots.txt` y margen para reintentos, dentro del tope por defecto.
          assert.isBelow(peticiones + 10, c.registroOficial.maxPeticiones);
          assert.strictEqual(hecha.publicacion.tipo, "publicada");
          if (hecha.publicacion.tipo !== "publicada") return;
          // Unos 42.000 emplazamientos, como estima la investigación 08.
          assert.isAbove(hecha.publicacion.emplazamientos, 40_000);
          assert.isBelow(hecha.publicacion.emplazamientos, 44_000);

          const provincias = yield* resumenPublicado(entorno);
          assert.deepStrictEqual(cubiertas(provincias), [...provincias.keys()]);
          const suma = [...provincias.values()].reduce((a, p) => a + p.emplazamientos, 0);
          assert.strictEqual(suma, hecha.publicacion.emplazamientos);

          // Las fichas: Barcelona, el resto de Cataluña y luego cada zona en su orden.
          const { cola, turno } = yield* estadoDe(entorno, c.noche.proceso);
          assert.deepStrictEqual(
            cola.map(({ grupo }) =>
              grupo.tipo === "provincia"
                ? grupo.provincia
                : grupo.tipo === "zona"
                  ? grupo.zona
                  : "fuera",
            ),
            ["08", "17", "25", "43", ...ZONAS],
          );
          assert.strictEqual(
            cola.reduce((suma, g) => suma + g.nuevas, 0),
            espana.listado.registros.length,
          );
          // La zona de Cataluña cuenta también las de sus provincias con prioridad.
          assert.strictEqual(
            turno.zonas.find((z) => z.zona === "cataluna")?.fichas.nuevas,
            espana.porZona.get("cataluna"),
          );
          assert.deepStrictEqual(turno.proxima, ZONAS);
        }),
      ),
    120_000,
  );

  it.effect(
    "con los listados grabados de Barcelona y Madrid, cada noche barre su zona y cada ciudad va a su provincia",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const barcelona = yield* listadoGrabado("barcelona");
          const madrid = yield* listadoGrabado("madrid-centro");
          const grabada: FuenteGrabada = {
            listado: { registros: [...barcelona.registros, ...madrid.registros], avisos: [] },
            fichas: new Map(),
          };
          const noche = (n: number) =>
            Effect.andThen(
              TestClock.setTime(NOCHE + n * DIA),
              unaNoche(entorno, registroOficial(grabada), { proceso: SIN_FICHAS, porLote: 128 }),
            );

          const primera = delRegistro((yield* noche(0)).ejecuciones);
          assert.deepStrictEqual(
            primera.zonas.map((z) => [z.zona, z.registros]),
            [["cataluna", barcelona.registros.length]],
          );
          const segunda = delRegistro((yield* noche(1)).ejecuciones);
          assert.deepStrictEqual(
            segunda.zonas.map((z) => [z.zona, z.registros]),
            [["centro", madrid.registros.length]],
          );

          // Los emplazamientos de la revisión de la fusión (investigación 08, ticket 49).
          const provincias = yield* resumenPublicado(entorno);
          assert.strictEqual(provincias.get("08")?.emplazamientos, 1294);
          // 1331 antes de reparar «Casta±eda», que ahora se junta con «CASTAÑEDA».
          assert.strictEqual(provincias.get("28")?.emplazamientos, 1330);
          assert.isTrue(provincias.get("08")?.cubierta);
          assert.isFalse(provincias.get("28")?.cubierta);
        }),
      ),
    60_000,
  );
});
