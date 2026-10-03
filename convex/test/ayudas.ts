// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import type { CorreccionPropuesta, Corroboracion } from "@celda/dominio/aportacion";
import type { MedidaPropia } from "@celda/dominio/medida";
import { afterEach, beforeEach, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import refs from "../confect/_generated/refs";
import { DatabaseReader } from "../confect/_generated/services";
import { VARIABLE_CLAVE } from "../src/claves";
import * as TestConfect from "./TestConfect";

/** Una clave de prueba, del largo mínimo. Nunca la de un despliegue. */
export const CLAVE_DE_PRUEBA = "clave-de-prueba-del-buzon-0123456789abcdef";

/** El 3 de octubre de 2026 a las 10:00 UTC. */
export const INICIO = Date.UTC(2026, 9, 3, 10, 0);

/**
 * Cada prueba empieza con la clave puesta y el reloj del sistema en `INICIO`. El limitador lee la
 * hora con `Date.now()`, que el `TestClock` de Effect no mueve: se mueve solo `Date`, para que
 * convex-test siga con sus temporizadores de verdad.
 */
export const prepararBuzon = () => {
  beforeEach(() => {
    vi.stubEnv(VARIABLE_CLAVE, CLAVE_DE_PRUEBA);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INICIO);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
};

/** Mueve el reloj del sistema. */
export const avanzar = (ms: number) => vi.setSystemTime(Date.now() + ms);

let contador = 0;

/** Un UUID v4 nuevo y válido para cada aportación de prueba. */
export const uuid = () => {
  contador += 1;
  return `00000000-0000-4000-8000-${contador.toString(16).padStart(12, "0")}`;
};

/** Una medida a unos 150 m al este de Campus Nord, en el sector de 120°. */
export const medida = (cambios: Partial<MedidaPropia> = {}): MedidaPropia => ({
  tipo: "propia",
  id: uuid(),
  esquema: 1,
  creada: Date.now() - 60_000,
  origen: "captura",
  punto: { longitud: 2.1155, latitud: 41.3878 },
  senal: { compania: "vodafone", red: "4g", mhz: 1800, rsrpDbm: -90, rsrqDb: -10, pci: 12 },
  unidaA: {
    emplazamiento: "movistar-0802532",
    posicion: { longitud: 2.113628, latitud: 41.388344 },
    azimut: 120,
  },
  ...cambios,
});

/** Una corrección propuesta de la posición de Campus Nord. */
export const correccion = (cambios: Partial<CorreccionPropuesta> = {}): CorreccionPropuesta => ({
  id: uuid(),
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: Date.now() - 60_000,
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  cambio: { tipo: "posicion", posicion: { longitud: 2.1141, latitud: 41.3889 } },
  nota: null,
  ...cambios,
});

/** Una corroboración de una corrección publicada en Campus Nord. */
export const corroboracion = (): Corroboracion => ({
  id: uuid(),
  tipo: "corroboracion",
  esquema: 1,
  creada: Date.now() - 60_000,
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  correccion: "00000000-0000-4000-8000-0000000000ff",
});

/** Una identidad nueva pedida desde `ip`. */
export const identidadDesde = (ip: string) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    const { identidad } = yield* convex.desde(ip).mutation(refs.public.buzon.pedirIdentidad);
    return identidad;
  });

/** Lo que guarda el buzón en sus tablas. */
export interface Tablas {
  readonly aportaciones: ReadonlyArray<{
    readonly id: string;
    readonly estado: string;
    readonly huellaIp: string | null;
    readonly contenido: unknown;
  }>;
  readonly identidades: ReadonlyArray<{ readonly _id: string; readonly huellaIp: string | null }>;
  readonly huellasDeIp: ReadonlyArray<{ readonly huella: string; readonly vistaEl: number }>;
  readonly salesDeIp: ReadonlyArray<{ readonly dia: string; readonly sal: string }>;
  readonly vetos: ReadonlyArray<{ readonly tipo: string; readonly valor: string }>;
}

/** Todo lo que guarda el buzón en sus tablas, para comparar o buscar dentro. */
export const tablas = Effect.gen(function* () {
  const convex = yield* TestConfect.TestConfect;
  const leidas = yield* Ref.make<Tablas>({
    aportaciones: [],
    identidades: [],
    huellasDeIp: [],
    salesDeIp: [],
    vetos: [],
  });
  yield* convex.run(
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      yield* Ref.set(leidas, {
        aportaciones: yield* reader.table("aportaciones").index("por_id").collect(),
        identidades: yield* reader.table("identidades").index("por_huella").collect(),
        huellasDeIp: yield* reader.table("huellasDeIp").index("por_huella").collect(),
        salesDeIp: yield* reader.table("salesDeIp").index("por_dia").collect(),
        vetos: yield* reader.table("vetos").index("por_valor").collect(),
      });
    }).pipe(Effect.orDie),
  );
  return yield* Ref.get(leidas);
});
