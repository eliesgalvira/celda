import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type Coordenada, type Rectangulo } from "./area.ts";
import { type Barrio, barrioDelPunto, FuenteDeBarrios, type LimitesDeBarrios } from "./barrio.ts";
import {
  bandasDeCodigo,
  barriosDe,
  CapaIlegible,
  codigoDeBandas,
  companiasDeMascara,
  type EmplazamientoDeCapa,
  type EmplazamientoLeido,
  ESTADOS_DE_CAPA,
  fechaDeVersion,
  mascaraDeCompanias,
  redondear,
  SIN_BARRIO,
  TablaDeBarrios,
  VersionDistinta,
  versionDeCabecera,
} from "./capa.ts";
import { Caja, type Cuadro } from "./barrido.ts";
import {
  cajaDeRectangulo,
  coberturaDeProvincia,
  rectanguloDeCaja,
  ZonaBarrida,
} from "./cobertura.ts";
import type { Compania } from "./compania.ts";
import { Ficha } from "./ficha.ts";
import {
  FuenteDeMunicipios,
  type IndiceDeMunicipios,
  type Lugar,
  type MunicipioConHabitantes,
  municipioDelPunto,
} from "./municipio.ts";
import { FuenteDePoblacion } from "./poblacion.ts";

/**
 * El formato 5 de la capa (ADR 0016): un resumen nacional con una fila por provincia y una capa
 * por provincia, con las fichas en lotes dentro de cada provincia.
 *
 * - El resumen lleva la versión en el nombre y una huella de su contenido, porque la misma versión
 *   de los datos puede publicarse otra vez con otra cobertura (otra fecha de barrido).
 * - Las capas de provincia y los lotes de fichas se nombran por su contenido y no llevan la
 *   versión dentro: una provincia sin cambios reutiliza los ficheros de la versión anterior.
 * - El manifiesto de una versión lista sus capas y sus lotes. La web no lo lee; sirve para retirar
 *   versiones viejas sin borrar lo que comparten con las que se quedan.
 */
export const FORMATO_PROVINCIAS = 5;

/** Caracteres de la huella SHA-256 que van en el nombre de un fichero: 64 bits. */
export const LARGO_HUELLA = 16;

const PREFIJO_VERSION = "sitios@";

/** El sello de una versión: `2026-09-26T02:15:03Z` para `sitios@2026-09-26T02:15:03Z`. */
export const selloDeVersion = (version: string): string =>
  version.startsWith(PREFIJO_VERSION) ? version.slice(PREFIJO_VERSION.length) : version;

/** El resumen nacional de una versión con una cobertura: `resumen@2026-09-26T02:15:03Z.<huella>.json`. */
export const ficheroDeResumen = (version: string, huella: string): string =>
  `resumen@${selloDeVersion(version)}.${huella.slice(0, LARGO_HUELLA)}.json`;

/** El manifiesto de una versión: `ficheros@2026-09-26T02:15:03Z.json`. */
export const ficheroDeManifiesto = (version: string): string =>
  `ficheros@${selloDeVersion(version)}.json`;

/** La capa de una provincia: `provincias/08/<huella>.json`. */
export const ficheroDeCapaDeProvincia = (provincia: string, huella: string): string =>
  `provincias/${provincia}/${huella.slice(0, LARGO_HUELLA)}.json`;

/** Un lote de fichas de una provincia: `fichas/08/<huella>.json`. */
export const ficheroDeLoteDeProvincia = (provincia: string, huella: string): string =>
  `fichas/${provincia}/${huella.slice(0, LARGO_HUELLA)}.json`;

// ── Dónde va cada emplazamiento ─────────────────────────────────────────────────────────────────

/** Un emplazamiento con la provincia de la capa en que va y el lugar que dirá su ficha. */
export interface EmplazamientoSituado {
  readonly emplazamiento: EmplazamientoDeCapa;
  readonly provincia: string;
  /** Código INE de su municipio, o `null` en un territorio compartido o sin provincia. */
  readonly municipio: string | null;
  readonly lugar: Lugar;
}

