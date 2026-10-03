// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Coordenada } from "@celda/dominio/area";
import type { ZonaDeBarrido } from "@celda/dominio/barrido";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";

import type { OpcionesCliente } from "./cliente.ts";
import { ExtractorPorCajas } from "./extractor.ts";
import {
  esperaTrasFallos,
  type FalloDeFicha,
  type FichaEnCola,
  leerFichasEnLaVentana,
  OPCIONES_FICHAS,
  opcionesClienteDeFichas,
  type OpcionesFichas,
  ordenarFichas,
  type Prioridad,
  resumirCola,
} from "./fichas.ts";
import { leerMuestra } from "./pruebas/grabado.ts";
import { clienteDePrueba, NO_HAY_ROBOTS, type Peticion, type Respondedor } from "./pruebas/http.ts";
import { esperarConReloj } from "./pruebas/reloj.ts";
import { capaPorCajas, OPCIONES } from "./registro-oficial/extractor.ts";

const DIA = 86_400_000;
const AHORA = Date.UTC(2026, 8, 30, 2, 15);

/** Tres zonas de un cuadro cada una, como las de barrido. */
const CATALUNA: ZonaDeBarrido = { nombre: "cataluna", titulo: "Cataluña", cuadros: ["2,41"] };
const CENTRO: ZonaDeBarrido = { nombre: "centro", titulo: "Centro", cuadros: ["-4,40"] };
const LEVANTE: ZonaDeBarrido = { nombre: "levante", titulo: "Levante", cuadros: ["-1,39"] };

/** Provincias de mentira: al este de 2,5° es Girona (17) y al oeste, Barcelona (08). */
const provinciaDe = ({ longitud, latitud }: Coordenada): string | undefined =>
  latitud >= 41 && latitud < 42 && longitud >= 2 && longitud < 3
    ? longitud >= 2.5
      ? "17"
      : "08"
    : undefined;

const PRIORIDAD: Prioridad = {
  provincias: ["08"],
  zonas: [CATALUNA, CENTRO, LEVANTE],
  provinciaDe,
};

let siguiente = 0;

/** Una ficha en cola en `posicion`, nueva salvo que se diga cuándo se leyó. */
const ficha = (
  nombre: string,
  posicion: Coordenada,
  cambios: Partial<Omit<FichaEnCola, "registro">> = {},
): FichaEnCola => ({
  registro: {
    clave: `TELEFONICA MOVILES ESPAÑA, S.A.U. - ${nombre}`,
    compania: "movistar",
    codigo: nombre,
    posicion,
    direccion: "CL X, 1. BARCELONA, BARCELONA",
    municipio: "BARCELONA",
    url: `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=${nombre}`,
  },
  orden: ++siguiente,
  cuadro: `${Math.floor(posicion.longitud)},${Math.floor(posicion.latitud)}`,
  leidaEn: null,
  fallos: 0,
  esperaHasta: null,
  ...cambios,
});

const BARCELONA = { longitud: 2.15, latitud: 41.39 };
const GIRONA = { longitud: 2.82, latitud: 41.98 };
const MADRID = { longitud: -3.7, latitud: 40.42 };
const VALENCIA = { longitud: -0.37, latitud: 39.47 };
const LISBOA = { longitud: -9.14, latitud: 38.72 };

const nombres = (cola: ReadonlyArray<FichaEnCola>) => cola.map((f) => f.registro.codigo);

