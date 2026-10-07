import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import type { FichaCruda, ListadoCrudo, Registro } from "./extractor.ts";
import { type ObservacionGuardada, trasAusencia, trasFicha, trasListado } from "./guardado.ts";
import { datosDeHecho, type HechoNuevo } from "./hecho.ts";
import {
  type FichasDeLasPaginas,
  type HechoLeido,
  hechosDeFicha,
  leerHecho,
  registroPublicado,
  repetirHechos,
} from "./hechos.ts";
import { leerFicha, registroDeCrudo } from "./registro-oficial/normalizar.ts";

const DIA = 86_400_000;
const NOCHE = Date.UTC(2026, 9, 1, 2, 15);

const CRUDO: ListadoCrudo = {
  id: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800143",
  gisId: "0800143",
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  longitud: 2.11,
  latitud: 41.39,
};

const registroDe = (crudo: ListadoCrudo): Registro => {
  const leido = registroDeCrudo(crudo);
  if (leido.tipo !== "registro") return assert.fail(`${crudo.id} no es de una compañía`);
  return leido.registro;
};

const CRUDA: FichaCruda = {
  caracteristicas: [
    {
      operador: "TELEFONICA MOVILES ESPAÑA, S.A.U.",
      referencia: "B B -2601294",
      bandaMhz: "1845.10 - 1855.10",
    },
  ],
  niveles: [{ distancia: "47.0", acimut: "1.0", valor: "0.46922" }],
};

const leidaDe = (cruda: FichaCruda) => {
  const html =
    '<table class="tablaDetalleEstacion">CARACTERISTICAS' +
    cruda.caracteristicas
      .map((f) => `<tr><td>${f.operador}</td><td>${f.referencia}</td><td>${f.bandaMhz}</td></tr>`)
      .join("") +
    "</table>NIVELES MEDIDOS<table>" +
    cruda.niveles
      .map((f) => `<tr><td>${f.distancia}</td><td>${f.acimut}</td><td>${f.valor}</td></tr>`)
      .join("") +
    "</table>";
  const leida = leerFicha(html);
  if (Result.isFailure(leida)) return assert.fail(leida.failure);
  return leida.success;
};

/** Repite una lista de hechos como los guardaría la base, leídos con su forma. */
const repetir = (
  hechos: ReadonlyArray<readonly [number, HechoNuevo]>,
  paginas: FichasDeLasPaginas = new Map(),
) =>
  repetirHechos(
    "registro-oficial",
    hechos.map(([fecha, hecho]) => {
      const leido = leerHecho(hecho.tipo, fecha, datosDeHecho(hecho));
      if (Result.isFailure(leido)) return assert.fail(leido.failure);
      return leido.success;
    }),
    paginas,
  );

/** Una observación guardada antes de que se guardara lo que escribe el registro. */
const guardadaSinCrudo = (registro: Registro): ObservacionGuardada => {
  const { crudo: _crudo, ...limpio } = registro;
  return {
    ...limpio,
    fuente: "registro-oficial",
    afirma: "presente",
    bandas: [],
    fecha: NOCHE,
    fichaLeidaEn: null,
    ausencias: 0,
    retiradaEn: null,
  };
};

/** Una vida de un registro: el alta, su ficha y lo que pase después, con sus hechos. */
const alta = () => {
  const { guardar, hecho } = trasListado(undefined, registroDe(CRUDO), "registro-oficial", NOCHE);
  if (guardar === undefined || hecho === undefined) return assert.fail("sin alta");
  const hechos: Array<readonly [number, HechoNuevo]> = [[NOCHE, hecho]];
  return { guardada: guardar, hechos };
};