const distancia2 = (a: Coordenada, b: Coordenada): number => {
  const dx = (a.longitud - b.longitud) * Math.cos((a.latitud * Math.PI) / 180);
  const dy = a.latitud - b.latitud;
  return dx * dx + dy * dy;
};

/**
 * Pone a cada emplazamiento su municipio (`municipioDelPunto`) y lo reparte por provincias. Uno sin
 * provincia, en un territorio sin provincia o en el mar lejos de la costa, va a la capa de la
 * provincia de etiqueta más cercana, pero su ficha sigue diciendo que no tiene ni municipio ni
 * provincia. Devuelve las provincias por código y, en cada una, sus emplazamientos por clave. Es
 * una función pura.
 */
export const situarEmplazamientos = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  indice: IndiceDeMunicipios,
): ReadonlyMap<string, ReadonlyArray<EmplazamientoSituado>> => {
  const provincias = [...indice.provincias.values()];
  const porProvincia = new Map<string, Array<EmplazamientoSituado>>();
  for (const emplazamiento of emplazamientos) {
    const { municipio, provincia } = municipioDelPunto(emplazamiento.posicion, indice);
    const lugar: Lugar = {
      municipio:
        municipio === undefined ? null : { codigo: municipio.codigo, nombre: municipio.nombre },
      provincia:
        provincia === undefined ? null : { codigo: provincia.codigo, nombre: provincia.nombre },
    };
    const deCapa =
      provincia ??
      provincias.reduce<(typeof provincias)[number] | undefined>(
        (cercana, p) =>
          cercana === undefined ||
          distancia2(emplazamiento.posicion, p.etiqueta) <
            distancia2(emplazamiento.posicion, cercana.etiqueta)
            ? p
            : cercana,
        undefined,
      );
    if (deCapa === undefined) continue;
    const lista = porProvincia.get(deCapa.codigo) ?? [];
    lista.push({
      emplazamiento,
      provincia: deCapa.codigo,
      municipio: municipio?.codigo ?? null,
      lugar,
    });
    porProvincia.set(deCapa.codigo, lista);
  }
  const porClave = (a: EmplazamientoSituado, b: EmplazamientoSituado) =>
    a.emplazamiento.clave < b.emplazamiento.clave
      ? -1
      : a.emplazamiento.clave > b.emplazamiento.clave
        ? 1
        : 0;
  return new Map(
    [...porProvincia]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([codigo, lista]) => [codigo, lista.sort(porClave)]),
  );
};

// ── Lotes de fichas ─────────────────────────────────────────────────────────────────────────────

/**
 * Un lote de fichas de una provincia. No lleva la versión: se nombra por su contenido y lo pueden
 * compartir varias versiones. La fuente de los lugares va una vez por lote.
 */
export const LoteDeProvincia = Schema.Struct({
  formato: Schema.Literal(FORMATO_PROVINCIAS),
  provincia: Schema.String,
  fuenteDeLugares: FuenteDeMunicipios,
  fichas: Schema.Array(Ficha),
});
export type LoteDeProvincia = typeof LoteDeProvincia.Type;

const LoteEnJson = Schema.fromJsonString(LoteDeProvincia);
const codificarLote = Schema.encodeSync(LoteEnJson);
const decodificarLote = Schema.decodeUnknownResult(LoteEnJson);

/**
 * El contenido de un lote de fichas de `provincia`, con sus fichas por clave y el lugar de cada
 * una. Es una función pura: las mismas fichas con los mismos lugares dan los mismos bytes.
 */
export const generarLoteDeProvincia = (
  provincia: string,
  fichas: ReadonlyArray<Ficha>,
  lugares: ReadonlyMap<string, Lugar>,
  fuente: FuenteDeMunicipios,
): string =>
  codificarLote({
    formato: FORMATO_PROVINCIAS,
    provincia,
    fuenteDeLugares: fuente,
    fichas: fichas
      .slice()
      .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
      .map((ficha) => {
        const lugar = lugares.get(ficha.clave);
        return lugar === undefined ? ficha : { ...ficha, lugar };
      }),
  });

