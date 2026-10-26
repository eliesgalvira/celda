// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { zonaDeBarrido, ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { leerResumen, type ProvinciaDelResumen } from "@celda/dominio/provincias";
import { OPCIONES_BARRIDO, type OpcionesBarrido } from "@celda/ingesta/barrido";
import { ExtractorPorCajas, FuenteNoDisponible } from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS } from "@celda/ingesta/fichas";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  listadoGrabado,
} from "@celda/ingesta/pruebas/grabado";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { CALENDARIO } from "./calendario.ts";
import { configuracion } from "./configuracion.ts";
import { describirResumen } from "./estado.ts";
import { estado, type EjecucionDeLaNoche } from "./programa.ts";
import { conBase, conEntorno, contenidoDe, type Entorno, unaNoche } from "./pruebas/entorno.ts";
import { espanaSintetica } from "./pruebas/espana.ts";

/** El primer sábado de octubre de 2026, el día 3, a las 00:30 de Madrid. */
const NOCHE = Date.UTC(2026, 9, 2, 22, 30);
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

/** La fuente grabada, con el geoportal caído en los cuadros de una zona. */
const caidoEn = (grabada: FuenteGrabada, nombre: string) => {
  const cuadros = new Set(zonaDeBarrido(nombre)?.cuadros);
  return Layer.effect(
    ExtractorPorCajas,
    Effect.map(ExtractorPorCajas, (real) =>
      ExtractorPorCajas.of({
        ...real,
        caja: (caja) =>
          cuadros.has(`${Math.floor(caja[0])},${Math.floor(caja[1])}`)
            ? Effect.fail(new FuenteNoDisponible({ url: "bbox", motivo: "HTTP 503" }))
            : real.caja(caja),
      }),
    ),
  ).pipe(Layer.provide(registroOficial(grabada)));
};

/** Lo que el registro oficial hizo en una ejecución. */
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
      almacen.get(vigente.success.resumen) ?? "",
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
    const hecho = yield* conBase(entorno.base, estado(opciones, CALENDARIO));
    return { ...hecho, texto: describirResumen(entorno.base, hecho.resumen, hecho.turno) };
  });

