// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { CorreccionPropuesta, Corroboracion } from "@celda/dominio/aportacion";
import type {
  AceptadaParaPublicar,
  AportacionEnCola,
  PaginaParaPublicar,
} from "@celda/dominio/moderacion";
import { capaGrabadaPorCajas, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { LoPublicado, loPublicadoEnCarpeta } from "@celda/moderacion/publicado";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import { BaseNocturna } from "./base.ts";
import { AceptadasDelBuzon, BuzonNoDisponible } from "./buzon.ts";
import { conBase, conEntorno, type Entorno, unaNoche } from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 9, 3, 2, 15);
const DIA = 86_400_000;
const CAMPUS_NORD = { longitud: 2.113628, latitud: 41.388344 };

/** Las aportaciones que guarda el buzón de prueba, aceptadas o no. */
type Buzon = Ref.Ref<ReadonlyArray<AportacionEnCola>>;

/**
 * Un buzón de prueba que da lo aceptado como la acción HTTP de la publicación: solo lo aceptado,
 * después de `despuesDe` y por hora de aceptación, con un seudónimo en lugar de la identidad y
 * sin la nota. Contesta en otra tarea. Con `caido` a `true`, no contesta. Con `olvidaElCursor`, da
 * siempre todo lo aceptado, como si leyera dos veces lo mismo.
 */
const buzonDePrueba = (
  buzon: Buzon,
  caido: Ref.Ref<boolean>,
  olvidaElCursor = false,
): Layer.Layer<AceptadasDelBuzon> =>
  Layer.succeed(
    AceptadasDelBuzon,
    AceptadasDelBuzon.of({
      leer: (despuesDe) =>
        Effect.gen(function* () {
          yield* Effect.yieldNow;
          if (yield* Ref.get(caido)) {
            return yield* new BuzonNoDisponible({ motivo: "fetch failed" });
          }
          const aceptadas = (yield* Ref.get(buzon))
            .filter(
              (a) =>
                a.estado === "aceptada" &&
                (olvidaElCursor || despuesDe === null || (a.moderadaEl ?? 0) > despuesDe),
            )
            .toSorted((a, b) => (a.moderadaEl ?? 0) - (b.moderadaEl ?? 0))
            .map((a): AceptadaParaPublicar => ({
              id: a.id,
              persona: `persona-de-${a.identidad}`,
              aceptadaEl: a.moderadaEl ?? 0,
              contenido: a.contenido,
            }));
          const pagina: PaginaParaPublicar = { aportaciones: aceptadas, ultima: null };
          return pagina;
        }),
    }),
  );

let contador = 0;
const uuid = () => {
  contador += 1;
  return `00000000-0000-4000-8000-${contador.toString(16).padStart(12, "0")}`;
};

const enBuzon = (
  contenido: CorreccionPropuesta | Corroboracion,
  identidad: string,
  estado: AportacionEnCola["estado"],
  moderadaEl: number,
): AportacionEnCola => ({
  id: contenido.id,
  identidad,
  huellaIp: "huella-que-no-sale-del-buzon",
  recibidaEl: moderadaEl - 3_600_000,
  contenido,
  estado,
  moderadaEl,
  motivo: estado === "aceptada" ? "Se ve en la foto aérea" : "No se ve nada",
  vetada: false,
});

const correccion = (
  emplazamiento: string,
  cambio: CorreccionPropuesta["cambio"],
): CorreccionPropuesta => ({
  id: uuid(),
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: NOCHE,
  origen: "ficha",
  emplazamiento,
  cambio,
  nota: null,
});