/**
 * Las fichas de un lote de `provincia`, con la fuente de los lugares copiada en cada una para que
 * el panel la cite sin mirar el lote.
 */
export const leerLoteDeProvincia = (
  contenido: string,
  provincia: string,
): Result.Result<ReadonlyArray<Ficha>, CapaIlegible> =>
  decodificarLote(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap((lote) =>
      lote.provincia === provincia
        ? Result.succeed(
            lote.fichas.map((ficha) =>
              ficha.lugar === undefined
                ? ficha
                : { ...ficha, lugar: { ...ficha.lugar, fuente: lote.fuenteDeLugares } },
            ),
          )
        : Result.fail(
            new CapaIlegible({
              motivo: `se esperaba un lote de ${provincia} y es de ${lote.provincia}`,
            }),
          ),
    ),
  );

// ── Capa de una provincia ───────────────────────────────────────────────────────────────────────

/** Municipio de la columna `municipio` para un emplazamiento sin municipio. */
const SIN_MUNICIPIO = -1;
/** Habitantes de un municipio que el padrón aún no tiene. */
const SIN_HABITANTES = -1;

/** Los municipios de una provincia, por columnas, con sus habitantes y sus emplazamientos. */
const TablaDeMunicipios = Schema.Struct({
  codigo: Schema.Array(Schema.String),
  nombre: Schema.Array(Schema.String),
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
  /** Del padrón del INE, o `SIN_HABITANTES`. */
  habitantes: Schema.Array(Schema.Int),
  /** En km², con dos decimales. */
  area: Schema.Array(Schema.Finite),
  emplazamientos: Schema.Array(Schema.Int),
  /** Máscara de las compañías con algún emplazamiento en el municipio. */
  companias: Schema.Array(Schema.Int),
});

const ColumnasDeProvincia = Schema.Struct({
  formato: Schema.Literal(FORMATO_PROVINCIAS),
  provincia: Schema.String,
  /** Solo en la provincia de Barcelona: los barrios del municipio de Barcelona. */
  barrios: Schema.optionalKey(TablaDeBarrios),
  municipios: TablaDeMunicipios,
  /** Los ficheros de los lotes de fichas: la columna `lote` es una posición en esta lista. */
  lotes: Schema.Array(Schema.String),
  clave: Schema.Array(Schema.String),
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
  companias: Schema.Array(Schema.Int),
  estado: Schema.Array(Schema.Int),
  /** Con `barrios`: la posición del barrio en su tabla, o `SIN_BARRIO`. */
  barrio: Schema.optionalKey(Schema.Array(Schema.Int)),
  bandas: Schema.Array(Schema.Int),
  lote: Schema.Array(Schema.Int),
  /** La posición del municipio en `municipios`, o `SIN_MUNICIPIO`. */
  municipio: Schema.Array(Schema.Int),
});
type ColumnasDeProvincia = typeof ColumnasDeProvincia.Type;

const ProvinciaEnJson = Schema.fromJsonString(ColumnasDeProvincia);
const codificarProvincia = Schema.encodeSync(ProvinciaEnJson);
const decodificarProvincia = Schema.decodeUnknownResult(ProvinciaEnJson);

/** Un lote de fichas ya nombrado, con las claves de sus emplazamientos. */
export interface LoteNombrado {
  readonly fichero: string;
  readonly claves: ReadonlyArray<string>;
}

/** La caja que envuelve todos los polígonos de unos barrios. */
const cajaDeBarrios = (limites: LimitesDeBarrios): Rectangulo | undefined => {
  let [oeste, sur, este, norte] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const barrio of limites.barrios) {
    for (const poligono of barrio.poligonos) {
      for (const [x, y] of poligono[0] ?? []) {
        oeste = Math.min(oeste, x);
        este = Math.max(este, x);
        sur = Math.min(sur, y);
        norte = Math.max(norte, y);
      }
    }
  }
  return Number.isFinite(oeste)
    ? { suroeste: { longitud: oeste, latitud: sur }, noreste: { longitud: este, latitud: norte } }
    : undefined;
};

