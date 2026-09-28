// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import {
  carpetaDeFichas,
  decodificarVigente,
  FICHERO_VIGENTE,
  leerCapa,
  versionDeCapa,
} from "@celda/dominio/capa";
import { leerLote } from "@celda/dominio/loteDeFichas";
import { capaDePuntosGrabada, muestraAntenasMoviles } from "@celda/ingesta/pruebas/antenasmoviles";
import { capaGrabada, type FuenteGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
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
import { almacenEnCarpeta } from "../src/almacenes/carpeta";
import {
  AlmacenDeFicheros,
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
const POR_LOTE = 8;

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
    return yield* publicarInstantanea(LIMITES, POR_LOTE).pipe(
      Effect.provide(Layer.merge(entorno.almacen, yield* convexEnMemoria)),
    );
  });

/** La publicación automática tras la ingesta, como la monta la acción, contando sus llamadas. */
const publicacionContada = (entorno: Entorno, llamadas: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const directa = yield* Effect.service(Publicacion).pipe(
      Effect.provide(
        publicacionDirecta(LIMITES, POR_LOTE).pipe(
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
  it.effect("publica la capa, una ficha por emplazamiento de la misma versión y vigente.json", () =>
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
        assert.strictEqual(publicada.lotes, Math.ceil(publicada.emplazamientos / POR_LOTE));
        assert.isAbove(publicada.lotes, 1);
        // Los lotes, la capa y, al final, vigente.json: la web no ve la versión hasta tenerlo todo.
        const escritos = yield* entorno.escritos;
        assert.strictEqual(escritos.length, publicada.lotes + 2);
        assert.strictEqual(escritos.at(-2), `${version}.json`);
        assert.strictEqual(escritos.at(-1), FICHERO_VIGENTE);
        assert.strictEqual(publicada.escritos, escritos.length);

        const vigente = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
        assert.deepStrictEqual(
          vigente,
          Result.succeed({
            version,
            fecha: NOCHE,
            emplazamientos: publicada.emplazamientos,
            lotes: publicada.lotes,
          }),
        );

        const capa = leerCapa((yield* entorno.leer(`${version}.json`)) ?? "", version);
        assert.isTrue(Result.isSuccess(capa));
        if (Result.isFailure(capa)) return;
        assert.strictEqual(capa.success.emplazamientos.length, publicada.emplazamientos);
        const campusNord = capa.success.emplazamientos.find((e) => e.clave === "movistar-0802532");
        assert.deepStrictEqual(campusNord?.companias, ["movistar", "vodafone", "orange"]);
        assert.deepStrictEqual(
          campusNord?.bandas?.find((b) => b.compania === "movistar")?.mhz,
          [700, 800, 900, 1800, 2100, 2600, 3500],
        );
        for (const e of capa.success.emplazamientos) {
          assert.strictEqual(e.barrio, e.posicion.longitud < 2.115 ? "21" : null, e.clave);
        }

        // Cada clave de la capa tiene su ficha en su lote, igual que la da Convex.
        for (const e of capa.success.emplazamientos) {
          const lote = e.lote ?? -1;
          const leido = leerLote(
            (yield* entorno.leer(`${carpetaDeFichas(version)}/${lote}.json`)) ?? "",
            version,
            lote,
          );
          assert.isTrue(Result.isSuccess(leido), e.clave);
          if (Result.isFailure(leido)) return;
          const ficha = leido.success.fichas.find((f) => f.clave === e.clave);
          const deConvex = yield* convex.query(refs.internal.datos.ficha, { clave: e.clave });
          assert.deepStrictEqual(
            Option.some(ficha),
            Option.map(deConvex, (f) => f),
            e.clave,
          );
          assert.isAtMost(ficha?.version ?? Infinity, NOCHE, e.clave);
        }

        const registrada = yield* convex.query(refs.internal.capas.vigente);
        assert.deepStrictEqual(
          Option.map(registrada, (r) => [r.version, r.url]),
          Option.some([version, `${ORIGEN}/${version}.json`]),
        );
      }),
    ),
  );

  it.effect("publicar otra vez sin cambios no escribe nada; con cambios sale otra versión", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", grabada));
        const primera = yield* publicar(entorno);
        const antes = (yield* entorno.escritos).length;
        const capaAntes = yield* entorno.leer(`${primera.version}.json`);

        yield* TestClock.adjust(DIA);
        const repetida = yield* publicar(entorno);
        assert.strictEqual(repetida.tipo, "al-dia");
        assert.strictEqual(repetida.version, primera.version);
        assert.strictEqual(repetida.escritos, 0);
        assert.lengthOf(yield* entorno.escritos, antes);

        yield* ejecutar(capaGrabada("registro-oficial", conOrangeMovida(grabada)));
        const segunda = yield* publicar(entorno);
        assert.strictEqual(segunda.version, versionDeCapa(NOCHE + DIA));
        assert.strictEqual(segunda.tipo, "publicada");
        // La versión anterior sigue entera: las pestañas abiertas con ella pueden seguir leyendo.
        assert.strictEqual(yield* entorno.leer(`${primera.version}.json`), capaAntes);
        assert.isDefined(yield* entorno.leer(`${carpetaDeFichas(primera.version)}/0.json`));
        const vigente = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
        assert.strictEqual(Result.getOrUndefined(vigente)?.version, segunda.version);
      }),
    ),
  );

  it.effect("se publica sola tras cada ingesta completada, y sin cambios no escribe nada", () =>
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
        const vigente = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
        assert.strictEqual(Result.getOrUndefined(vigente)?.version, versionDeCapa(NOCHE));
        const tras = (yield* entorno.escritos).length;

        // La noche siguiente la fuente dice lo mismo: se intenta publicar y no se escribe nada.
        yield* TestClock.adjust(DIA);
        const igual = yield* ejecutar(registro, undefined, publicacion);
        assert.strictEqual(igual.estado, "completada");
        assert.strictEqual(yield* Ref.get(llamadas), 2);
        assert.lengthOf(yield* entorno.escritos, tras);

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

        const version = "sitios@2026-09-26T03:15:00Z";
        const vigente = decodificarVigente((yield* entorno.leer(FICHERO_VIGENTE)) ?? "");
        assert.strictEqual(Result.getOrUndefined(vigente)?.version, version);
        const capa = leerCapa((yield* entorno.leer(`${version}.json`)) ?? "", version);
        assert.isTrue(Result.isSuccess(capa));
        if (Result.isFailure(capa)) return;
        const estadoDe = (clave: string) =>
          capa.success.emplazamientos.find((e) => e.clave === clave)?.estado;
        assert.strictEqual(estadoDe("movistar-0802532"), "corregido");
        assert.strictEqual(estadoDe("movistar-MV-BCN-82383"), "nuevo");
        assert.strictEqual(estadoDe("orange-CATR0508Z"), "verificado");

        // La ficha del corregido sale en su lote con el mismo estado que el marcador.
        const corregido = capa.success.emplazamientos.find((e) => e.clave === "movistar-0802532");
        const lote = corregido?.lote ?? -1;
        const leido = leerLote(
          (yield* entorno.leer(`${carpetaDeFichas(version)}/${lote}.json`)) ?? "",
          version,
          lote,
        );
        assert.strictEqual(
          Result.getOrUndefined(leido)?.fichas.find((f) => f.clave === "movistar-0802532")?.estado,
          "corregido",
        );
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
        const ocupado = path.join(entorno.carpeta, carpetaDeFichas(version), "0.json");
        yield* fs.makeDirectory(path.dirname(ocupado), { recursive: true });
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
        assert.isUndefined(yield* entorno.leer(`${version}.json`));

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

  it.effect("sin emplazamientos no hay nada que publicar", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const fallo = yield* Effect.flip(publicar(entorno));
        assert.strictEqual(fallo._tag, "SinEmplazamientos");
        assert.lengthOf(yield* entorno.escritos, 0);
      }),
    ),
  );
});
