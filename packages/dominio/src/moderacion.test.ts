import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { CorreccionPropuesta, Corroboracion } from "./aportacion.ts";
import type { Ficha } from "./ficha.ts";
import {
  type AceptadaParaPublicar,
  type AportacionConContexto,
  type AportacionEnCola,
  correccionesDeFicha,
  Motivo,
  proponerVeredicto,
} from "./moderacion.ts";

const ACEPTADA = Date.UTC(2026, 9, 3, 9, 0);
const CAMPUS_NORD = { longitud: 2.113628, latitud: 41.388344 };
/** Unos 120 m al este de Campus Nord. */
const AL_ESTE = { longitud: 2.115068, latitud: 41.388344 };
/** Unos 5 m más allá. */
const AL_ESTE_Y_UN_POCO = { longitud: 2.115128, latitud: 41.388344 };

let contador = 0;
const uuid = () => {
  contador += 1;
  return `00000000-0000-4000-8000-${contador.toString(16).padStart(12, "0")}`;
};

const correccion = (cambios: Partial<CorreccionPropuesta> = {}): CorreccionPropuesta => ({
  id: uuid(),
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: ACEPTADA - 3_600_000,
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  cambio: { tipo: "posicion", posicion: AL_ESTE },
  nota: null,
  ...cambios,
});

const corroboracion = (cita: string): Corroboracion => ({
  id: uuid(),
  tipo: "corroboracion",
  esquema: 1,
  creada: ACEPTADA,
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  correccion: cita,
});

const aceptada = (
  contenido: AceptadaParaPublicar["contenido"],
  persona: string,
  aceptadaEl = ACEPTADA,
): AceptadaParaPublicar => ({ id: contenido.id, persona, aceptadaEl, contenido });

const enCola = (
  contenido: AportacionEnCola["contenido"],
  cambios: Partial<AportacionEnCola> = {},
): AportacionEnCola => ({
  id: contenido.id,
  identidad: "identidad-a",
  huellaIp: null,
  recibidaEl: ACEPTADA - 60_000,
  contenido,
  estado: "pendiente",
  moderadaEl: null,
  motivo: null,
  vetada: false,
  ...cambios,
});

/** Campus Nord como está publicado: Movistar en el registro oficial. */
const FICHA: Ficha = {
  clave: "movistar-0802532",
  posicion: CAMPUS_NORD,
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0802532"],
      bandas: [],
      bandasSinLeer: true,
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532",
          fecha: ACEPTADA - 7 * 86_400_000,
          afirma: "presente",
          historial: [],
        },
      ],
    },
  ],
  datosDel: ACEPTADA - 7 * 86_400_000,
  version: ACEPTADA - 7 * 86_400_000,
};

const contexto = (
  aportacion: AportacionEnCola,
  cambios: Partial<AportacionConContexto> = {},
): AportacionConContexto => ({
  aportacion,
  emplazamiento: "movistar-0802532",
  version: "sitios@2026-09-26T02:15:00Z",
  publicado: FICHA,
  distanciaM: null,
  cercanos: [],
  historial: { aceptadas: 0, rechazadas: 0, pendientes: 0 },
  relacionadas: [],
  ...cambios,
});

describe("Motivo", () => {
  it("no admite un motivo vacío ni en blanco", () => {
    const decodificar = Schema.decodeUnknownResult(Motivo);
    assert.isTrue(Result.isFailure(decodificar("")));
    assert.isTrue(Result.isFailure(decodificar("   ")));
    assert.isTrue(Result.isFailure(decodificar("x".repeat(501))));
    assert.deepStrictEqual(
      decodificar("Se ve en la foto aérea"),
      Result.succeed("Se ve en la foto aérea"),
    );
  });
});

describe("correccionesDeFicha", () => {
  it("junta las propuestas que dicen lo mismo y cuenta cada persona una vez", () => {
    const primera = correccion();
    const igual = correccion({ cambio: { tipo: "posicion", posicion: AL_ESTE_Y_UN_POCO } });
    const repetida = correccion();
    const otra = correccion({ cambio: { tipo: "compania", compania: "vodafone", esta: false } });
    const respaldo = corroboracion(primera.id);
    const deOtroSitio = { ...corroboracion(primera.id), emplazamiento: "orange-1" };
    const aceptadas = [
      aceptada(primera, "a"),
      aceptada(igual, "b", ACEPTADA + 1000),
      // La misma persona otra vez no suma.
      aceptada(repetida, "a", ACEPTADA + 2000),
      aceptada(otra, "c", ACEPTADA + 3000),
      aceptada(respaldo, "d", ACEPTADA + 4000),
      aceptada(deOtroSitio, "e", ACEPTADA + 5000),
    ];
    const porEmplazamiento = correccionesDeFicha(aceptadas);
    assert.deepStrictEqual(porEmplazamiento.get("movistar-0802532"), [
      {
        clave: primera.id,
        cambio: primera.cambio,
        personas: 3,
        aceptadaEl: ACEPTADA,
        licencia: "CC0-1.0",
      },
      {
        clave: otra.id,
        cambio: otra.cambio,
        personas: 1,
        aceptadaEl: ACEPTADA + 3000,
        licencia: "CC0-1.0",
      },
    ]);
    assert.isFalse(porEmplazamiento.has("orange-1"));
    // El orden en que llegan no cambia nada.
    assert.deepStrictEqual(correccionesDeFicha(aceptadas.toReversed()), porEmplazamiento);
  });

  it("deja fuera los emplazamientos que faltan", () => {
    const falta = correccion({
      emplazamiento: null,
      cambio: { tipo: "falta", posicion: AL_ESTE, companias: ["orange"] },
    });
    assert.strictEqual(correccionesDeFicha([aceptada(falta, "a")]).size, 0);
  });
});