const dentroDe = (caja: Rectangulo, punto: Coordenada): boolean =>
  punto.longitud >= caja.suroeste.longitud &&
  punto.longitud <= caja.noreste.longitud &&
  punto.latitud >= caja.suroeste.latitud &&
  punto.latitud <= caja.noreste.latitud;

const porCodigo = <A extends { readonly codigo: string }>(a: A, b: A): number =>
  a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;

/**
 * La capa de una provincia: las columnas del formato 4, el municipio de cada emplazamiento con la
 * tabla de municipios de la provincia y, si alguno cae en un barrio de Barcelona, la columna y la
 * tabla de barrios. `situados` va por clave, como lo deja `situarEmplazamientos`, y `lotes` dice
 * en qué fichero está la ficha de cada uno. Es una función pura.
 */
export const generarCapaDeProvincia = (capa: {
  readonly provincia: string;
  readonly situados: ReadonlyArray<EmplazamientoSituado>;
  readonly barrios: LimitesDeBarrios;
  /** Los municipios de la provincia, con sus habitantes. */
  readonly municipios: ReadonlyArray<MunicipioConHabitantes>;
  readonly lotes: ReadonlyArray<LoteNombrado>;
}): string => {
  const { situados } = capa;
  const loteDe = new Map(
    capa.lotes.flatMap((lote, i) => lote.claves.map((clave) => [clave, i] as const)),
  );
  const municipios = capa.municipios.slice().sort(porCodigo);
  const posicionDeMunicipio = new Map(municipios.map((m, i) => [m.codigo, i]));
  const cuantos = municipios.map(() => 0);
  const presentes = municipios.map(() => 0);
  for (const situado of situados) {
    const i = posicionDeMunicipio.get(situado.municipio ?? "");
    if (i === undefined) continue;
    cuantos[i] = (cuantos[i] ?? 0) + 1;
    presentes[i] = (presentes[i] ?? 0) | mascaraDeCompanias(situado.emplazamiento.companias);
  }

  const alcance = cajaDeBarrios(capa.barrios);
  const barrios = capa.barrios.barrios.slice().sort(porCodigo);
  const posicionDeBarrio = new Map(barrios.map((b, i) => [b.codigo, i]));
  const barrioDe = situados.map((s) =>
    alcance !== undefined && dentroDe(alcance, s.emplazamiento.posicion)
      ? (posicionDeBarrio.get(barrioDelPunto(s.emplazamiento.posicion, barrios)?.codigo ?? "") ??
        SIN_BARRIO)
      : SIN_BARRIO,
  );
  const conBarrios = barrioDe.some((b) => b !== SIN_BARRIO);

  const sinBarrios: ColumnasDeProvincia = {
    formato: FORMATO_PROVINCIAS,
    provincia: capa.provincia,
    municipios: {
      codigo: municipios.map((m) => m.codigo),
      nombre: municipios.map((m) => m.nombre),
      lon: municipios.map((m) => redondear(m.etiqueta.longitud)),
      lat: municipios.map((m) => redondear(m.etiqueta.latitud)),
      habitantes: municipios.map((m) => m.habitantes ?? SIN_HABITANTES),
      area: municipios.map((m) => Math.round(m.areaKm2 * 100) / 100),
      emplazamientos: cuantos,
      companias: presentes,
    },
    lotes: capa.lotes.map((lote) => lote.fichero),
    clave: situados.map((s) => s.emplazamiento.clave),
    lon: situados.map((s) => redondear(s.emplazamiento.posicion.longitud)),
    lat: situados.map((s) => redondear(s.emplazamiento.posicion.latitud)),
    companias: situados.map((s) => mascaraDeCompanias(s.emplazamiento.companias)),
    estado: situados.map((s) => ESTADOS_DE_CAPA.indexOf(s.emplazamiento.estado)),
    bandas: situados.map((s) => codigoDeBandas(s.emplazamiento.bandas ?? [])),
    lote: situados.map((s) => loteDe.get(s.emplazamiento.clave) ?? 0),
    municipio: situados.map((s) => posicionDeMunicipio.get(s.municipio ?? "") ?? SIN_MUNICIPIO),
  };
  const columnas: ColumnasDeProvincia = conBarrios
    ? {
        ...sinBarrios,
        barrios: {
          fuente: capa.barrios.fuente,
          codigo: barrios.map((b) => b.codigo),
          nombre: barrios.map((b) => b.nombre),
          lon: barrios.map((b) => redondear(b.etiqueta.longitud)),
          lat: barrios.map((b) => redondear(b.etiqueta.latitud)),
        },
        barrio: barrioDe,
      }
    : sinBarrios;
  return codificarProvincia(columnas);
};

