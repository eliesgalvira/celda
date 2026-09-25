import { type Coordenada, distanciaMetros } from "./area.ts";
import { type Banda, compararBandas, compararTexto } from "./banda.ts";
import type { Compania } from "./compania.ts";
import type {
  Confianza,
  Conflicto,
  Emplazamiento,
  Estado,
  EstacionBase,
  Procedencia,
} from "./emplazamiento.ts";
import { type Fuente, normalizarCodigo, type Observacion } from "./observacion.ts";

/** Parámetros de la fusión. Ver el ADR 0012. */
export interface ReglaFusion {
  /** Dos observaciones a esta distancia o menos están en el mismo emplazamiento. */
  readonly radioMetros: number;
}

export const REGLA_FUSION: ReglaFusion = { radioMetros: 20 };

const METROS_POR_GRADO = 111_320;

/** Conjuntos disjuntos sobre índices, para juntar observaciones cercanas en grupos. */
const conjuntosDisjuntos = (tamano: number) => {
  const padre = Array.from({ length: tamano }, (_, indice) => indice);
  const raiz = (indice: number): number => {
    let actual = indice;
    while (padre[actual] !== actual) {
      const siguiente = padre[actual] ?? actual;
      padre[actual] = padre[siguiente] ?? siguiente;
      actual = siguiente;
    }
    return actual;
  };
  const unir = (a: number, b: number): void => {
    const [ra, rb] = [raiz(a), raiz(b)];
    if (ra !== rb) {
      padre[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  };
  return { raiz, unir };
};

/**
 * Pares de puntos a `radio` metros o menos. Reparte los puntos en una rejilla de celdas algo
 * mayores que el radio y solo compara cada punto con los de su celda y las vecinas.
 */
const paresCercanos = (
  posiciones: ReadonlyArray<Coordenada>,
  radioMetros: number,
): ReadonlyArray<readonly [number, number]> => {
  const alto = radioMetros / METROS_POR_GRADO;
  // A 60° de latitud un grado de longitud mide la mitad; más al sur la celda sobra.
  const ancho = alto / Math.cos(Math.PI / 3);
  const celdas = new Map<string, Array<number>>();
  const celdaDe = (p: Coordenada) =>
    [Math.floor(p.longitud / ancho), Math.floor(p.latitud / alto)] as const;
  posiciones.forEach((posicion, indice) => {
    const [x, y] = celdaDe(posicion);
    const clave = `${x}:${y}`;
    celdas.set(clave, [...(celdas.get(clave) ?? []), indice]);
  });
  const pares: Array<readonly [number, number]> = [];
  posiciones.forEach((posicion, indice) => {
    const [x, y] = celdaDe(posicion);
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const otro of celdas.get(`${x + dx}:${y + dy}`) ?? []) {
          const vecina = posiciones[otro];
          if (
            otro > indice &&
            vecina !== undefined &&
            distanciaMetros(posicion, vecina) <= radioMetros
          ) {
            pares.push([indice, otro]);
          }
        }
      }
    }
  });
  return pares;
};

const compararObservaciones = (a: Observacion, b: Observacion): number =>
  compararTexto(a.fuente, b.fuente) || compararTexto(a.clave, b.clave);

const unicos = <Texto extends string>(valores: ReadonlyArray<Texto>): ReadonlyArray<Texto> =>
  [...new Set(valores)].sort(compararTexto);

const claveDeEstacion = (observacion: Observacion): string =>
  `${observacion.compania}-${normalizarCodigo(observacion.codigo)}`;

const esOficial = (observacion: Observacion): boolean => observacion.fuente === "registro-oficial";

/** El valor más repetido y, si empatan, el primero en orden. */
const masFrecuente = (valores: ReadonlyArray<string>): string => {
  const cuentas = new Map<string, number>();
  for (const valor of valores) {
    cuentas.set(valor, (cuentas.get(valor) ?? 0) + 1);
  }
  return [...cuentas].sort(([a, na], [b, nb]) => nb - na || compararTexto(a, b)).at(0)?.[0] ?? "";
};

const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

const centro = (posiciones: ReadonlyArray<Coordenada>): Coordenada => ({
  longitud: redondear(
    posiciones.reduce((suma, p) => suma + p.longitud, 0) / Math.max(posiciones.length, 1),
  ),
  latitud: redondear(
    posiciones.reduce((suma, p) => suma + p.latitud, 0) / Math.max(posiciones.length, 1),
  ),
});

