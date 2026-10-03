// La prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { Spec } from "@confect/core";
import { DatabaseSchema } from "@confect/server";
import { assert, describe, it } from "@effect/vitest";

import confectSchema from "../confect/_generated/schema";
import spec from "../confect/_generated/spec";

/** Lo que hace falta mirar de cada función de la especificación. */
interface Funcion {
  readonly name: string;
  readonly functionVisibility: string;
  readonly runtimeAndFunctionType: { readonly functionType: string };
  readonly functionProvenance: { readonly returns: { readonly fields: object } };
}

const funciones = Object.entries(Spec.groups(spec)).flatMap(([grupo, definicion]) =>
  // SAFETY: todas las funciones de Celda son de Confect, con esquema de retorno: tienen estos campos.
  Object.values(definicion.functions as Readonly<Record<string, Funcion>>).map((funcion) => ({
    grupo,
    funcion,
  })),
);

/** Las funciones públicas, con su tipo. */
const publicas = funciones
  .filter(({ funcion }) => funcion.functionVisibility === "public")
  .map(({ grupo, funcion }) => ({
    nombre: `${grupo}:${funcion.name}`,
    tipo: funcion.runtimeAndFunctionType.functionType,
  }));

/**
 * Desde el #51 la ingesta y la publicación corren fuera de Convex (ADR 0015). Le queda el buzón
 * de las aportaciones compartidas (#56, ADR 0020): sus tablas, sus funciones y el cron que borra
 * las huellas de IP.
 */
describe("despliegue de Convex", () => {
  it("solo tiene las tablas del buzón", () => {
    assert.deepStrictEqual(Object.keys(DatabaseSchema.tables(confectSchema)).toSorted(), [
      "aportaciones",
      "huellasDeIp",
      "identidades",
      "salesDeIp",
      "vetos",
    ]);
  });

  it("las únicas funciones públicas son las mutaciones del buzón: pedir identidad y enviar", () => {
    assert.deepStrictEqual(
      publicas.toSorted((a, b) => a.nombre.localeCompare(b.nombre)),
      [
        { nombre: "buzon:enviarCorreccion", tipo: "mutation" },
        { nombre: "buzon:enviarCorroboracion", tipo: "mutation" },
        { nombre: "buzon:enviarMedida", tipo: "mutation" },
        { nombre: "buzon:pedirIdentidad", tipo: "mutation" },
      ],
    );
  });

  it("ninguna función pública devuelve aportaciones: solo un token o si era nueva", () => {
    const devuelven = funciones
      .filter(({ funcion }) => funcion.functionVisibility === "public")
      .map(({ funcion }) => Object.keys(funcion.functionProvenance.returns.fields).join(","));
    assert.deepStrictEqual(devuelven.toSorted(), ["identidad", "nueva", "nueva", "nueva"]);
  });
});