/** Un municipio tal como sale de la capa de su provincia. */
export interface MunicipioDeCapa {
  readonly codigo: string;
  readonly nombre: string;
  readonly etiqueta: Coordenada;
  /** `null` si el padrón aún no lo tiene. */
  readonly habitantes: number | null;
  readonly areaKm2: number;
  readonly emplazamientos: number;
  readonly companias: ReadonlyArray<Compania>;
}

/** La capa de una provincia, leída. */
export interface CapaDeProvincia {
  readonly provincia: string;
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  /** Los barrios de Barcelona, solo en su provincia. */
  readonly barrios: ReadonlyArray<Barrio>;
  readonly fuenteDeBarrios: FuenteDeBarrios | undefined;
  readonly municipios: ReadonlyArray<MunicipioDeCapa>;
  /** Los ficheros de los lotes de fichas, en el orden de la columna `lote`. */
  readonly lotes: ReadonlyArray<string>;
}

const descuadrada = (motivo: string) => Result.fail(new CapaIlegible({ motivo }));

/** La tabla de municipios de la capa, comprobada. */
const municipiosDe = (
  m: ColumnasDeProvincia["municipios"],
): Result.Result<ReadonlyArray<MunicipioDeCapa>, CapaIlegible> => {
  const largo = m.codigo.length;
  const columnas = [m.nombre, m.lon, m.lat, m.habitantes, m.area, m.emplazamientos, m.companias];
  if (columnas.some((columna) => columna.length !== largo)) {
    return descuadrada("la tabla de municipios está descuadrada");
  }
  return Result.succeed(
    m.codigo.map((codigo, i) => {
      const habitantes = m.habitantes[i] ?? SIN_HABITANTES;
      return {
        codigo,
        nombre: m.nombre[i] ?? "",
        etiqueta: { longitud: m.lon[i] ?? 0, latitud: m.lat[i] ?? 0 },
        habitantes: habitantes === SIN_HABITANTES ? null : habitantes,
        areaKm2: m.area[i] ?? 0,
        emplazamientos: m.emplazamientos[i] ?? 0,
        companias: companiasDeMascara(m.companias[i] ?? 0),
      };
    }),
  );
};

/** Lo que hay en la posición `posicion` de una tabla: `null` si es negativa (ninguno). */
const deTabla = <A>(tabla: ReadonlyArray<A>, posicion: number): A | null | undefined =>
  posicion < 0 ? null : tabla[posicion];

/** La fila `i` de la capa de una provincia, con su barrio y su municipio de las tablas. */
const filaDeProvincia = (
  c: ColumnasDeProvincia,
  i: number,
  barrios: ReadonlyArray<Barrio>,
  municipios: ReadonlyArray<MunicipioDeCapa>,
): Result.Result<EmplazamientoLeido, CapaIlegible> => {
  const estado = ESTADOS_DE_CAPA[c.estado[i] ?? -1];
  const barrio = deTabla(barrios, c.barrio?.[i] ?? SIN_BARRIO);
  const municipio = deTabla(municipios, c.municipio[i] ?? SIN_MUNICIPIO);
  const lote = c.lote[i] ?? -1;
  if (estado === undefined) return descuadrada(`estado desconocido en la fila ${i}`);
  if (barrio === undefined || municipio === undefined || c.lotes[lote] === undefined) {
    return descuadrada(`barrio, municipio o lote desconocido en la fila ${i}`);
  }
  const leido: EmplazamientoLeido = {
    clave: c.clave[i] ?? "",
    posicion: { longitud: c.lon[i] ?? 0, latitud: c.lat[i] ?? 0 },
    estado,
    companias: companiasDeMascara(c.companias[i] ?? 0),
    barrio: barrio?.codigo ?? null,
    lote,
    provincia: c.provincia,
    municipio: municipio?.codigo ?? null,
  };
  // Sin ninguna banda conocida, el emplazamiento no lleva la clave, como en el formato 4.
  const bandas = bandasDeCodigo(c.bandas[i] ?? 0);
  return Result.succeed(bandas.length > 0 ? { ...leido, bandas } : leido);
};