/** Lo publicado en el almacén del entorno, leído como lo lee la herramienta de moderación. */
const publicadoEn = <A, E>(
  entorno: Entorno,
  leer: (publicado: LoPublicado["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.flatMap(LoPublicado, leer).pipe(
    Effect.provide(loPublicadoEnCarpeta(entorno.almacen).pipe(Layer.provide(NodeServices.layer))),
  );

/** La primera ficha publicada cerca de Campus Nord. */
const fichaDeCampusNord = (entorno: Entorno) =>
  publicadoEn(entorno, (publicado) =>
    Effect.gen(function* () {
      const [cercano] = yield* publicado.cercanos(CAMPUS_NORD, 300);
      assert.isDefined(cercano);
      return cercano.clave;
    }),
  );

const fichaPublicada = (entorno: Entorno, clave: string) =>
  publicadoEn(entorno, (publicado) =>
    Effect.map(publicado.ficha(clave), (ficha) => Option.getOrThrow(ficha)),
  );

/** La última ejecución de la comunidad, como la ve la orden `estado`. */
const comunidadDe = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.map(
      Effect.flatMap(BaseNocturna, (base) => base.resumen),
      (resumen) => resumen.fuentes.find((f) => f.fuente === "comunidad"),
    ),
  );

describe("lo aceptado en la moderación, en la ingesta nocturna", () => {
  it.effect(
    "una corrección aceptada aparece en la ficha tras la noche siguiente, junto al registro, y una rechazada no aparece nunca",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const registro = capaGrabadaPorCajas("registro-oficial", grabada);
          const buzon: Buzon = yield* Ref.make<ReadonlyArray<AportacionEnCola>>([]);
          const caido = yield* Ref.make(false);
          const conBuzon = { buzon: buzonDePrueba(buzon, caido) };
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registro, conBuzon);
          const clave = yield* fichaDeCampusNord(entorno);
          const antes = yield* fichaPublicada(entorno, clave);
          assert.isUndefined(antes.correcciones);

          // Durante el día se acepta una posición y se rechaza otra cosa del mismo emplazamiento.
          const posicion = correccion(clave, {
            tipo: "posicion",
            posicion: {
              longitud: antes.posicion.longitud + 0.0015,
              latitud: antes.posicion.latitud,
            },
          });
          const rechazada = correccion(clave, { tipo: "ya-no-existe" });
          yield* Ref.set(buzon, [
            enBuzon(posicion, "identidad-a", "aceptada", NOCHE + DIA / 2),
            enBuzon(rechazada, "identidad-b", "rechazada", NOCHE + DIA / 2 + 1),
          ]);

          yield* TestClock.adjust(DIA);
          const noche = yield* unaNoche(entorno, registro, conBuzon);
          assert.deepStrictEqual(
            noche.ejecuciones.map((e) => [e.fuente, e.estado]),
            [
              ["comunidad", "completada"],
              ["registro-oficial", "completada"],
            ],
          );
          assert.strictEqual(noche.publicacion.tipo, "publicada");
          const ficha = yield* fichaPublicada(entorno, clave);
          assert.deepStrictEqual(ficha.correcciones, [
            {
              clave: posicion.id,
              cambio: posicion.cambio,
              personas: 1,
              aceptadaEl: NOCHE + DIA / 2,
              licencia: "CC0-1.0",
            },
          ]);
          // El registro sigue ahí, tal cual.
          assert.deepStrictEqual(ficha.estaciones, antes.estaciones);
          assert.deepStrictEqual(ficha.posicion, antes.posicion);
          assert.strictEqual(ficha.estado, "corregido");
          assert.strictEqual(ficha.version, NOCHE + DIA);
          const comunidad = yield* comunidadDe(entorno);
          assert.strictEqual(comunidad?.ultima?.estado, "completada");
          assert.strictEqual(comunidad?.ultima?.registros, 1);
          assert.strictEqual(comunidad?.ultima?.cambios.observaciones.creados, 1);
        }),
      ),
  );

  it.effect("leer dos veces lo mismo no duplica nada, y una corroboración suma una persona", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const registro = capaGrabadaPorCajas("registro-oficial", grabada);
        const buzon: Buzon = yield* Ref.make<ReadonlyArray<AportacionEnCola>>([]);
        const caido = yield* Ref.make(false);
        // Este buzón da siempre todo lo aceptado, sin mirar desde dónde se le pide.
        const conBuzon = { buzon: buzonDePrueba(buzon, caido, true) };
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registro, conBuzon);
        const clave = yield* fichaDeCampusNord(entorno);
        const digi = correccion(clave, { tipo: "compania", compania: "digi", esta: true });
        yield* Ref.set(buzon, [enBuzon(digi, "identidad-a", "aceptada", NOCHE + 1000)]);

        yield* TestClock.adjust(DIA);
        yield* unaNoche(entorno, registro, conBuzon);
        yield* TestClock.adjust(DIA);
        const otraVez = yield* unaNoche(entorno, registro, conBuzon);
        assert.notStrictEqual(otraVez.publicacion.tipo, "publicada");
        assert.strictEqual((yield* comunidadDe(entorno))?.ultima?.cambios.observaciones.creados, 0);
        assert.strictEqual((yield* fichaPublicada(entorno, clave)).correcciones?.[0]?.personas, 1);

        const respaldo: Corroboracion = {
          id: uuid(),
          tipo: "corroboracion",
          esquema: 1,
          creada: NOCHE,
          origen: "ficha",
          emplazamiento: clave,
          correccion: digi.id,
        };
        yield* Ref.update(buzon, (b) => [
          ...b,
          enBuzon(respaldo, "identidad-b", "aceptada", NOCHE + 2 * DIA),
        ]);
        yield* TestClock.adjust(DIA);
        yield* unaNoche(entorno, registro, conBuzon);
        assert.strictEqual((yield* fichaPublicada(entorno, clave)).correcciones?.[0]?.personas, 2);
      }),
    ),
  );

  it.effect(
    "la noche sin Convex publica igual y lo deja en el diario, y la siguiente lo recoge",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const registro = capaGrabadaPorCajas("registro-oficial", grabada);
          const buzon: Buzon = yield* Ref.make<ReadonlyArray<AportacionEnCola>>([]);
          const caido = yield* Ref.make(true);
          const conBuzon = { buzon: buzonDePrueba(buzon, caido) };
          const avisos: Array<string> = [];
          const diario = Logger.make(({ logLevel, message }) => {
            if (logLevel === "Warn") avisos.push([message].flat().join(" "));
          });
          yield* TestClock.setTime(NOCHE);
          const noche = yield* unaNoche(entorno, registro, conBuzon).pipe(
            Effect.provide(Logger.layer([diario])),
          );
          assert.strictEqual(noche.publicacion.tipo, "publicada");
          assert.deepStrictEqual(
            noche.ejecuciones.map((e) => [e.fuente, e.estado]),
            [
              ["comunidad", "fallida"],
              ["registro-oficial", "completada"],
            ],
          );
          assert.isTrue(
            avisos.some(
              (aviso) =>
                aviso.includes("El buzón de Convex no está disponible") &&
                aviso.includes("publica lo demás"),
            ),
            avisos.join("\n"),
          );
          const fallida = yield* comunidadDe(entorno);
          assert.strictEqual(fallida?.ultima?.estado, "fallida");
          assert.include(fallida?.ultima?.errores[0], "fetch failed");

          // Con Convex de vuelta, la noche siguiente trae lo que se aceptó mientras.
          const clave = yield* fichaDeCampusNord(entorno);
          const propuesta = correccion(clave, { tipo: "ya-no-existe" });
          yield* Ref.set(buzon, [enBuzon(propuesta, "identidad-a", "aceptada", NOCHE + 1000)]);
          yield* Ref.set(caido, false);
          yield* TestClock.adjust(DIA);
          yield* unaNoche(entorno, registro, conBuzon);
          assert.strictEqual(
            (yield* fichaPublicada(entorno, clave)).correcciones?.[0]?.cambio.tipo,
            "ya-no-existe",
          );
        }),
      ),
  );

  it.effect(
    "lo aceptado y el enlace a la ficha siguen en su emplazamiento cuando cambian sus estaciones base o se junta con otro",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const buzon: Buzon = yield* Ref.make<ReadonlyArray<AportacionEnCola>>([]);
          const caido = yield* Ref.make(false);
          const conBuzon = { buzon: buzonDePrueba(buzon, caido) };
          const noche = (registros: typeof grabada.listado.registros) =>
            unaNoche(
              entorno,
              capaGrabadaPorCajas("registro-oficial", {
                ...grabada,
                listado: { ...grabada.listado, registros },
              }),
              conBuzon,
            );
          yield* TestClock.setTime(NOCHE);
          yield* noche(grabada.listado.registros);
          // Movistar, Orange y Vodafone en un mismo emplazamiento: su clave es la de Movistar.
          const compartido = "movistar-0802532";
          const solo = "vodafone-079808";
          const posicion = (clave: string) =>
            correccion(clave, {
              tipo: "posicion",
              posicion: { longitud: CAMPUS_NORD.longitud + 0.001, latitud: CAMPUS_NORD.latitud },
            });
          const enCompartido = posicion(compartido);
          const enSolo = posicion(solo);
          yield* Ref.set(buzon, [
            enBuzon(enCompartido, "identidad-a", "aceptada", NOCHE + DIA / 2),
            enBuzon(enSolo, "identidad-b", "aceptada", NOCHE + DIA / 2 + 1),
          ]);

          // Movistar deja el emplazamiento compartido, y la estación de Vodafone que estaba sola se
          // mueve junto a las de Telefónica de `movistar-0807565`.
          const destino = { longitud: 2.121719, latitud: 41.385502 };
          const despues = grabada.listado.registros
            .filter((r) => r.clave !== "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532")
            .map((r) => {
              if (r.clave !== "VODAFONE ESPAÑA, S.A.U. - 079808" || r.crudo === undefined) return r;
              // Lo que escribe el registro también se mueve: es lo que compara la ingesta.
              const crudo = { ...r.crudo, longitud: destino.longitud, latitud: destino.latitud };
              return { ...r, posicion: destino, crudo };
            });
          // Una baja pide dos barridos.
          for (const dia of [1, 2]) {
            yield* TestClock.setTime(NOCHE + dia * DIA);
            yield* noche(despues);
          }
          const compartida = yield* fichaPublicada(entorno, compartido);
          assert.deepStrictEqual(
            compartida.estaciones.map((e) => e.compania),
            ["orange", "vodafone"],
          );
          assert.deepStrictEqual(
            compartida.correcciones?.map((c) => c.clave),
            [enCompartido.id],
          );
          // `vodafone-079808` se ha juntado con `movistar-0807565`, y lo suyo va con él.
          const juntada = yield* fichaPublicada(entorno, "movistar-0807565");
          assert.deepStrictEqual(
            juntada.correcciones?.map((c) => c.clave),
            [enSolo.id],
          );
        }),
      ),
  );
});