describe("orden de la cola de fichas", () => {
  it("la provincia con prioridad va primero, luego cada zona en su orden y al final el resto", () => {
    // Llegan en otro orden del que se leen.
    const cola = [
      ficha("fuera", LISBOA),
      ficha("valencia", VALENCIA),
      ficha("madrid", MADRID),
      ficha("girona", GIRONA),
      ficha("barcelona", BARCELONA),
    ];
    assert.deepStrictEqual(nombres(ordenarFichas(cola, PRIORIDAD, AHORA)), [
      "barcelona",
      "girona",
      "madrid",
      "valencia",
      "fuera",
    ]);
    // Con Girona antes que Barcelona y las zonas en otro orden.
    assert.deepStrictEqual(
      nombres(
        ordenarFichas(
          cola,
          { ...PRIORIDAD, provincias: ["17", "08"], zonas: [LEVANTE, CATALUNA, CENTRO] },
          AHORA,
        ),
      ),
      ["girona", "barcelona", "valencia", "madrid", "fuera"],
    );
    // Sin provincias con prioridad, Barcelona es una más de Cataluña.
    assert.deepStrictEqual(nombres(ordenarFichas(cola, { ...PRIORIDAD, provincias: [] }, AHORA)), [
      "girona",
      "barcelona",
      "madrid",
      "valencia",
      "fuera",
    ]);
  });

  it("dentro de cada grupo, las nuevas en el orden en que llegaron y luego la relectura, de la más vieja a la más nueva", () => {
    const cola = [
      ficha("leida-hace-40", BARCELONA, { leidaEn: AHORA - 40 * DIA }),
      ficha("nueva-1", BARCELONA),
      ficha("leida-hace-60", BARCELONA, { leidaEn: AHORA - 60 * DIA }),
      ficha("madrid-nueva", MADRID),
      ficha("nueva-2", BARCELONA),
      ficha("girona-leida", GIRONA, { leidaEn: AHORA - 31 * DIA }),
      ficha("girona-nueva", GIRONA),
    ];
    assert.deepStrictEqual(nombres(ordenarFichas(cola, PRIORIDAD, AHORA)), [
      "nueva-1",
      "nueva-2",
      "leida-hace-60",
      "leida-hace-40",
      "girona-nueva",
      "girona-leida",
      "madrid-nueva",
    ]);
  });

  it("una ficha que espera tras fallar se queda fuera hasta que pasa su espera", () => {
    const cola = [
      ficha("espera", BARCELONA, { fallos: 1, esperaHasta: AHORA + DIA }),
      ficha("ya-puede", BARCELONA, { fallos: 2, esperaHasta: AHORA - 1 }),
      ficha("normal", MADRID),
    ];
    assert.deepStrictEqual(nombres(ordenarFichas(cola, PRIORIDAD, AHORA)), ["ya-puede", "normal"]);
    assert.deepStrictEqual(nombres(ordenarFichas(cola, PRIORIDAD, AHORA + DIA + 1)), [
      "espera",
      "ya-puede",
      "normal",
    ]);
  });

  it("una zona repetida cuenta donde sale primero, y el orden no depende del de llegada", () => {
    const cola = [ficha("madrid", MADRID), ficha("girona", GIRONA), ficha("valencia", VALENCIA)];
    const prioridad = { ...PRIORIDAD, zonas: [CENTRO, CATALUNA, CENTRO, LEVANTE] };
    const orden = nombres(ordenarFichas(cola, prioridad, AHORA));
    assert.deepStrictEqual(orden, ["madrid", "girona", "valencia"]);
    assert.deepStrictEqual(nombres(ordenarFichas(cola.toReversed(), prioridad, AHORA)), orden);
  });

  it("el resumen dice cuántas quedan en cada grupo, en el orden de la cola", () => {
    const cola = [
      ficha("a", BARCELONA),
      ficha("b", BARCELONA, { leidaEn: AHORA - 40 * DIA }),
      ficha("c", BARCELONA, { fallos: 1, esperaHasta: AHORA + DIA }),
      ficha("d", VALENCIA),
      ficha("e", LISBOA),
    ];
    assert.deepStrictEqual(resumirCola(cola, PRIORIDAD, AHORA), [
      { grupo: { tipo: "provincia", provincia: "08" }, nuevas: 1, porReleer: 1, enEspera: 1 },
      { grupo: { tipo: "zona", zona: "levante" }, nuevas: 1, porReleer: 0, enEspera: 0 },
      { grupo: { tipo: "fuera" }, nuevas: 1, porReleer: 0, enEspera: 0 },
    ]);
  });

  it("tras un fallo se espera un día, el doble con cada fallo seguido, hasta la relectura", () => {
    const dias = [1, 2, 3, 4, 5, 6, 7].map((fallos) =>
      Duration.toDays(esperaTrasFallos(fallos, OPCIONES_FICHAS.relectura)),
    );
    assert.deepStrictEqual(dias, [1, 2, 4, 8, 16, 30, 30]);
  });

  it("el cliente de las fichas va a su ritmo, 3 s por defecto y nunca menos de 1 s, con un tope que cabe en la ventana", () => {
    const cliente = opcionesClienteDeFichas(OPCIONES, OPCIONES_FICHAS);
    assert.strictEqual(Duration.toSeconds(cliente.pausa), 3);
    assert.strictEqual(cliente.maxPeticiones, 7200);
    assert.strictEqual(cliente.userAgent, OPCIONES.userAgent);
    const despacio = opcionesClienteDeFichas(OPCIONES, {
      ...OPCIONES_FICHAS,
      ritmo: Duration.seconds(10),
    });
    assert.strictEqual(Duration.toSeconds(despacio.pausa), 10);
    assert.strictEqual(despacio.maxPeticiones, 2160);
    const aUnSegundo = opcionesClienteDeFichas(OPCIONES, A_UN_SEGUNDO);
    assert.strictEqual(Duration.toSeconds(aUnSegundo.pausa), 1);
    assert.strictEqual(aUnSegundo.maxPeticiones, 21_600);
    const deprisa = opcionesClienteDeFichas(OPCIONES, {
      ...OPCIONES_FICHAS,
      ritmo: Duration.millis(200),
    });
    assert.strictEqual(Duration.toSeconds(deprisa.pausa), 1);
  });
});