describe("historial de un registro (ADR 0027)", () => {
  it("un alta, su ficha y otra ficha distinta son hechos, y repetirlos da lo que guarda la tabla", () => {
    const { guardada, hechos } = alta();
    assert.deepStrictEqual(hechos[0]?.[1], { tipo: "alta", listado: { crudo: CRUDO } });
    const primera = trasFicha(guardada, leidaDe(CRUDA), NOCHE);
    assert.strictEqual(primera.hecho?.tipo, "ficha");
    hechos.push([NOCHE, primera.hecho ?? assert.fail("sin hecho")]);
    const otra: FichaCruda = {
      ...CRUDA,
      niveles: [{ distancia: "12.0", acimut: "300.0", valor: "0.02" }],
    };
    const segunda = trasFicha(primera.guardada, leidaDe(otra), NOCHE + 30 * DIA);
    assert.deepStrictEqual(
      segunda.hecho !== undefined && "cambia" in segunda.hecho && segunda.hecho.cambia,
      true,
    );
    assert.strictEqual(segunda.guardada.fecha, NOCHE + 30 * DIA);
    hechos.push([NOCHE + 30 * DIA, segunda.hecho ?? assert.fail("sin hecho")]);
    assert.deepStrictEqual(Result.getOrThrow(repetir(hechos)), registroPublicado(segunda.guardada));
  });

  it("la misma ficha o el mismo listado otra vez no son ningún hecho", () => {
    const { guardada } = alta();
    const leida = trasFicha(guardada, leidaDe(CRUDA), NOCHE);
    assert.isUndefined(trasFicha(leida.guardada, leidaDe(CRUDA), NOCHE + DIA).hecho);
    assert.deepStrictEqual(
      trasListado(leida.guardada, registroDe(CRUDO), "registro-oficial", NOCHE + DIA),
      { guardar: undefined, cuenta: undefined, cambia: false, hecho: undefined },
    );
  });

  it("si cambia la limpieza y no lo que escribe el registro, no hay hecho ni cambia la fecha", () => {
    const { guardada } = alta();
    // Lo guardado con una limpieza anterior, que dejaba otra dirección.
    const vieja: ObservacionGuardada = { ...guardada, direccion: "CL JORDI GIRONA 1" };
    const tras = trasListado(vieja, registroDe(CRUDO), "registro-oficial", NOCHE + DIA);
    assert.isUndefined(tras.hecho);
    assert.isUndefined(tras.cuenta);
    assert.strictEqual(tras.guardar?.direccion, CRUDO.direccion);
    assert.strictEqual(tras.guardar?.fecha, NOCHE);
    // Y en la ficha: el mismo crudo con otras bandas guardadas no mueve la fecha.
    const leida = trasFicha(guardada, leidaDe(CRUDA), NOCHE).guardada;
    const otraLimpieza = trasFicha({ ...leida, bandas: [] }, leidaDe(CRUDA), NOCHE + DIA);
    assert.isUndefined(otraLimpieza.hecho);
    assert.strictEqual(otraLimpieza.guardada.fecha, NOCHE);
  });

  it("lo que escribe el registro cambia sin que cambie lo limpio: hecho que no cambia la fecha", () => {
    const { guardada } = alta();
    const conEspacios = { ...CRUDO, gisId: " 0800143 " };
    const tras = trasListado(guardada, registroDe(conEspacios), "registro-oficial", NOCHE + DIA);
    assert.deepStrictEqual(tras.hecho, {
      tipo: "listado",
      listado: { crudo: conEspacios },
      cambia: false,
    });
    assert.strictEqual(tras.guardar?.fecha, NOCHE);
    assert.isUndefined(tras.cuenta);
  });

  it("una observación de antes del historial guarda lo que escribe el registro con un hecho que no cambia nada", () => {
    const { guardada } = alta();
    const { crudo: _crudo, ...deAntes } = guardada;
    const tras = trasListado(deAntes, registroDe(CRUDO), "registro-oficial", NOCHE + DIA);
    assert.deepStrictEqual(tras.hecho, {
      tipo: "listado",
      listado: { crudo: CRUDO },
      cambia: false,
    });
    assert.deepStrictEqual(tras.guardar?.crudo, CRUDO);
    assert.strictEqual(tras.guardar?.fecha, NOCHE);
  });

  it("otra dirección cambia la fecha, y una retirada que vuelve es una vuelta", () => {
    const { guardada, hechos } = alta();
    const otra = { ...CRUDO, direccion: "CL JORDI GIRONA, 3. BARCELONA, BARCELONA" };
    const cambiada = trasListado(guardada, registroDe(otra), "registro-oficial", NOCHE + DIA);
    assert.deepStrictEqual(cambiada.hecho, {
      tipo: "listado",
      listado: { crudo: otra },
      cambia: true,
    });
    assert.strictEqual(cambiada.guardar?.fecha, NOCHE + DIA);
    hechos.push([NOCHE + DIA, cambiada.hecho ?? assert.fail("sin hecho")]);
    let actual = cambiada.guardar ?? assert.fail("sin guardar");
    for (const noche of [2, 3]) {
      const ausente = trasAusencia(actual, NOCHE + noche * DIA);
      actual = ausente.guardada;
      if (ausente.hecho !== undefined) hechos.push([NOCHE + noche * DIA, ausente.hecho]);
    }
    assert.strictEqual(actual.retiradaEn, NOCHE + 3 * DIA);
    assert.deepStrictEqual(hechos.at(-1)?.[1], { tipo: "retirada" });
    const vuelta = trasListado(actual, registroDe(otra), "registro-oficial", NOCHE + 4 * DIA);
    assert.deepStrictEqual(vuelta.hecho, {
      tipo: "vuelta",
      listado: { crudo: otra },
      cambia: false,
    });
    hechos.push([NOCHE + 4 * DIA, vuelta.hecho ?? assert.fail("sin hecho")]);
    assert.deepStrictEqual(
      Result.getOrThrow(repetir(hechos)),
      registroPublicado(vuelta.guardar ?? assert.fail("sin guardar")),
    );
  });

  it("un hecho que no encaja en su forma no se lee a medias", () => {
    const bien = datosDeHecho({ tipo: "retirada" });
    assert.isTrue(Result.isSuccess(leerHecho("retirada", NOCHE, bien)));
    // Una clave de más, otra forma, otro tipo o un listado con crudo y registro a la vez.
    assert.isTrue(Result.isFailure(leerHecho("retirada", NOCHE, '{"forma":1,"motivo":"x"}')));
    assert.isTrue(Result.isFailure(leerHecho("retirada", NOCHE, '{"forma":2}')));
    assert.isTrue(Result.isFailure(leerHecho("borrada", NOCHE, bien)));
    const registro = registroDe(CRUDO);
    const { crudo: _crudo, ...limpio } = registro;
    const ambiguo = JSON.stringify({ forma: 1, listado: { crudo: CRUDO, registro: limpio } });
    assert.isTrue(Result.isFailure(leerHecho("alta", NOCHE, ambiguo)));
  });

  it("repetir sin alta ni punto de partida falla", () => {
    const sinAlta: HechoLeido = { tipo: "retirada", fecha: NOCHE, datos: { forma: 1 } };
    assert.isTrue(Result.isFailure(repetirHechos("registro-oficial", [sinAlta], new Map())));
    assert.isTrue(Result.isFailure(repetirHechos("registro-oficial", [], new Map())));
  });

  it("la ficha de un hecho se vuelve a leer de su página del archivo, y sin ella no se repite", () => {
    const { guardada, hechos } = alta();
    const leida = leidaDe(CRUDA);
    const conPagina = trasFicha(guardada, { ...leida, pagina: "a1b2" }, NOCHE);
    assert.deepStrictEqual(conPagina.hecho, {
      tipo: "ficha",
      ficha: { pagina: "a1b2" },
      cambia: false,
    });
    hechos.push([NOCHE, conPagina.hecho ?? assert.fail("sin hecho")]);
    assert.deepStrictEqual(
      Result.getOrThrow(repetir(hechos, new Map([["a1b2", leida]]))),
      registroPublicado(conPagina.guardada),
    );
    assert.isTrue(Result.isFailure(repetir(hechos)));
  });

  it("la primera vez que se guarda lo crudo se compara con la limpieza de hoy, y un arreglo no es un cambio", () => {
    // Guardada antes del historial: la dirección con la «ñ» rota y la banda de 26 GHz en «MHz».
    const conEne = { ...CRUDO, direccion: "AV Espa±a, 18. FUENLABRADA, MADRID" };
    const deAntes: ObservacionGuardada = {
      ...guardadaSinCrudo(registroDe(conEne)),
      direccion: "AV Espa±a, 18. FUENLABRADA, MADRID",
      municipio: "FUENLABRADA",
      bandas: [
        {
          referencia: "B B -2201234",
          compania: "movistar",
          rangos: [{ desdeMhz: 25.7, hastaMhz: 26.7 }],
          mhz: null,
          anio: 2022,
        },
      ],
      medidasDeExposicion: [],
      fichaLeidaEn: NOCHE,
    };
    const listado = trasListado(deAntes, registroDe(conEne), "registro-oficial", NOCHE + DIA);
    assert.deepStrictEqual(listado.hecho, {
      tipo: "listado",
      listado: { crudo: conEne },
      cambia: false,
    });
    assert.strictEqual(listado.guardar?.fecha, NOCHE);
    assert.strictEqual(listado.guardar?.direccion, "AV España, 18. FUENLABRADA, MADRID");
    assert.isUndefined(listado.cuenta);
    const ficha = trasFicha(
      listado.guardar ?? deAntes,
      leidaDe({
        caracteristicas: [
          {
            operador: "TELEFONICA MOVILES ESPAÑA, S.A.U.",
            referencia: "B B -2201234",
            bandaMhz: "25.70 - 26.70",
          },
        ],
        niveles: [],
      }),
      NOCHE + DIA,
    );
    assert.strictEqual(ficha.hecho?.tipo, "ficha");
    assert.isFalse(ficha.hecho?.tipo === "ficha" && ficha.hecho.cambia);
    assert.strictEqual(ficha.guardada.fecha, NOCHE);
    assert.deepStrictEqual(ficha.guardada.bandas[0]?.rangos, [
      { desdeMhz: 25700, hastaMhz: 26700 },
    ]);
  });

  it("lo que publica la ficha: una vuelta con otro listado es también un cambio, y un titular nuevo estaba antes", () => {
    const base = { antes: NOCHE, cambia: null, conocidoDesde: null };
    assert.deepStrictEqual(
      hechosDeFicha({ ...base, tipo: "vuelta", fecha: NOCHE + DIA, cambia: true }),
      [
        { tipo: "vuelta", fecha: NOCHE + DIA, antes: NOCHE },
        { tipo: "cambio-de-listado", fecha: NOCHE + DIA, antes: NOCHE },
      ],
    );
    assert.deepStrictEqual(
      hechosDeFicha({ ...base, tipo: "vuelta", fecha: NOCHE + DIA, cambia: false }),
      [{ tipo: "vuelta", fecha: NOCHE + DIA, antes: NOCHE }],
    );
    assert.deepStrictEqual(
      hechosDeFicha({ ...base, tipo: "alta", fecha: NOCHE + DIA, conocidoDesde: NOCHE - DIA }),
      [{ tipo: "en-el-registro-antes", fecha: NOCHE - DIA }],
    );
    assert.deepStrictEqual(
      hechosDeFicha({ ...base, tipo: "listado", fecha: NOCHE, cambia: false }),
      [],
    );
  });

  it("una retirada que vuelve igual no cambia lo que se enseña", () => {
    const { guardada } = alta();
    const retirada: ObservacionGuardada = { ...guardada, ausencias: 2, retiradaEn: NOCHE + DIA };
    const vuelta = trasListado(retirada, registroDe(CRUDO), "registro-oficial", NOCHE + 2 * DIA);
    assert.isFalse(vuelta.cambia);
    assert.strictEqual(vuelta.cuenta, "cambiada");
    assert.deepStrictEqual(vuelta.hecho, {
      tipo: "vuelta",
      listado: { crudo: CRUDO },
      cambia: false,
    });
  });
});