describe("toda España en la ingesta (#50 y ADR 0029)", () => {
  it.effect(
    "el sábado barre las siete zonas; si la fuente cae a medias, el domingo barre las que faltan, y cada provincia queda cubierta cuando se ha barrido entera",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const zonas = yield* zonasDePublicacion;
          // Una décima parte de los registros: aquí solo importa qué se ha barrido.
          const espana = yield* espanaSintetica(zonas, { escala: 0.1 });

          // El sábado el geoportal cae al llegar a Andalucía: las zonas que quedan, pendientes.
          yield* TestClock.setTime(NOCHE);
          const sabado = delRegistro(
            (yield* unaNoche(entorno, caidoEn(espana, "andalucia"), {
              proceso: SIN_FICHAS,
              porLote: 128,
            })).ejecuciones,
          );
          assert.strictEqual(sabado.estado, "completada");
          assert.deepStrictEqual(
            sabado.zonas.map((z) => [z.zona, z.estado]),
            ZONAS.map((zona, i) => [
              zona,
              i < 2 ? "completado" : i === 2 ? "fallido" : "pendiente",
            ]),
          );
          assert.deepStrictEqual(sabado.porLeer?.zonas, ZONAS.slice(2));
          const primera = yield* resumenPublicado(entorno);
          assert.deepStrictEqual(cubiertas(primera), ["08", "17", "25", "43"]);
          // Huesca tiene barrido el cuadro que comparte con Lleida: sus emplazamientos de ahí
          // están, pero su número no es el de la provincia.
          const huesca = primera.get("22");
          assert.isFalse(huesca?.cubierta);
          assert.isAbove(huesca?.emplazamientos ?? 0, 0);
          assert.strictEqual(huesca?.barrido, NOCHE);
          // Sevilla no tiene nada barrido: sin número, sin capa y sin barrido.
          const sevilla = primera.get("41");
          assert.isFalse(sevilla?.cubierta);
          assert.strictEqual(sevilla?.emplazamientos, 0);
          assert.isUndefined(sevilla?.fichero);
          assert.isNull(sevilla?.barrido);

          const antes = yield* estadoDe(entorno);
          assert.include(antes.texto, "Zonas de barrido, en el orden de la configuración:");
          assert.match(
            antes.texto,
            /- cataluna: último barrido completado [^\n]*; fichas por leer: \d+ sin leer, 0 por releer/u,
          );
          assert.include(
            antes.texto,
            "- andalucia: ningún barrido completado; fichas por leer: ninguna",
          );
          assert.include(antes.texto, `La próxima ejecución barre: ${ZONAS.slice(2).join(", ")}`);
          assert.include(
            antes.texto,
            "Próxima ejecución: el domingo 4/10/2026 a las 00:30 (Europe/Madrid). Retoma la " +
              "ronda y solo pide al registro lo que quede de ella. Ahora quedan 5 zonas " +
              `(${ZONAS.slice(2).join(", ")}) y `,
          );
          // Madrid llega al cuadro de Somosierra, que es de la zona del Ebro y el Duero.
          assert.isFalse(primera.get("28")?.cubierta);
          assert.isAbove(primera.get("28")?.emplazamientos ?? 0, 0);

          // El domingo solo barre las cinco que faltan, y ya está toda España.
          yield* TestClock.setTime(NOCHE + DIA);
          const domingo = delRegistro(
            (yield* unaNoche(entorno, registroOficial(espana), {
              proceso: SIN_FICHAS,
              porLote: 128,
            })).ejecuciones,
          );
          assert.deepStrictEqual(
            domingo.zonas.map((z) => [z.zona, z.estado]),
            ZONAS.slice(2).map((zona) => [zona, "completado"]),
          );
          assert.deepStrictEqual(domingo.porLeer?.zonas, []);
          const todas = yield* resumenPublicado(entorno);
          assert.strictEqual(todas.size, 52);
          assert.deepStrictEqual(cubiertas(todas), [...todas.keys()]);
          // Cada provincia con el último barrido de las zonas que la tocan.
          assert.strictEqual(todas.get("08")?.barrido, NOCHE);
          assert.strictEqual(todas.get("28")?.barrido, NOCHE + DIA);
          assert.strictEqual(todas.get("38")?.barrido, NOCHE + DIA);

          // La próxima, el primer sábado de noviembre, empieza otra ronda con las siete.
          const despues = yield* estadoDe(entorno);
          assert.include(despues.texto, `La próxima ejecución barre: ${ZONAS.join(", ")}`);
          assert.include(
            despues.texto,
            "Próxima ejecución: el sábado 7/11/2026 a las 00:30 (Europe/Madrid). Empieza otra " +
              "ronda, en la que barre sus 7 zonas y lee todas las fichas",
          );
        }),
      ),
    120_000,
  );

  it.effect(
    "toda España cabe en una ejecución con la configuración por defecto, y sus fichas van en un solo orden",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const c = yield* configuracion.parse(
            ConfigProvider.fromEnv({ env: { CELDA_INGESTA_MAX_FICHAS: "0" } }),
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
          // La primera pasada de cada zona: unas 35 peticiones de media, y unas 29 las
          // siguientes, con las cajas guardadas. La primera pasada real de levante, el
          // 29/09/2026, necesitó 46.
          for (const zona of registro.zonas) {
            assert.isAtLeast(zona.peticiones, 15, zona.zona);
            assert.isAtMost(zona.peticiones, 50, zona.zona);
            assert.strictEqual(zona.registros, espana.porZona.get(zona.zona), zona.zona);
          }
          const peticiones = registro.zonas.reduce((suma, z) => suma + z.peticiones, 0);
          // 247 en la primera pasada real de toda España; la España sintética da 242.
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

          // Las fichas: todas sin leer, en una sola cola, y cada zona con las de sus cuadros.
          const { cola, turno } = yield* estadoDe(entorno, c.noche.proceso);
          assert.deepStrictEqual(cola, {
            nuevas: espana.listado.registros.length,
            porReleer: 0,
            enEspera: 0,
          });
          assert.strictEqual(turno.porLeer, espana.listado.registros.length);
          for (const zona of ZONAS) {
            assert.strictEqual(
              turno.zonas.find((z) => z.zona === zona)?.fichas.nuevas,
              espana.porZona.get(zona),
              zona,
            );
          }
          // La del domingo no barre nada: las siete zonas tienen su barrido de la ronda.
          assert.strictEqual(turno.proxima.dia, "domingo");
          assert.deepStrictEqual(turno.proxima.zonas, []);
        }),
      ),
    120_000,
  );

  it.effect(
    "con los listados grabados de Barcelona y Madrid, una ejecución barre las dos zonas y cada ciudad va a su provincia",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const barcelona = yield* listadoGrabado("barcelona");
          const madrid = yield* listadoGrabado("madrid-centro");
          const grabada: FuenteGrabada = {
            listado: { registros: [...barcelona.registros, ...madrid.registros], avisos: [] },
            fichas: new Map(),
          };
          yield* TestClock.setTime(NOCHE);
          const hecha = delRegistro(
            (yield* unaNoche(entorno, registroOficial(grabada), {
              proceso: SIN_FICHAS,
              porLote: 128,
            })).ejecuciones,
          );
          assert.deepStrictEqual(
            hecha.zonas.map((z) => [z.zona, z.registros]),
            ZONAS.map((zona) => [
              zona,
              zona === "cataluna"
                ? barcelona.registros.length
                : zona === "centro"
                  ? madrid.registros.length
                  : 0,
            ]),
          );

          // Los emplazamientos de la revisión de la fusión (investigación 08, ticket 49).
          const provincias = yield* resumenPublicado(entorno);
          assert.strictEqual(provincias.get("08")?.emplazamientos, 1294);
          // 1331 antes de reparar «Casta±eda», que ahora se junta con «CASTAÑEDA».
          assert.strictEqual(provincias.get("28")?.emplazamientos, 1330);
          assert.isTrue(provincias.get("08")?.cubierta);
          assert.isTrue(provincias.get("28")?.cubierta);
        }),
      ),
    60_000,
  );
});