/** Lo que la lectura ha apuntado en la «base»: bandas guardadas, fallos y publicaciones. */
interface Apuntado {
  readonly leidas: ReadonlyArray<string>;
  readonly fallos: ReadonlyArray<readonly [string, FalloDeFicha]>;
  readonly aMitad: ReadonlyArray<number>;
}

/** `n` fichas nuevas de Barcelona. */
/** Las fichas al ritmo más rápido que se permite, una por segundo. */
const A_UN_SEGUNDO: OpcionesFichas = { ...OPCIONES_FICHAS, ritmo: Duration.seconds(1) };

const colaDe = (n: number) =>
  Array.from({ length: n }, (_, i) => ficha(String(800_000 + i), BARCELONA));

/**
 * Lee `cola` con el extractor real sobre el geoportal de prueba y el reloj de prueba, empezando
 * la noche a las 0, y apunta cada petición, lo guardado y cuándo se publica a mitad.
 */
const leerContraElGeoportal = (
  cola: ReadonlyArray<FichaEnCola>,
  responder: Respondedor,
  opciones: OpcionesFichas,
  latencia: Duration.Duration = Duration.zero,
  segundos = 1800,
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const apuntado = yield* Ref.make<Apuntado>({ leidas: [], fallos: [], aMitad: [] });
    // Las líneas de aviso del diario.
    const avisos: Array<string> = [];
    const diario = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") avisos.push([message].flat().join(" "));
    });
    const cliente: OpcionesCliente = opcionesClienteDeFichas(OPCIONES, opciones);
    const fibra = yield* Effect.gen(function* () {
      const extractor = yield* ExtractorPorCajas;
      return yield* leerFichasEnLaVentana({
        cola,
        opciones,
        inicio: 0,
        ficha: extractor.ficha,
        aplicar: (clave) =>
          Effect.as(
            Ref.update(apuntado, (a) => ({ ...a, leidas: [...a.leidas, clave] })),
            true,
          ),
        fallar: (clave, fallo) =>
          Ref.update(apuntado, (a) => ({ ...a, fallos: [...a.fallos, [clave, fallo] as const] })),
        aMitad: Effect.flatMap(
          Effect.clockWith((reloj) => reloj.currentTimeMillis),
          (en) => Ref.update(apuntado, (a) => ({ ...a, aMitad: [...a.aMitad, en] })),
        ),
      });
    }).pipe(
      Effect.provide(
        capaPorCajas(OPCIONES, cliente).pipe(
          Layer.provide(clienteDePrueba(peticiones, responder, latencia)),
        ),
      ),
      Effect.provide(Logger.layer([diario])),
      Effect.forkChild,
    );
    const hechas = yield* esperarConReloj(fibra, segundos);
    return {
      hechas,
      peticiones: (yield* Ref.get(peticiones)).filter((p) => p.ruta !== "/robots.txt"),
      apuntado: yield* Ref.get(apuntado),
      avisos,
    };
  });