const filasDeProvincia = (c: ColumnasDeProvincia): Result.Result<CapaDeProvincia, CapaIlegible> => {
  const n = c.clave.length;
  const columnas = [c.lon, c.lat, c.companias, c.estado, c.bandas, c.lote, c.municipio];
  if (c.barrio !== undefined) columnas.push(c.barrio);
  if (columnas.some((columna) => columna.length !== n)) {
    return descuadrada("las columnas no tienen la misma longitud");
  }
  const municipios = municipiosDe(c.municipios);
  if (Result.isFailure(municipios)) return Result.fail(municipios.failure);
  const barrios = c.barrios === undefined ? Result.succeed([]) : barriosDe(c.barrios);
  if (Result.isFailure(barrios)) return Result.fail(barrios.failure);
  const emplazamientos: Array<EmplazamientoLeido> = [];
  for (let i = 0; i < n; i++) {
    const fila = filaDeProvincia(c, i, barrios.success, municipios.success);
    if (Result.isFailure(fila)) return Result.fail(fila.failure);
    emplazamientos.push(fila.success);
  }
  return Result.succeed({
    provincia: c.provincia,
    emplazamientos,
    barrios: barrios.success,
    fuenteDeBarrios: c.barrios?.fuente,
    municipios: municipios.success,
    lotes: c.lotes,
  });
};

/** Lee la capa de una provincia y comprueba que es la de `provincia`. */
export const leerCapaDeProvincia = (
  contenido: string,
  provincia: string,
): Result.Result<CapaDeProvincia, CapaIlegible> =>
  decodificarProvincia(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap((columnas) =>
      columnas.provincia === provincia
        ? filasDeProvincia(columnas)
        : descuadrada(`se esperaba la capa de ${provincia} y es la de ${columnas.provincia}`),
    ),
  );

// ── Resumen nacional ────────────────────────────────────────────────────────────────────────────

/** De dónde salen las zonas y los habitantes: lo que hay que citar al usarlos. */
export const FuentesDeZonas = Schema.Struct({
  barrios: FuenteDeBarrios,
  municipios: FuenteDeMunicipios,
  padron: FuenteDePoblacion,
});
export type FuentesDeZonas = typeof FuentesDeZonas.Type;

const ColumnasDelResumen = Schema.Struct({
  /** La primera clave, como en la capa: se comprueba antes de analizar el resto. */
  version: Schema.String,
  formato: Schema.Literal(FORMATO_PROVINCIAS),
  fuentes: FuentesDeZonas,
  cobertura: Schema.Array(ZonaBarrida),
  provincias: Schema.Struct({
    codigo: Schema.Array(Schema.String),
    nombre: Schema.Array(Schema.String),
    lon: Schema.Array(Schema.Finite),
    lat: Schema.Array(Schema.Finite),
    /** La caja de sus emplazamientos, o `null` si no tiene ninguno. */
    caja: Schema.Array(Schema.NullOr(Caja)),
    emplazamientos: Schema.Array(Schema.Int),
    companias: Schema.Array(Schema.Int),
    /** Si se han barrido todos los cuadros con datos que la tocan (`coberturaDeProvincia`). */
    cubierta: Schema.Array(Schema.Boolean),
    /** El último barrido completo de lo que se sabe de ella (`coberturaDeProvincia`). */
    barrido: Schema.Array(Schema.NullOr(Schema.Finite)),
    /** Su capa, o `null` si no tiene emplazamientos. */
    fichero: Schema.Array(Schema.NullOr(Schema.String)),
  }),
});
type ColumnasDelResumen = typeof ColumnasDelResumen.Type;

