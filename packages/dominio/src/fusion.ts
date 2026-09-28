import { type Coordenada, distanciaMetros } from "./area.ts";
import { type Banda, compararBandas, compararTexto } from "./banda.ts";
import type { Compania } from "./compania.ts";
import { claveDeDireccion } from "./direccion.ts";
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
  /** Hasta esta distancia, también dos observaciones con la misma dirección (vía, número y municipio). */
  readonly radioMismaDireccionMetros: number;
  /**
   * Hasta esta distancia, también dos observaciones de la misma compañía con el mismo código
   * salvo ceros a la izquierda: son la misma estación base.
   */
  readonly radioMismoCodigoMetros: number;
}

export const REGLA_FUSION: ReglaFusion = {
  radioMetros: 15,
  radioMismaDireccionMetros: 30,
  radioMismoCodigoMetros: 60,
};

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
 * Pares de puntos a `radio` metros o menos, con su distancia. Reparte los puntos en una rejilla de
 * celdas algo mayores que el radio y solo compara cada punto con los de su celda y las vecinas.
 */
const paresCercanos = (
  posiciones: ReadonlyArray<Coordenada>,
  radioMetros: number,
): ReadonlyArray<readonly [number, number, number]> => {
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
  const pares: Array<readonly [number, number, number]> = [];
  posiciones.forEach((posicion, indice) => {
    const [x, y] = celdaDe(posicion);
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const otro of celdas.get(`${x + dx}:${y + dy}`) ?? []) {
          const vecina = posiciones[otro];
          const metros = vecina === undefined ? Infinity : distanciaMetros(posicion, vecina);
          if (otro > indice && metros <= radioMetros) {
            pares.push([indice, otro, metros]);
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
  `${observacion.compania}-${observacion.codigo.trim()}`;

const esOficial = (observacion: Observacion): boolean => observacion.fuente === "registro-oficial";

interface ObservacionConDireccion {
  readonly observacion: Observacion;
  /** `claveDeDireccion` de su dirección, calculada una vez. */
  readonly direccion: string | undefined;
}

/**
 * Si dos observaciones `presente` a `metros` una de otra van al mismo emplazamiento: por cercanía,
 * por tener la misma dirección o por ser la misma estación base con el código escrito con otros
 * ceros a la izquierda. En Madrid cada registro trae sus propias coordenadas, aunque sea de la
 * misma azotea o de la misma estación (ADR 0012).
 */
const vanJuntas = (
  regla: ReglaFusion,
  a: ObservacionConDireccion,
  b: ObservacionConDireccion,
  metros: number,
): boolean =>
  metros <= regla.radioMetros ||
  (metros <= regla.radioMismoCodigoMetros &&
    a.observacion.compania === b.observacion.compania &&
    normalizarCodigo(a.observacion.codigo) === normalizarCodigo(b.observacion.codigo)) ||
  (metros <= regla.radioMismaDireccionMetros &&
    a.direccion !== undefined &&
    a.direccion === b.direccion);

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
    codigos: unicos(presentes.map((o) => o.codigo.trim())),
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
 *   emplazamiento. También las que tienen la misma dirección hasta `radioMismaDireccionMetros`, y
 *   las de una compañía con el mismo código salvo ceros a la izquierda hasta
 *   `radioMismoCodigoMetros`. La unión se encadena: si A va con B y B con C, van juntas.
 * - Una observación de otra fuente con la compañía y el código exacto de una del registro
 *   oficial va con ella, esté donde esté. Si está a más del radio, es un conflicto de posición.
 * - En cada emplazamiento hay una estación base por compañía, con la unión de las bandas.
 * - Una observación `desmontada` va con la del registro de su mismo código o, si no hay, al
 *   emplazamiento más cercano que tenga esa compañía dentro del radio. Si no hay ninguno, no
 *   crea nada.
 *
 * Es determinista: el resultado no depende del orden de la entrada y sale ordenado por clave.
 * La clave es la compañía y el código de la observación de menor clave del registro oficial
 * (o de cualquier fuente si el registro no lo conoce).
 */
export const fusionar = (
  observaciones: ReadonlyArray<Observacion>,
  regla: ReglaFusion = REGLA_FUSION,
): ReadonlyArray<Emplazamiento> => {
  const ordenadas = [...observaciones].sort(compararObservaciones);
  const presentes = ordenadas.filter((o) => o.afirma === "presente");
  const conjuntos = conjuntosDisjuntos(presentes.length);
  const alcance = Math.max(
    regla.radioMetros,
    regla.radioMismaDireccionMetros,
    regla.radioMismoCodigoMetros,
  );
  const conDireccion = presentes.map((observacion): ObservacionConDireccion => ({
    observacion,
    direccion: claveDeDireccion(observacion.direccion),
  }));
  for (const [a, b, metros] of paresCercanos(
    presentes.map((o) => o.posicion),
    alcance,
  )) {
    const [primera, segunda] = [conDireccion[a], conDireccion[b]];
    if (
      primera !== undefined &&
      segunda !== undefined &&
      vanJuntas(regla, primera, segunda, metros)
    ) {
      conjuntos.unir(a, b);
    }
  }
  // Una observación de otra fuente con el código exacto de una del registro oficial es la misma
  // estación base, esté donde esté: va a su emplazamiento.
  const oficialPorCodigo = new Map<string, number>();
  presentes.forEach((observacion, indice) => {
    if (esOficial(observacion) && !oficialPorCodigo.has(claveDeEstacion(observacion))) {
      oficialPorCodigo.set(claveDeEstacion(observacion), indice);
    }
  });
  presentes.forEach((observacion, indice) => {
    const oficial = oficialPorCodigo.get(claveDeEstacion(observacion));
    if (!esOficial(observacion) && oficial !== undefined) {
      conjuntos.unir(indice, oficial);
    }
  });
  const grupos = new Map<number, Array<Observacion>>();
  presentes.forEach((observacion, indice) => {
    const raiz = conjuntos.raiz(indice);
    grupos.set(raiz, [...(grupos.get(raiz) ?? []), observacion]);
  });

  for (const desmontada of ordenadas.filter((o) => o.afirma === "desmontada")) {
    const oficial = oficialPorCodigo.get(claveDeEstacion(desmontada));
    const delMismoCodigo = oficial === undefined ? undefined : grupos.get(conjuntos.raiz(oficial));
    if (delMismoCodigo !== undefined) {
      delMismoCodigo.push(desmontada);
      continue;
    }
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
  return clavesUnicas(
    [...grupos.values()].map((grupo) =>
      emplazamientoDe(grupo, [
        ...(conflictosPorGrupo.get(grupo) ?? []),
        ...lejosDelRegistro(grupo, regla),
      ]),
    ),
  );
};

/**
 * Observaciones de otras fuentes que la unión por código ha llevado junto a la del registro
 * oficial, pero que la sitúan a más del radio: un conflicto de posición por cada código, con la
 * mayor distancia.
 */
const lejosDelRegistro = (
  grupo: ReadonlyArray<Observacion>,
  regla: ReglaFusion,
): ReadonlyArray<Conflicto> => {
  const oficiales = grupo.filter((o) => esOficial(o) && o.afirma === "presente");
  const metrosPorCodigo = new Map<string, { readonly muestra: Observacion; metros: number }>();
  for (const otra of grupo.filter((o) => !esOficial(o))) {
    const clave = claveDeEstacion(otra);
    for (const oficial of oficiales.filter((o) => claveDeEstacion(o) === clave)) {
      const metros = distanciaMetros(oficial.posicion, otra.posicion);
      const previa = metrosPorCodigo.get(clave);
      if (metros > regla.radioMetros && (previa === undefined || metros > previa.metros)) {
        metrosPorCodigo.set(clave, { muestra: otra, metros });
      }
    }
  }
  return [...metrosPorCodigo.values()].map(({ muestra, metros }): Conflicto => ({
    tipo: "posicion-distinta",
    compania: muestra.compania,
    codigo: muestra.codigo.trim(),
    metros: Math.round(metros),
  }));
};

/**
 * Ordena por clave y numera las repetidas (`-2`, `-3`…) de sur a norte y de oeste a este. Solo
 * se repiten si el mismo código de una compañía aparece en dos sitios alejados.
 */
const clavesUnicas = (
  emplazamientos: ReadonlyArray<Emplazamiento>,
): ReadonlyArray<Emplazamiento> => {
  const ordenados = [...emplazamientos].sort(
    (a, b) =>
      compararTexto(a.clave, b.clave) ||
      a.posicion.latitud - b.posicion.latitud ||
      a.posicion.longitud - b.posicion.longitud,
  );
  const vistas = new Map<string, number>();
  return ordenados.map((emplazamiento) => {
    const repeticion = (vistas.get(emplazamiento.clave) ?? 0) + 1;
    vistas.set(emplazamiento.clave, repeticion);
    return repeticion === 1
      ? emplazamiento
      : { ...emplazamiento, clave: `${emplazamiento.clave}-${repeticion}` };
  });
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
      codigo: muestra.codigo.trim(),
      metros: Math.round(metros),
    };
    for (const grupo of repetidos) {
      resultado.set(grupo, [...(resultado.get(grupo) ?? []), conflicto]);
    }
  }
  return resultado;
};