/** El geoportal con una ficha grabada para todas, salvo lo que diga `otra`. */
const geoportal =
  (
    html: Uint8Array<ArrayBuffer>,
    otra: (codigo: string) => Respondedor | undefined = () => undefined,
  ) =>
  (url: URL, intento: number) => {
    if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
    const codigo = url.searchParams.get("emplazamiento") ?? "";
    return otra(codigo)?.(url, intento) ?? { estado: 200, cuerpo: html };
  };

const fichaGrabada = Effect.map(
  leerMuestra("detalle-telefonica-0800942.iso-8859-1.html"),
  (bytes) => new Uint8Array(bytes),
);

describe("lectura de fichas en la ventana (fichas grabadas y reloj de prueba)", () => {
  it.effect(
    "va a su ritmo, para al cerrar la ventana, deja el resto pendiente y publica a mitad",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        const opciones = {
          ...OPCIONES_FICHAS,
          ritmo: Duration.seconds(5),
          ventana: Duration.minutes(1),
        };
        const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
          colaDe(30),
          geoportal(html),
          opciones,
        );
        const instantes = peticiones.map((p) => p.en);
        // robots.txt a las 0; la primera ficha a los 5 s y luego una cada 5 s, la última a los 55.
        assert.deepStrictEqual(
          instantes,
          Array.from({ length: 11 }, (_, i) => (i + 1) * 5000),
        );
        assert.isTrue(peticiones.every((p) => p.userAgent === OPCIONES.userAgent));
        assert.strictEqual(hechas.leidas, 11);
        assert.strictEqual(hechas.pendientes, 19);
        assert.strictEqual(hechas.parada, "ventana cerrada a las 00:01:00 UTC");
        assert.deepStrictEqual(hechas.errores, []);
        // Las leídas son las primeras de la cola, en orden.
        assert.deepStrictEqual(
          apuntado.leidas,
          Array.from(
            { length: 11 },
            (_, i) => `TELEFONICA MOVILES ESPAÑA, S.A.U. - ${800_000 + i}`,
          ),
        );
        // Una publicación, tras la primera ficha leída pasados los 30 s.
        assert.deepStrictEqual(apuntado.aMitad, [30_000]);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "con los valores por defecto lee unas 5.500 fichas en una noche y deja el resto",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        // El geoportal tarda 0,9 s en contestar una ficha, como en la investigación.
        const { hechas, peticiones } = yield* leerContraElGeoportal(
          colaDe(8000),
          geoportal(html),
          OPCIONES_FICHAS,
          Duration.millis(900),
          7 * 3600,
        );
        assert.isAtLeast(hechas.leidas, 5300);
        assert.isAtMost(hechas.leidas, 5700);
        assert.strictEqual(hechas.pendientes, 8000 - hechas.leidas);
        assert.strictEqual(hechas.parada, "ventana cerrada a las 06:00:00 UTC");
        // Nunca menos de 3 s entre el final de una ficha y la siguiente, y ninguna tras el cierre.
        const huecos = peticiones.slice(1).map((p, i) => p.en - (peticiones[i]?.en ?? 0));
        assert.isAtLeast(Math.min(...huecos), 3900);
        assert.isBelow(peticiones.at(-1)?.en ?? Infinity, 6 * 3_600_000);
      }).pipe(Effect.provide(NodeServices.layer)),
    // Son 25.200 pasos del reloj de prueba y unas 5.500 fichas analizadas.
    120_000,
  );

  it.effect(
    "a una por segundo, cada ficha espera 1 s desde el final de la anterior, de una en una",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        // El geoportal tarda 0,9 s en contestar: una ficha empieza 1,9 s después de la anterior.
        const { hechas, peticiones } = yield* leerContraElGeoportal(
          colaDe(100),
          geoportal(html),
          { ...A_UN_SEGUNDO, ventana: Duration.minutes(1) },
          Duration.millis(900),
        );
        const instantes = peticiones.map((p) => p.en);
        assert.deepStrictEqual(
          instantes,
          Array.from({ length: instantes.length }, (_, i) => 1900 + i * 1900),
        );
        assert.strictEqual(hechas.leidas, 31);
        assert.strictEqual(hechas.pendientes, 69);
        assert.strictEqual(hechas.parada, "ventana cerrada a las 00:01:00 UTC");
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "un 401 o un 403 paran las fichas de la noche sin insistir y quedan en los errores",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        for (const estado of [401, 403]) {
          const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
            colaDe(10),
            geoportal(html, (codigo) =>
              codigo === "800002" ? () => ({ estado, cuerpo: "Forbidden" }) : undefined,
            ),
            A_UN_SEGUNDO,
          );
          assert.strictEqual(peticiones.length, 3);
          assert.strictEqual(hechas.leidas, 2);
          assert.strictEqual(hechas.pendientes, 7);
          assert.include(hechas.parada ?? "", `FuenteBloqueada: HTTP ${estado}`);
          assert.deepStrictEqual(hechas.errores, [
            `Fichas paradas hasta la próxima noche: FuenteBloqueada: HTTP ${estado} ` +
              "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800002)",
          ]);
          // El bloqueo no es culpa de esa ficha: no se la hace esperar.
          assert.deepStrictEqual(apuntado.fallos, []);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un 429 para las fichas de la noche sin reintentar y queda en los errores", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, (codigo) =>
          codigo === "800002" ? () => ({ estado: 429, cuerpo: "" }) : undefined,
        ),
        A_UN_SEGUNDO,
      );
      assert.strictEqual(peticiones.length, 3);
      assert.strictEqual(hechas.leidas, 2);
      assert.strictEqual(hechas.pendientes, 7);
      assert.deepStrictEqual(hechas.errores, [
        "Fichas paradas hasta la próxima noche: FuentePideEsperar: HTTP 429 " +
          "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800002)",
      ]);
      assert.deepStrictEqual(apuntado.fallos, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un 503 que pide esperar una hora para las fichas de la noche sin reintentar", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, (codigo) =>
          codigo === "800000"
            ? () => ({ estado: 503, cuerpo: "", cabeceras: { "retry-after": "3600" } })
            : undefined,
        ),
        A_UN_SEGUNDO,
      );
      assert.strictEqual(peticiones.length, 1);
      assert.strictEqual(hechas.leidas, 0);
      assert.strictEqual(hechas.pendientes, 9);
      assert.strictEqual(
        hechas.parada,
        "FuentePideEsperar: HTTP 503, pide esperar 3600 s " +
          "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800000)",
      );
      assert.strictEqual(hechas.errores.length, 1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("si pide esperar poco, espera lo que pide y sigue al mismo ritmo", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones } = yield* leerContraElGeoportal(
        colaDe(4),
        geoportal(html, (codigo) =>
          codigo === "800001"
            ? (_, intento) =>
                intento === 0
                  ? { estado: 429, cuerpo: "", cabeceras: { "retry-after": "20" } }
                  : { estado: 200, cuerpo: html }
            : undefined,
        ),
        A_UN_SEGUNDO,
      );
      // 800000 a 1 s; 800001 a 2 s pide esperar 20 s, se repite a 22 s y las demás siguen a 1 s.
      assert.deepStrictEqual(
        peticiones.map((p) => p.en),
        [1000, 2000, 22_000, 23_000, 24_000],
      );
      assert.strictEqual(hechas.leidas, 4);
      assert.strictEqual(hechas.parada, undefined);
      assert.deepStrictEqual(hechas.errores, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("si sigue pidiendo esperar tras los reintentos, para las fichas de la noche", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones } = yield* leerContraElGeoportal(
        colaDe(5),
        geoportal(html, () => () => ({
          estado: 429,
          cuerpo: "",
          cabeceras: { "retry-after": "30" },
        })),
        A_UN_SEGUNDO,
      );
      assert.strictEqual(peticiones.length, 1 + OPCIONES.reintentos);
      // Cada reintento, 30 s después del anterior: lo que pide, más que la espera exponencial.
      const huecos = peticiones.slice(1).map((p, i) => p.en - (peticiones[i]?.en ?? 0));
      assert.deepStrictEqual(huecos, [30_000, 30_000, 30_000]);
      assert.strictEqual(hechas.leidas, 0);
      assert.include(hechas.parada ?? "", "FuentePideEsperar: HTTP 429, pide esperar 30 s");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("una página que no es una ficha también para las fichas de la noche", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, () => () => ({
          estado: 200,
          cuerpo: "<html><body>Su petición ha sido bloqueada</body></html>",
        })),
        A_UN_SEGUNDO,
      );
      assert.strictEqual(peticiones.length, 1);
      assert.strictEqual(hechas.leidas, 0);
      assert.include(hechas.parada ?? "", "FuenteBloqueada");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "tres fichas sin ficha en el registro seguidas paran la noche, y cada una espera un día",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        const noValido = new Uint8Array(
          yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
        );
        const malas = new Set(["800001", "800003", "800004", "800005"]);
        const { hechas, apuntado, avisos } = yield* leerContraElGeoportal(
          colaDe(10).map((f) =>
            f.registro.codigo === "800003" ? { ...f, fallos: 2, leidaEn: null } : f,
          ),
          geoportal(html, (codigo) =>
            malas.has(codigo) ? () => ({ estado: 200, cuerpo: noValido }) : undefined,
          ),
          A_UN_SEGUNDO,
        );
        // 800001 falla y 800002 se lee: el fallo no era seguido. 800003, 800004 y 800005, sí.
        assert.strictEqual(hechas.leidas, 2);
        assert.strictEqual(hechas.pendientes, 4);
        assert.strictEqual(hechas.parada, "3 fallos seguidos");
        const motivo = "SinFichaEnElRegistro: La ficha dice «Código de emplazamiento no válido»";
        assert.deepStrictEqual(
          hechas.fallidas.map((f) => [f.clave.slice(-6), f.motivo, f.intento]),
          [
            ["800001", motivo, 1],
            ["800003", motivo, 3],
            ["800004", motivo, 1],
            ["800005", motivo, 1],
          ],
        );
        // Los errores de la ejecución nombran cada ficha con su motivo.
        assert.strictEqual(hechas.errores.length, 5);
        assert.strictEqual(
          hechas.errores[0],
          `Ficha TELEFONICA MOVILES ESPAÑA, S.A.U. - 800001: ${motivo} ` +
            "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800001)",
        );
        assert.strictEqual(
          hechas.errores.at(-1),
          "Fichas paradas hasta la próxima noche: 3 fallos seguidos",
        );
        assert.deepStrictEqual(
          apuntado.fallos.map(([clave, fallo]) => [
            clave.slice(-6),
            fallo.fallos,
            fallo.sinFichaEnRegistro,
          ]),
          [
            ["800001", 1, 0],
            ["800003", 3, 0],
            ["800004", 1, 0],
            ["800005", 1, 0],
          ],
        );
        for (const [, fallo] of apuntado.fallos) {
          assert.include(fallo.motivo, "Código de emplazamiento no válido");
        }
        // Una línea de aviso en el diario por ficha, con su clave, su URL, el motivo, el intento
        // y cuándo se vuelve a pedir: un día después la primera vez, cuatro a la tercera.
        assert.strictEqual(avisos.length, 4);
        assert.match(
          avisos[0] ?? "",
          /^Ficha fallida, intento 1: TELEFONICA MOVILES ESPAÑA, S\.A\.U\. - 800001 \(https:\/\/geoportal\.minetur\.gob\.es\/VCTEL\/detalleEstacion\.do\?emplazamiento=800001\): SinFichaEnElRegistro: La ficha dice «Código de emplazamiento no válido»; se vuelve a pedir desde 1970-01-02 00:00:0\d UTC$/u,
        );
        assert.match(avisos[1] ?? "", /intento 3: .* - 800003 .*desde 1970-01-05 00:00:\d\d UTC$/u);
        // Cada una espera un día desde que falló.
        const [primero] = apuntado.fallos;
        assert.isDefined(primero);
        assert.isAtLeast(primero[1].esperaHasta, DIA);
        assert.isBelow(primero[1].esperaHasta, DIA + 60_000);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("una ficha ilegible espera, pero no se da por sin ficha en el registro", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, apuntado, avisos } = yield* leerContraElGeoportal(
        colaDe(3),
        geoportal(html, (codigo) =>
          codigo === "800001"
            ? () => ({ estado: 200, cuerpo: "<table id=tablaDetalleEstacion></table>" })
            : undefined,
        ),
        A_UN_SEGUNDO,
      );
      assert.strictEqual(hechas.leidas, 2);
      assert.deepStrictEqual(
        apuntado.fallos.map(([clave, fallo]) => [clave.slice(-6), fallo.sinFichaEnRegistro]),
        [["800001", undefined]],
      );
      assert.lengthOf(avisos, 1);
      assert.include(avisos[0] ?? "", "RespuestaInesperada: La ficha no tiene la tabla");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("una fuente que no responde cuenta como fallo, pero no hace esperar a la ficha", () =>
    Effect.gen(function* () {
      const { hechas, peticiones, apuntado, avisos } = yield* leerContraElGeoportal(
        colaDe(5),
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 503, cuerpo: "" }),
        A_UN_SEGUNDO,
      );
      // Tres fichas, cada una con su petición y sus tres reintentos.
      assert.strictEqual(peticiones.length, 3 * (1 + OPCIONES.reintentos));
      assert.strictEqual(hechas.parada, "3 fallos seguidos");
      assert.deepStrictEqual(apuntado.fallos, []);
      // Cada una deja su línea en el diario, aunque no apunte espera.
      assert.lengthOf(avisos, 3);
      assert.match(
        avisos[0] ?? "",
        /^Ficha fallida, intento 1: .* - 800000 \(https:.*\): FuenteNoDisponible: .*; no espera: vuelve a la cola la noche siguiente$/u,
      );
      assert.deepStrictEqual(
        hechas.fallidas.map((f) => f.esperaHasta),
        [undefined, undefined, undefined],
      );
    }),
  );

  it.effect("con un tope de fichas no pasa de él", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones } = yield* leerContraElGeoportal(colaDe(10), geoportal(html), {
        ...OPCIONES_FICHAS,
        maximo: 4,
      });
      assert.strictEqual(peticiones.length, 4);
      assert.strictEqual(hechas.leidas, 4);
      assert.strictEqual(hechas.parada, "tope de 4 fichas");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