const ResumenEnJson = Schema.fromJsonString(ColumnasDelResumen);
const codificarResumen = Schema.encodeSync(ResumenEnJson);
const decodificarResumen = Schema.decodeUnknownResult(ResumenEnJson);

/** Lo que el resumen sabe de una provincia por los datos, sin la cobertura. */
export interface DatosDeProvincia {
  readonly codigo: string;
  readonly nombre: string;
  readonly etiqueta: Coordenada;
  /** La caja de sus emplazamientos, o `undefined` si no tiene ninguno. */
  readonly caja: Rectangulo | undefined;
  readonly emplazamientos: number;
  readonly companias: ReadonlyArray<Compania>;
  /** Su capa, o `undefined` si no tiene emplazamientos. */
  readonly fichero: string | undefined;
}

/** Una fila del resumen nacional. */
export interface ProvinciaDelResumen extends DatosDeProvincia {
  /** Si alguna zona de barrido la cubre entera: su número es el de toda la provincia. */
  readonly cubierta: boolean;
  /** Inicio del último barrido completo de lo que se sabe de ella, o `null`. */
  readonly barrido: number | null;
}

/** La caja que envuelve unos emplazamientos, con las posiciones redondeadas de la capa. */
export const cajaDeSituados = (
  situados: ReadonlyArray<EmplazamientoSituado>,
): Rectangulo | undefined => {
  if (situados.length === 0) return undefined;
  let [oeste, sur, este, norte] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { emplazamiento } of situados) {
    const x = redondear(emplazamiento.posicion.longitud);
    const y = redondear(emplazamiento.posicion.latitud);
    oeste = Math.min(oeste, x);
    este = Math.max(este, x);
    sur = Math.min(sur, y);
    norte = Math.max(norte, y);
  }
  return {
    suroeste: { longitud: oeste, latitud: sur },
    noreste: { longitud: este, latitud: norte },
  };
};

/** Las compañías con algún emplazamiento entre unos cuantos, en el orden de la capa. */
export const companiasDeSituados = (
  situados: ReadonlyArray<EmplazamientoSituado>,
): ReadonlyArray<Compania> =>
  companiasDeMascara(
    situados.reduce((bits, s) => bits | mascaraDeCompanias(s.emplazamiento.companias), 0),
  );

/**
 * El resumen nacional de una versión: una fila por provincia, por código, con si está cubierta y
 * su último barrido según `cobertura` y los cuadros con datos que toca cada una
 * (`cuadrosDeProvincias`). Es una función pura.
 */
export const generarResumen = (resumen: {
  readonly version: string;
  readonly fuentes: FuentesDeZonas;
  readonly cobertura: ReadonlyArray<ZonaBarrida>;
  readonly provincias: ReadonlyArray<DatosDeProvincia>;
  readonly cuadros: ReadonlyMap<string, ReadonlySet<Cuadro>>;
}): string => {
  const provincias = resumen.provincias.slice().sort(porCodigo);
  const estados = provincias.map((p) =>
    coberturaDeProvincia(resumen.cuadros.get(p.codigo) ?? new Set(), p.caja, resumen.cobertura),
  );
  const columnas: ColumnasDelResumen = {
    version: resumen.version,
    formato: FORMATO_PROVINCIAS,
    fuentes: resumen.fuentes,
    cobertura: resumen.cobertura,
    provincias: {
      codigo: provincias.map((p) => p.codigo),
      nombre: provincias.map((p) => p.nombre),
      lon: provincias.map((p) => redondear(p.etiqueta.longitud)),
      lat: provincias.map((p) => redondear(p.etiqueta.latitud)),
      caja: provincias.map((p) => (p.caja === undefined ? null : cajaDeRectangulo(p.caja))),
      emplazamientos: provincias.map((p) => p.emplazamientos),
      companias: provincias.map((p) => mascaraDeCompanias(p.companias)),
      cubierta: estados.map((e) => e.cubierta),
      barrido: estados.map((e) => e.barrido),
      fichero: provincias.map((p) => p.fichero ?? null),
    },
  };
  return codificarResumen(columnas);
};

