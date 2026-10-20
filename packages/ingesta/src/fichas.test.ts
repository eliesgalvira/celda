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

import { RECIENTE } from "./barrido.ts";
import type { OpcionesCliente } from "./cliente.ts";
import { ExtractorPorCajas } from "./extractor.ts";
import {
  type FalloDeFicha,
  type FichaEnCola,
  leerFichasEnLaVentana,
  OPCIONES_FICHAS,
  opcionesClienteDeFichas,
  type OpcionesFichas,
  ordenarFichas,
  pendientesPorZona,
  resumirCola,
  SIN_FICHA_SEGUIDAS,
} from "./fichas.ts";
import { leerMuestra } from "./pruebas/grabado.ts";
import { clienteDePrueba, NO_HAY_ROBOTS, type Peticion, type Respondedor } from "./pruebas/http.ts";
import { esperarConReloj } from "./pruebas/reloj.ts";
import { capaPorCajas, OPCIONES } from "./registro-oficial/extractor.ts";

const DIA = 86_400_000;
const AHORA = Date.UTC(2026, 10, 7, 0, 0);

/** Dos zonas de un cuadro cada una, como las de barrido. */
const CATALUNA: ZonaDeBarrido = {
  nombre: "cataluna",
  titulo: "Cataluña",
  comunidades: ["09"],
  cuadros: ["2,41"],
};
const CENTRO: ZonaDeBarrido = {
  nombre: "centro",
  titulo: "Centro",
  comunidades: ["13"],
  cuadros: ["-4,40"],
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
  it("primero las nuevas y las de listado cambiado, en el orden en que llegaron, y luego las demás de la leída hace más tiempo a la más reciente, en toda España", () => {
    // Llegan en otro orden del que se leen, de cinco sitios y con lecturas de varios meses.
    const cola = [
      ficha("barcelona-hace-1-mes", BARCELONA, { leidaEn: AHORA - 30 * DIA }),
      ficha("lisboa-nueva", LISBOA),
      ficha("madrid-hace-2-meses", MADRID, { leidaEn: AHORA - 61 * DIA }),
      ficha("barcelona-nueva", BARCELONA),
      ficha("valencia-hace-1-mes", VALENCIA, { leidaEn: AHORA - 29 * DIA }),
      ficha("girona-hace-3-meses", GIRONA, { leidaEn: AHORA - 92 * DIA }),
      ficha("madrid-nueva", MADRID),
    ];
    assert.deepStrictEqual(nombres(ordenarFichas(cola, AHORA)), [
      "lisboa-nueva",
      "barcelona-nueva",
      "madrid-nueva",
      "girona-hace-3-meses",
      "madrid-hace-2-meses",
      "barcelona-hace-1-mes",
      "valencia-hace-1-mes",
    ]);
  });

  it("ninguna zona ni provincia va por delante: Barcelona y Madrid leídas a la vez van en el orden en que llegaron", () => {
    const leida = AHORA - 30 * DIA;
    const madrid = ficha("madrid", MADRID, { leidaEn: leida });
    const barcelona = ficha("barcelona", BARCELONA, { leidaEn: leida });
    const girona = ficha("girona", GIRONA, { leidaEn: leida });
    assert.deepStrictEqual(nombres(ordenarFichas([barcelona, girona, madrid], AHORA)), [
      "madrid",
      "barcelona",
      "girona",
    ]);
    // El orden no depende del de la lista.
    assert.deepStrictEqual(nombres(ordenarFichas([girona, madrid, barcelona], AHORA)), [
      "madrid",
      "barcelona",
      "girona",
    ]);
  });

  it("cada ficha sale una vez, aunque la cola la traiga repetida", () => {
    const nueva = ficha("nueva", BARCELONA);
    const vieja = ficha("vieja", MADRID, { leidaEn: AHORA - 30 * DIA });
    const orden = ordenarFichas([nueva, vieja, nueva, { ...vieja, orden: 0 }], AHORA);
    assert.deepStrictEqual(nombres(orden), ["nueva", "vieja"]);
  });

  it("una ficha que espera tras fallar se queda fuera hasta que pasa su espera", () => {
    const cola = [
      ficha("espera", BARCELONA, { fallos: 1, esperaHasta: AHORA + DIA }),
      ficha("ya-puede", BARCELONA, { fallos: 2, esperaHasta: AHORA - 1 }),
      ficha("normal", MADRID),
    ];
    assert.deepStrictEqual(nombres(ordenarFichas(cola, AHORA)), ["ya-puede", "normal"]);
    assert.deepStrictEqual(nombres(ordenarFichas(cola, AHORA + DIA + 1)), [
      "espera",
      "ya-puede",
      "normal",
    ]);
  });

  it("el resumen dice cuántas quedan en la cola, y en cada zona de barrido", () => {
    const cola = [
      ficha("a", BARCELONA),
      ficha("b", BARCELONA, { leidaEn: AHORA - 40 * DIA }),
      ficha("c", BARCELONA, { fallos: 1, esperaHasta: AHORA + DIA }),
      ficha("d", MADRID),
      ficha("e", LISBOA),
    ];
    assert.deepStrictEqual(resumirCola(cola, AHORA), { nuevas: 3, porReleer: 1, enEspera: 1 });
    assert.deepStrictEqual(
      [...pendientesPorZona(cola, [CATALUNA, CENTRO, CATALUNA], AHORA)],
      [
        ["cataluna", { nuevas: 1, porReleer: 1, enEspera: 1 }],
        ["centro", { nuevas: 1, porReleer: 0, enEspera: 0 }],
      ],
    );
  });

  it("el cliente de las fichas va a su ritmo, 1 s por defecto y nunca menos, con un tope que cabe en la ventana", () => {
    const cliente = opcionesClienteDeFichas(OPCIONES, OPCIONES_FICHAS);
    assert.strictEqual(Duration.toSeconds(cliente.pausa), 1);
    // Las 22 horas de la ventana por defecto, a una por segundo.
    assert.strictEqual(cliente.maxPeticiones, 79_200);
    assert.strictEqual(cliente.userAgent, OPCIONES.userAgent);
    const despacio = opcionesClienteDeFichas(OPCIONES, {
      ...OPCIONES_FICHAS,
      ritmo: Duration.seconds(3),
      ventana: Duration.hours(6),
    });
    assert.strictEqual(Duration.toSeconds(despacio.pausa), 3);
    assert.strictEqual(despacio.maxPeticiones, 7200);
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

/** Las fichas al ritmo de producción, una por segundo, el de por defecto. */
const A_UN_SEGUNDO: OpcionesFichas = OPCIONES_FICHAS;

/** `n` fichas nuevas de Barcelona. */
const colaDe = (n: number) =>
  Array.from({ length: n }, (_, i) => ficha(String(800_000 + i), BARCELONA));

/**
 * Lee `cola` con el extractor real sobre el geoportal de prueba y el reloj de prueba, empezando
 * la ejecución a las 0, y apunta cada petición, lo guardado y cuándo se publica a mitad. Una
 * ficha que falla espera lo que dura una ronda, como en producción.
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
        espera: RECIENTE,
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
        Layer.merge(
          capaPorCajas(OPCIONES, cliente).pipe(
            Layer.provide(clienteDePrueba(peticiones, responder, latencia)),
          ),
          Logger.layer([diario]),
        ),
      ),
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
    "al ritmo medido en producción, 0,1 s de respuesta y 1 s de pausa, sale una ficha cada 1,1 s, y en la ventana por defecto caben las de toda España",
    () =>
      Effect.gen(function* () {
        const html = yield* fichaGrabada;
        // Una hora de la ventana. El geoportal contestaba en unos 0,1 s el 07/10/2026.
        const { hechas, peticiones } = yield* leerContraElGeoportal(
          colaDe(4000),
          geoportal(html),
          { ...OPCIONES_FICHAS, ventana: Duration.hours(1) },
          Duration.millis(100),
          3700,
        );
        const huecos = peticiones.slice(1).map((p, i) => p.en - (peticiones[i]?.en ?? 0));
        assert.deepStrictEqual(new Set(huecos), new Set([1100]));
        assert.strictEqual(hechas.leidas, Math.floor((3_600_000 - 1100) / 1100) + 1);
        assert.strictEqual(hechas.pendientes, 4000 - hechas.leidas);
        assert.strictEqual(hechas.parada, "ventana cerrada a las 01:00:00 UTC");
        // A ese ritmo, las 22 horas de la ventana por defecto dan para unas 72.000 fichas, más
        // que las unas 69.700 de España, y las 500 del diario del 07/10/2026 tardan 9 min 10 s.
        const porVentana = Duration.toMillis(OPCIONES_FICHAS.ventana) / 1100;
        assert.isAbove(porVentana, 69_700);
        assert.strictEqual(Math.round((500 * 1100) / 1000), 9 * 60 + 10);
      }).pipe(Effect.provide(NodeServices.layer)),
    // Son 3.700 pasos del reloj de prueba y unas 3.300 fichas analizadas.
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
    "un 401 o un 403 paran las fichas de la ejecución sin insistir y quedan en los errores",
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
            `Fichas paradas: FuenteBloqueada: HTTP ${estado} ` +
              "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800002)",
          ]);
          // El bloqueo no es culpa de esa ficha: no se la hace esperar.
          assert.deepStrictEqual(apuntado.fallos, []);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un 429 para las fichas de la ejecución sin reintentar y queda en los errores", () =>
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
        "Fichas paradas: FuentePideEsperar: HTTP 429 " +
          "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800002)",
      ]);
      assert.deepStrictEqual(apuntado.fallos, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un 503 que pide esperar una hora para las fichas de la ejecución sin reintentar", () =>
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

  it.effect("si sigue pidiendo esperar tras los reintentos, para las fichas de la ejecución", () =>
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

  it.effect("una página que no es una ficha también para las fichas de la ejecución", () =>
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
    "tres fichas sin ficha en el registro seguidas no paran la ejecución, y cada una espera a la ronda siguiente",
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
        // 800003, 800004 y 800005 van seguidas, pero lo que dice el registro no es un fallo de la
        // fuente: la ejecución sigue y lee las demás.
        assert.strictEqual(hechas.leidas, 6);
        assert.strictEqual(hechas.pendientes, 0);
        assert.strictEqual(hechas.parada, undefined);
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
        assert.strictEqual(hechas.errores.length, 4);
        assert.strictEqual(
          hechas.errores[0],
          `Ficha TELEFONICA MOVILES ESPAÑA, S.A.U. - 800001: ${motivo} ` +
            "(https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=800001)",
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
        // y cuándo se vuelve a pedir: día y medio después, en la ronda siguiente, sea el intento
        // que sea. La ejecución del domingo no la repite.
        assert.strictEqual(avisos.length, 4);
        assert.match(
          avisos[0] ?? "",
          /^Ficha fallida, intento 1: TELEFONICA MOVILES ESPAÑA, S\.A\.U\. - 800001 \(https:\/\/geoportal\.minetur\.gob\.es\/VCTEL\/detalleEstacion\.do\?emplazamiento=800001\): SinFichaEnElRegistro: La ficha dice «Código de emplazamiento no válido»; se vuelve a pedir desde 1970-01-02 12:00:0\d UTC$/u,
        );
        assert.match(avisos[1] ?? "", /intento 3: .* - 800003 .*desde 1970-01-02 12:00:\d\d UTC$/u);
        // Cada una espera día y medio desde que falló.
        const [primero] = apuntado.fallos;
        assert.isDefined(primero);
        assert.isAtLeast(primero[1].esperaHasta, Duration.toMillis(RECIENTE));
        assert.isBelow(primero[1].esperaHasta, Duration.toMillis(RECIENTE) + 60_000);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    `${SIN_FICHA_SEGUIDAS} fichas seguidas sin ficha en el registro paran la ejecución: puede que haya cambiado la URL`,
    () =>
      Effect.gen(function* () {
        const noValido = new Uint8Array(
          yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
        );
        const { hechas, peticiones, apuntado } = yield* leerContraElGeoportal(
          colaDe(SIN_FICHA_SEGUIDAS + 5),
          geoportal(noValido),
          A_UN_SEGUNDO,
        );
        assert.strictEqual(peticiones.length, SIN_FICHA_SEGUIDAS);
        assert.strictEqual(hechas.fallidas.length, SIN_FICHA_SEGUIDAS);
        assert.strictEqual(hechas.pendientes, 5);
        const motivo =
          `${SIN_FICHA_SEGUIDAS} fichas seguidas dicen «Código de emplazamiento no válido»: ` +
          "puede que haya cambiado la URL de la ficha del registro o el formato de sus códigos";
        assert.strictEqual(hechas.parada, motivo);
        assert.strictEqual(hechas.errores.at(-1), `Fichas paradas: ${motivo}`);
        // La racha entera es sospechosa: ninguna queda sin ficha en el registro, pero todas
        // esperan y se reintentan como cualquier fallo.
        assert.strictEqual(apuntado.fallos.length, SIN_FICHA_SEGUIDAS);
        for (const [, fallo] of apuntado.fallos) {
          assert.isUndefined(fallo.sinFichaEnRegistro);
          assert.strictEqual(fallo.fallos, 1);
          assert.isAtLeast(fallo.esperaHasta, Duration.toMillis(RECIENTE));
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("una ficha sin ficha en el registro entre dos fallos ni los suma ni los corta", () =>
    Effect.gen(function* () {
      const html = yield* fichaGrabada;
      const noValido = new Uint8Array(
        yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
      );
      const ilegible = "<table id=tablaDetalleEstacion></table>";
      const respuestas = new Map<string, string | Uint8Array<ArrayBuffer>>([
        ["800000", ilegible],
        ["800001", noValido],
        ["800002", ilegible],
        ["800003", ilegible],
      ]);
      const { hechas, peticiones } = yield* leerContraElGeoportal(
        colaDe(10),
        geoportal(html, (codigo) => {
          const cuerpo = respuestas.get(codigo);
          return cuerpo === undefined ? undefined : () => ({ estado: 200, cuerpo });
        }),
        A_UN_SEGUNDO,
      );
      // Ilegible, sin ficha, ilegible: dos fallos seguidos, y la ejecución sigue. El tercero, para.
      assert.strictEqual(peticiones.length, 4);
      assert.strictEqual(hechas.leidas, 0);
      assert.strictEqual(hechas.parada, "3 fallos seguidos");
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
        /^Ficha fallida, intento 1: .* - 800000 \(https:.*\): FuenteNoDisponible: .*; no espera: vuelve a la cola en la ejecución siguiente$/u,
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