const procedencia = (observacion: Observacion): Procedencia => ({
  fuente: observacion.fuente,
  clave: observacion.clave,
});

/** Une las bandas de varias observaciones. Un expediente repetido cuenta una vez. */
const unirBandas = (observaciones: ReadonlyArray<Observacion>): ReadonlyArray<Banda> => {
  const porReferencia = new Map<string, Banda>();
  for (const banda of observaciones.flatMap((o) => o.bandas)) {
    const clave = `${banda.compania}|${banda.referencia}`;
    if (!porReferencia.has(clave)) {
      porReferencia.set(clave, banda);
    }
  }
  return [...porReferencia.values()].sort(compararBandas);
};

const estacionDe = (
  compania: Compania,
  observaciones: ReadonlyArray<Observacion>,
): EstacionBase => {
  const presentes = observaciones.filter((o) => o.afirma === "presente");
  return {
    compania,
    codigos: unicos(presentes.map((o) => normalizarCodigo(o.codigo))),
    bandas: unirBandas(presentes),
    observaciones: observaciones.map(procedencia),
  };
};

/** Conflictos que se ven dentro de un grupo de observaciones. */
const conflictosDelGrupo = (
  porCompania: ReadonlyMap<Compania, ReadonlyArray<Observacion>>,
): ReadonlyArray<Conflicto> =>
  [...porCompania].flatMap(([compania, observaciones]): ReadonlyArray<Conflicto> => {
    const desmontadas = observaciones
      .filter((o) => o.afirma === "desmontada")
      .map((o): Conflicto => ({
        tipo: "desmontada",
        compania,
        procedencia: procedencia(o),
        fecha: o.fecha,
      }));
    const presentes = observaciones.filter((o) => o.afirma === "presente");
    const codigosPorFuente = unicos(presentes.map((o) => o.fuente)).map((fuente) =>
      unicos(presentes.filter((o) => o.fuente === fuente).map((o) => normalizarCodigo(o.codigo))),
    );
    const iguales = codigosPorFuente.every(
      (codigos) => codigos.join(" ") === codigosPorFuente[0]?.join(" "),
    );
    const codigosDistintos: ReadonlyArray<Conflicto> = iguales
      ? []
      : [
          {
            tipo: "codigos-distintos",
            compania,
            codigos: unicos(codigosPorFuente.flat()),
          },
        ];
    return [...desmontadas, ...codigosDistintos];
  });

const estadoDe = (
  porCompania: ReadonlyMap<Compania, ReadonlyArray<Observacion>>,
  conflictos: ReadonlyArray<Conflicto>,
): Estado => {
  const presentes = [...porCompania.values()].flat().filter((o) => o.afirma === "presente");
  if (!presentes.some(esOficial)) {
    return "nuevo";
  }
  const companiaSinRegistro = [...porCompania.values()].some(
    (observaciones) => !observaciones.some(esOficial),
  );
  return companiaSinRegistro || conflictos.some((c) => c.tipo === "desmontada")
    ? "corregido"
    : "verificado";
};

const confianzaDe = (
  fuentes: ReadonlyArray<Fuente>,
  conflictos: ReadonlyArray<Conflicto>,
): Confianza => {
  if (conflictos.length > 0) {
    return "baja";
  }
  return fuentes.length > 1 ? "alta" : "media";
};

const emplazamientoDe = (
  grupo: ReadonlyArray<Observacion>,
  conflictosExternos: ReadonlyArray<Conflicto>,
): Emplazamiento => {
  const porCompania = new Map<Compania, Array<Observacion>>();
  for (const observacion of grupo) {
    porCompania.set(observacion.compania, [
      ...(porCompania.get(observacion.compania) ?? []),
      observacion,
    ]);
  }
  const presentes = grupo.filter((o) => o.afirma === "presente");
  const oficiales = presentes.filter(esOficial);
  const base = oficiales.length > 0 ? oficiales : presentes;
  const conflictos = [...conflictosDelGrupo(porCompania), ...conflictosExternos];
  const fuentes = unicos(grupo.map((o) => o.fuente));
  return {
    clave: unicos(base.map(claveDeEstacion))[0] ?? "",
    posicion: centro(base.map((o) => o.posicion)),
    direccion: masFrecuente(base.map((o) => o.direccion)),
    municipio: masFrecuente(base.map((o) => o.municipio)),
    estado: estadoDe(porCompania, conflictos),
    confianza: confianzaDe(fuentes, conflictos),
    conflictos,
    estaciones: [...porCompania]
      .sort(([a], [b]) => compararTexto(a, b))
      .map(([compania, observaciones]) => estacionDe(compania, observaciones)),
    fuentes,
    datosDel: Math.max(...grupo.map((o) => o.fecha)),
  };
};