/** El resumen nacional, leído. */
export interface ResumenLeido {
  readonly version: string;
  /** Fecha de la instantánea, en milisegundos: la marca de agua del mapa. */
  readonly fecha: number;
  readonly fuentes: FuentesDeZonas;
  readonly cobertura: ReadonlyArray<ZonaBarrida>;
  /** Por código INE. */
  readonly provincias: ReadonlyArray<ProvinciaDelResumen>;
}

/**
 * Lee el resumen nacional y comprueba, antes de analizar nada más, que su cabecera es la versión
 * `esperada`, la de `vigente.json`.
 */
export const leerResumen = (
  contenido: string,
  esperada: string,
): Result.Result<ResumenLeido, CapaIlegible | VersionDistinta> => {
  const cabecera = versionDeCabecera(contenido.slice(0, 64));
  if (Option.isNone(cabecera)) {
    return Result.fail(new CapaIlegible({ motivo: "el resumen no empieza por la versión" }));
  }
  if (cabecera.value !== esperada) {
    return Result.fail(new VersionDistinta({ esperada, encontrada: cabecera.value }));
  }
  const fecha = fechaDeVersion(cabecera.value);
  if (Option.isNone(fecha)) {
    return Result.fail(new CapaIlegible({ motivo: `versión mal formada: ${cabecera.value}` }));
  }
  return decodificarResumen(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap((c) => {
      const p = c.provincias;
      const n = p.codigo.length;
      const columnas = [
        p.nombre,
        p.lon,
        p.lat,
        p.caja,
        p.emplazamientos,
        p.companias,
        p.cubierta,
        p.barrido,
        p.fichero,
      ];
      if (columnas.some((columna) => columna.length !== n)) {
        return descuadrada("el resumen está descuadrado");
      }
      const provincias = p.codigo.map((codigo, i): ProvinciaDelResumen => {
        const caja = p.caja[i];
        return {
          codigo,
          nombre: p.nombre[i] ?? "",
          etiqueta: { longitud: p.lon[i] ?? 0, latitud: p.lat[i] ?? 0 },
          caja: caja === null || caja === undefined ? undefined : rectanguloDeCaja(caja),
          emplazamientos: p.emplazamientos[i] ?? 0,
          companias: companiasDeMascara(p.companias[i] ?? 0),
          cubierta: p.cubierta[i] ?? false,
          barrido: p.barrido[i] ?? null,
          fichero: p.fichero[i] ?? undefined,
        };
      });
      return Result.succeed({
        version: c.version,
        fecha: fecha.value,
        fuentes: c.fuentes,
        cobertura: c.cobertura,
        provincias,
      });
    }),
  );
};

// ── Manifiesto ──────────────────────────────────────────────────────────────────────────────────

/** Los ficheros con nombre por contenido de una versión: sus capas de provincia y sus lotes. */
export const Manifiesto = Schema.Struct({
  version: Schema.String,
  ficheros: Schema.Array(Schema.String),
});
export type Manifiesto = typeof Manifiesto.Type;

const ManifiestoEnJson = Schema.fromJsonString(Manifiesto);
const codificarManifiesto = Schema.encodeSync(ManifiestoEnJson);
/** Lee un manifiesto; falla si no tiene la forma esperada. */
export const decodificarManifiesto = Schema.decodeUnknownResult(ManifiestoEnJson);

/** El manifiesto de una versión, con sus ficheros ordenados. */
export const generarManifiesto = (version: string, ficheros: ReadonlyArray<string>): string =>
  codificarManifiesto({ version, ficheros: [...new Set(ficheros)].sort() });