describe("proponerVeredicto", () => {
  it("rechaza una posición que no cambia nada y acepta una que sí", () => {
    const propuesta = enCola(correccion());
    assert.strictEqual(
      proponerVeredicto(contexto(propuesta, { distanciaM: 4 })).veredicto,
      "rechazar",
    );
    const aceptar = proponerVeredicto(contexto(propuesta, { distanciaM: 120 }));
    assert.strictEqual(aceptar.veredicto, "aceptar");
    assert.include(aceptar.razones[0], "120 m");
    assert.strictEqual(
      proponerVeredicto(contexto(propuesta, { distanciaM: 4000 })).veredicto,
      "mirar",
    );
  });

  it("rechaza lo que envía una identidad vetada y mira lo de quien tiene muchas rechazadas", () => {
    const propuesta = enCola(correccion());
    assert.strictEqual(
      proponerVeredicto(contexto({ ...propuesta, vetada: true }, { distanciaM: 120 })).veredicto,
      "rechazar",
    );
    const dudosa = proponerVeredicto(
      contexto(propuesta, {
        distanciaM: 120,
        historial: { aceptadas: 1, rechazadas: 4, pendientes: 0 },
      }),
    );
    assert.strictEqual(dudosa.veredicto, "mirar");
    assert.include(dudosa.razones.at(-1), "1 aceptadas y 4 rechazadas");
  });

  it("compara una compañía con lo que dice el registro oficial", () => {
    const yaEsta = enCola(
      correccion({ cambio: { tipo: "compania", compania: "movistar", esta: true } }),
    );
    assert.strictEqual(proponerVeredicto(contexto(yaEsta)).veredicto, "rechazar");
    const noEsta = enCola(
      correccion({ cambio: { tipo: "compania", compania: "movistar", esta: false } }),
    );
    assert.strictEqual(proponerVeredicto(contexto(noEsta)).veredicto, "aceptar");
  });

  it("pide otra identidad para dar un emplazamiento por desaparecido", () => {
    const sola = enCola(correccion({ cambio: { tipo: "ya-no-existe" } }));
    assert.strictEqual(proponerVeredicto(contexto(sola)).veredicto, "mirar");
    const otra = enCola(correccion({ cambio: { tipo: "ya-no-existe" } }), {
      identidad: "identidad-b",
    });
    assert.strictEqual(
      proponerVeredicto(contexto(sola, { relacionadas: [otra] })).veredicto,
      "aceptar",
    );
  });

  it("rechaza un emplazamiento que falta si ya hay uno publicado en el sitio", () => {
    const falta = enCola(
      correccion({
        emplazamiento: null,
        cambio: { tipo: "falta", posicion: AL_ESTE, companias: ["orange"] },
      }),
    );
    const publicado = {
      clave: "orange-1",
      posicion: AL_ESTE,
      companias: ["orange" as const],
      metros: 3,
    };
    const veredicto = proponerVeredicto(
      contexto(falta, { emplazamiento: null, publicado: null, cercanos: [publicado] }),
    );
    assert.strictEqual(veredicto.veredicto, "rechazar");
    assert.include(veredicto.razones[0], "orange-1");
  });

  it("acepta una corroboración de una corrección publicada, salvo si esa identidad ya cuenta", () => {
    const publicada = correccion();
    const ficha: Ficha = {
      ...FICHA,
      correcciones: [
        {
          clave: publicada.id,
          cambio: publicada.cambio,
          personas: 1,
          aceptadaEl: ACEPTADA,
          licencia: "CC0-1.0",
        },
      ],
    };
    const respaldo = enCola(corroboracion(publicada.id));
    assert.strictEqual(
      proponerVeredicto(contexto(respaldo, { publicado: ficha })).veredicto,
      "aceptar",
    );
    const suya = enCola(publicada, { estado: "aceptada", moderadaEl: ACEPTADA });
    assert.strictEqual(
      proponerVeredicto(contexto(respaldo, { publicado: ficha, relacionadas: [suya] })).veredicto,
      "rechazar",
    );
    assert.strictEqual(proponerVeredicto(contexto(respaldo)).veredicto, "rechazar");
  });
});