/**
 * Junta las observaciones de todas las fuentes en emplazamientos.
 *
 * - Las observaciones `presente` a `radioMetros` o menos, de cualquier compañía, van al mismo
 *   emplazamiento. La cercanía se encadena: si A está cerca de B y B de C, van juntas.
 * - En cada emplazamiento hay una estación base por compañía, con la unión de las bandas.
 * - Una observación `desmontada` se une al emplazamiento más cercano que tenga esa compañía
 *   dentro del radio. Si no hay ninguno, no crea nada.
 *
 * Es determinista: el resultado no depende del orden de la entrada y sale ordenado por clave.
 */
export const fusionar = (
  observaciones: ReadonlyArray<Observacion>,
  regla: ReglaFusion = REGLA_FUSION,
): ReadonlyArray<Emplazamiento> => {
  const ordenadas = [...observaciones].sort(compararObservaciones);
  const presentes = ordenadas.filter((o) => o.afirma === "presente");
  const conjuntos = conjuntosDisjuntos(presentes.length);
  for (const [a, b] of paresCercanos(
    presentes.map((o) => o.posicion),
    regla.radioMetros,
  )) {
    conjuntos.unir(a, b);
  }
  const grupos = new Map<number, Array<Observacion>>();
  presentes.forEach((observacion, indice) => {
    const raiz = conjuntos.raiz(indice);
    grupos.set(raiz, [...(grupos.get(raiz) ?? []), observacion]);
  });

  for (const desmontada of ordenadas.filter((o) => o.afirma === "desmontada")) {
    const candidatos = [...grupos.values()]
      .flatMap((grupo) =>
        grupo
          .filter((o) => o.afirma === "presente" && o.compania === desmontada.compania)
          .map((o) => [grupo, distanciaMetros(o.posicion, desmontada.posicion)] as const),
      )
      .filter(([, metros]) => metros <= regla.radioMetros)
      .sort(([, a], [, b]) => a - b);
    candidatos[0]?.[0].push(desmontada);
  }

  const conflictosPorGrupo = posicionesDistintas([...grupos.values()]);
  return [...grupos.values()]
    .map((grupo) => emplazamientoDe(grupo, conflictosPorGrupo.get(grupo) ?? []))
    .sort((a, b) => compararTexto(a.clave, b.clave));
};

/**
 * Un mismo código de una compañía en grupos distintos es un conflicto de posición en cada uno
 * de ellos, con la mayor distancia entre sus observaciones.
 */
const posicionesDistintas = (
  grupos: ReadonlyArray<ReadonlyArray<Observacion>>,
): ReadonlyMap<ReadonlyArray<Observacion>, ReadonlyArray<Conflicto>> => {
  const gruposPorEstacion = new Map<
    string,
    { readonly muestra: Observacion; readonly grupos: Array<ReadonlyArray<Observacion>> }
  >();
  for (const grupo of grupos) {
    const vistas = new Set<string>();
    for (const observacion of grupo.filter((o) => o.afirma === "presente")) {
      const clave = claveDeEstacion(observacion);
      if (vistas.has(clave)) {
        continue;
      }
      vistas.add(clave);
      const previa = gruposPorEstacion.get(clave);
      if (previa === undefined) {
        gruposPorEstacion.set(clave, { muestra: observacion, grupos: [grupo] });
      } else {
        previa.grupos.push(grupo);
      }
    }
  }
  const resultado = new Map<ReadonlyArray<Observacion>, Array<Conflicto>>();
  for (const [clave, { muestra, grupos: repetidos }] of gruposPorEstacion) {
    if (repetidos.length < 2) {
      continue;
    }
    const posiciones = repetidos.flatMap((grupo) =>
      grupo.filter((o) => claveDeEstacion(o) === clave).map((o) => o.posicion),
    );
    const metros = Math.max(
      ...posiciones.flatMap((a) => posiciones.map((b) => distanciaMetros(a, b))),
    );
    const conflicto: Conflicto = {
      tipo: "posicion-distinta",
      compania: muestra.compania,
      codigo: normalizarCodigo(muestra.codigo),
      metros: Math.round(metros),
    };
    for (const grupo of repetidos) {
      resultado.set(grupo, [...(resultado.get(grupo) ?? []), conflicto]);
    }
  }
  return resultado;
};
