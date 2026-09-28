// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Coordenada } from "@celda/dominio/area";
import type { ZonaDeBarrido } from "@celda/dominio/barrido";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

  it("el cliente de las fichas va a su ritmo, nunca a menos de 3 s, con un tope que cabe en la ventana", () => {
    const cliente = opcionesClienteDeFichas(OPCIONES, OPCIONES_FICHAS);
    assert.strictEqual(Duration.toSeconds(cliente.pausa), 3);
    assert.strictEqual(cliente.maxPeticiones, 7200);
    assert.strictEqual(cliente.userAgent, OPCIONES.userAgent);
    const despacio = opcionesClienteDeFichas(OPCIONES, {
      ...OPCIONES_FICHAS,
      ritmo: Duration.seconds(10),
    });
    assert.strictEqual(Duration.toSeconds(despacio.pausa), 10);
    const deprisa = opcionesClienteDeFichas(OPCIONES, {
      ...OPCIONES_FICHAS,
      ritmo: Duration.seconds(1),
    });
    assert.strictEqual(Duration.toSeconds(deprisa.pausa), 3);
  });
});

/** Lo que la lectura ha apuntado en la «base»: bandas guardadas, fallos y publicaciones. */
interface Apuntado {
  readonly leidas: ReadonlyArray<string>;
  readonly fallos: ReadonlyArray<readonly [string, FalloDeFicha]>;
  readonly aMitad: ReadonlyArray<number>;
}

/** `n` fichas nuevas de Barcelona. */
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
      Effect.forkChild,
    );
    const hechas = yield* esperarConReloj(fibra, segundos);
    return {
      hechas,
      peticiones: (yield* Ref.get(peticiones)).filter((p) => p.ruta !== "/robots.txt"),
      apuntado: yield* Ref.get(apuntado),
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

  it.effect("un 403 para las fichas de la noche sin insistir y queda en los errores", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, (codigo) =>
          codigo === "800002" ? () => ({ estado: 403, cuerpo: "Forbidden" }) : undefined,
        ),
        OPCIONES_FICHAS,
      );
      assert.strictEqual(peticiones.length, 3);
      assert.strictEqual(hechas.leidas, 2);
      assert.strictEqual(hechas.pendientes, 7);
      assert.include(hechas.parada ?? "", "FuenteBloqueada: HTTP 403");
      assert.deepStrictEqual(hechas.errores, [
        "Fichas paradas hasta la próxima noche: FuenteBloqueada: HTTP 403 " +
          "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800002)",
      ]);
      // El bloqueo no es culpa de esa ficha: no se la hace esperar.
      assert.deepStrictEqual(apuntado.fallos, []);
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
        OPCIONES_FICHAS,
      );
      assert.strictEqual(peticiones.length, 1);
      assert.strictEqual(hechas.leidas, 0);
      assert.include(hechas.parada ?? "", "FuenteBloqueada");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("tres fichas ilegibles seguidas paran la noche, y cada una espera un día", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const noValido = new Uint8Array(
        yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
      );
      const malas = new Set(["800001", "800003", "800004", "800005"]);
      const { hechas, apuntado } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, (codigo) =>
          malas.has(codigo) ? () => ({ estado: 200, cuerpo: noValido }) : undefined,
        ),
        OPCIONES_FICHAS,
      );
      // 800001 falla y 800002 se lee: el fallo no era seguido. 800003, 800004 y 800005, sí.
      assert.strictEqual(hechas.leidas, 2);
      assert.strictEqual(hechas.fallidas, 4);
      assert.strictEqual(hechas.pendientes, 4);
      assert.strictEqual(hechas.parada, "3 fallos seguidos");
      assert.strictEqual(hechas.errores.length, 5);
      assert.strictEqual(
        hechas.errores.at(-1),
        "Fichas paradas hasta la próxima noche: 3 fallos seguidos",
      );
      assert.deepStrictEqual(
        apuntado.fallos.map(([clave, fallo]) => [clave.slice(-6), fallo.fallos]),
        [
          ["800001", 1],
          ["800003", 1],
          ["800004", 1],
          ["800005", 1],
        ],
      );
      for (const [, fallo] of apuntado.fallos) {
        assert.include(fallo.motivo, "Código de emplazamiento no válido");
      }
      // Cada una espera un día desde que falló.
      const [primero] = apuntado.fallos;
      assert.isDefined(primero);
      assert.isAtLeast(primero[1].esperaHasta, DIA);
      assert.isBelow(primero[1].esperaHasta, DIA + 60_000);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("una fuente que no responde cuenta como fallo, pero no hace esperar a la ficha", () =>
    Effect.gen(function* () {
      const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
        colaDe(5),
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 503, cuerpo: "" }),
        OPCIONES_FICHAS,
      );
      // Tres fichas, cada una con su petición y sus tres reintentos.
      assert.strictEqual(peticiones.length, 3 * (1 + OPCIONES.reintentos));
      assert.strictEqual(hechas.parada, "3 fallos seguidos");
      assert.deepStrictEqual(apuntado.fallos, []);
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
