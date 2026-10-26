import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  FUENTE_DE_PARAMETROS,
  GRUPOS_DE_LINEAS,
  type GrupoDeLineas,
  NOMBRE_GRUPO,
  PARAMETROS_POR_DEFECTO,
  type ParametrosDelEjercicio,
  type ProvinciasDelBorde,
  provinciasParaLasVecinas,
  resolverEjercicio,
} from "@celda/dominio/ejercicio";
import { enumerar } from "@celda/dominio/enumerar";
import type { IndiceDeMunicipios } from "@celda/dominio/municipio";
import type { PoblacionDeBarrios } from "@celda/dominio/poblacion";
import type { ResumenLeido } from "@celda/dominio/provincias";
import {
  buscarZonas,
  type IndiceDeZonas,
  MUNICIPIO_DE_BARCELONA,
  provinciaDeZona,
  zonaDeCodigo,
} from "@celda/dominio/zonaDelEjercicio";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Acciones, Boton, Enlace } from "@celda/ui/Boton.tsx";
import { CampoNumero, Segmentado, Selector } from "@celda/ui/Eleccion.tsx";
import {
  BuscadorDeZonas,
  CadenaDelCalculo,
  EsqueletoEjercicio,
  RejillaDeCampos,
  TablaDelEjercicio,
  TextoEjercicio,
} from "@celda/ui/ejercicio/Ejercicio.tsx";
import { Nota } from "@celda/ui/medir/Medir.tsx";
import { CabeceraFicha, SeccionFicha } from "@celda/ui/panel/Ficha.tsx";
import type { AlturaHoja } from "@celda/ui/panel/hoja.ts";
import { PanelEmplazamiento } from "@celda/ui/panel/PanelEmplazamiento.tsx";
import { recurso, recursoFijo } from "@celda/ui/recurso.ts";
import { Termino } from "@celda/ui/termino/Termino.tsx";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";

import type { EstadoProvincia } from "../capa/nacional.ts";
import { usarDatos } from "../datos.tsx";
import { type BandasLeidas, bandasDeEmplazamiento, leerBandas } from "./bandas.ts";
import {
  conBarrios,
  type Descarga,
  emplazamientosDeLaZona,
  estadoDeLaZona,
  provinciasConVecinas,
  zonaDelPunto,
  zonasParaBuscar,
} from "./estado.ts";
import { cadenaDelRadio, cadenaDeUsuarios } from "./textos.ts";
import {
  citaDeLimites,
  citaDelPadron,
  csvDeTabla,
  decimal,
  entero,
  fuenteDeParametros,
  nombreDeFichero,
  tablaDelEjercicio,
} from "./tabla.ts";
import {
  cargarContornos,
  cargarIndiceDeZonas,
  cargarPoblacion,
  encuadreDe,
  SIN_ZONA,
  type ZonaEnMapa,
  zonaEnMapa,
} from "./zona.ts";

type EstadoBandas =
  | { readonly tipo: "sin-leer" }
  | { readonly tipo: "leyendo" }
  | { readonly tipo: "leidas"; readonly leidas: BandasLeidas; readonly fecha: number };

export interface PanelEjercicioProps {
  /** El código de la zona: dos cifras para un barrio, cinco para un municipio, o `""`. */
  readonly zona: string;
  /** El resumen nacional, si ya ha llegado: dice qué provincias tienen capa y sus fuentes. */
  readonly resumen: ResumenLeido | undefined;
  /** Cómo va cada provincia pedida. */
  readonly provincias: ReadonlyMap<string, EstadoProvincia>;
  /** Los emplazamientos de las provincias que han llegado, con su barrio y su municipio. */
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  readonly alElegirZona: (codigo: string) => void;
  /** Pide las capas de unas provincias; las ya pedidas no se vuelven a pedir. */
  readonly alPedirProvincias: (codigos: ReadonlyArray<string>) => void;
  readonly alReintentarProvincias: (codigos: ReadonlyArray<string>) => void;
  /** Pide el punto que se toque en el mapa a partir de ahora, o deja de pedirlo con `undefined`. */
  readonly alEsperarPunto: (alTocar: ((punto: Coordenada) => void) | undefined) => void;
  /** Lo que el mapa dibuja de la zona y, al cambiar de zona, dónde encuadrarla. */
  readonly alDibujar: (zona: ZonaEnMapa, encuadre: Rectangulo | undefined) => void;
  readonly alCerrar: () => void;
}

const SIN_BORDE: ProvinciasDelBorde = { faltan: [], incompletas: [] };

/** Antes de leer las fichas no se sabe de ninguna estación base sin ficha en el registro. */
const SIN_MARCAS: ReadonlyMap<string, ReadonlyArray<Compania>> = new Map();

/** Descarga un CSV como fichero, sin pasar por ningún servidor. */
const descargarCsv = (csv: string, nombre: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  // El navegador empieza la descarga al hacer clic: la dirección ya no hace falta.
  URL.revokeObjectURL(url);
};

/**
 * Lo que se dice de las estaciones base sin ficha en el registro tras leer las fichas: cuántas y
 * de qué compañías. No se dan por pendientes: el registro las lista pero no tiene su ficha.
 */
const textoSinFichaEnRegistro = (sinFicha: {
  readonly estaciones: number;
  readonly companias: ReadonlyArray<string>;
}): string =>
  sinFicha.estaciones === 0
    ? ""
    : sinFicha.estaciones === 1
      ? ` Una estación base de ${enumerar(sinFicha.companias)} no tiene ficha en el registro, y en sus bandas la tabla pone «no consta».`
      : ` ${entero(sinFicha.estaciones)} estaciones base de ${enumerar(sinFicha.companias)} no tienen ficha en el registro, y en sus bandas la tabla pone «no consta».`;

/**
 * El ejercicio de emplazamientos del modo estudiante, en el panel de la izquierda o en la hoja del
 * móvil. Se elige un municipio de España o un barrio de Barcelona, buscándolo o tocándolo en el
 * mapa, y el panel cuenta, por compañía, sus estaciones base, el radio de cobertura, los
 * habitantes y usuarios por estación y las tecnologías y bandas, con la fuente de cada valor, y
 * deja descargar la tabla. Pide las capas de la provincia de la zona y de las vecinas que hagan
 * falta para el radio, y el contorno de su provincia.
 */
export function PanelEjercicio(props: PanelEjercicioProps) {
  const datos = usarDatos();
  const [altura, setAltura] = createSignal<AlturaHoja>("media");
  const [indice, setIndice] = createSignal<Descarga<IndiceDeZonas>>({ tipo: "cargando" });
  const [poblacion, setPoblacion] = createSignal<Descarga<PoblacionDeBarrios>>({
    tipo: "cargando",
  });
  const [contornos, setContornos] = createSignal<ReadonlyMap<string, Descarga<IndiceDeMunicipios>>>(
    new Map(),
  );
  const [consulta, setConsulta] = createSignal("");
  const [eligiendo, setEligiendo] = createSignal(false);
  const [fueraDelMapa, setFueraDelMapa] = createSignal(false);
  const [parametros, setParametros] = createSignal<ParametrosDelEjercicio>(PARAMETROS_POR_DEFECTO);
  const [elegida, setElegida] = createSignal<Compania>();
  const [bandas, setBandas] = createSignal<EstadoBandas>({ tipo: "sin-leer" });
  // Cada lectura de bandas tiene su número: una que acaba después de cambiar de zona no vale.
  let lectura = 0;
  // Lo mismo para las descargas del índice y de los habitantes por barrio.
  let descargaDeZonas = 0;
  /**
   * Los contornos ya pedidos y los ya leídos. No son señales: se consultan justo después de
   * escribir, y en Solid 2 una señal escrita no cambia hasta el siguiente `flush`.
   */
  const contornosPedidos = new Map<string, Promise<void>>();
  const contornosLeidos = new Map<string, Descarga<IndiceDeMunicipios>>();
  const parar = new AbortController();

  const cargarZonas = () => {
    descargaDeZonas += 1;
    const esta = descargaDeZonas;
    setIndice({ tipo: "cargando" });
    setPoblacion({ tipo: "cargando" });
    void datos.runPromiseExit(cargarIndiceDeZonas, { signal: parar.signal }).then((salida) => {
      if (esta === descargaDeZonas) {
        setIndice(
          Exit.isSuccess(salida) ? { tipo: "lista", datos: salida.value } : { tipo: "fallo" },
        );
      }
    });
    void datos.runPromiseExit(cargarPoblacion, { signal: parar.signal }).then((salida) => {
      if (esta === descargaDeZonas) {
        setPoblacion(
          Exit.isSuccess(salida) ? { tipo: "lista", datos: salida.value } : { tipo: "fallo" },
        );
      }
    });
  };

  /** Descarga los contornos de unas provincias, una vez cada una salvo que fallen. */
  const cargarContornosDe = (codigos: ReadonlyArray<string>): Promise<void> =>
    Promise.all(
      codigos.map((codigo) => {
        const pedido = contornosPedidos.get(codigo);
        if (pedido !== undefined) return pedido;
        const poner = (estado: Descarga<IndiceDeMunicipios>) => {
          contornosLeidos.set(codigo, estado);
          setContornos((antes) => new Map(antes).set(codigo, estado));
        };
        poner({ tipo: "cargando" });
        const nuevo = datos
          .runPromiseExit(cargarContornos(codigo), { signal: parar.signal })
          .then((salida) => {
            if (parar.signal.aborted) return;
            if (Exit.isFailure(salida)) contornosPedidos.delete(codigo);
            poner(
              Exit.isSuccess(salida) ? { tipo: "lista", datos: salida.value } : { tipo: "fallo" },
            );
          });
        contornosPedidos.set(codigo, nuevo);
        return nuevo;
      }),
    ).then(() => undefined);

  recursoFijo("ejercicio:zonas", () => {
    cargarZonas();
    return () => {
      lectura += 1;
      descargaDeZonas += 1;
      parar.abort();
      props.alEsperarPunto(undefined);
      props.alDibujar(SIN_ZONA, undefined);
    };
  });

  const zona = createMemo(() => zonaDeCodigo(props.zona));
  const provincia = createMemo(() => {
    const actual = zona();
    return actual === undefined ? undefined : provinciaDeZona(actual);
  });
  const capaDeLaZona = createMemo(() => {
    const codigo = provincia();
    return codigo === undefined ? undefined : props.provincias.get(codigo);
  });
  const estado = createMemo(() => {
    const actual = zona();
    const codigo = provincia();
    return estadoDeLaZona(actual, {
      indice: indice(),
      poblacion: poblacion(),
      resumen: props.resumen,
      capa: capaDeLaZona(),
      contornos:
        actual?.tipo === "municipio" && codigo !== undefined ? contornos().get(codigo) : undefined,
    });
  });
  const resuelta = createMemo(() => {
    const actual = estado();
    return actual.tipo === "lista" ? actual.zona : undefined;
  });
  const nombreDeLaZona = createMemo(() => {
    const actual = estado();
    if (actual.tipo === "lista") return actual.zona.titulo;
    return actual.tipo === "sin-zona" ? undefined : actual.nombre;
  });

  // La capa de la provincia de la zona, si la tiene, y sus contornos si es un municipio.
  recurso(
    "ejercicio:provincia",
    () => {
      const codigo = provincia();
      const suya = props.resumen?.provincias.find((p) => p.codigo === codigo);
      return suya?.fichero === undefined ? undefined : suya.codigo;
    },
    (codigo) => {
      props.alPedirProvincias([codigo]);
      return undefined;
    },
  );
  recurso(
    "ejercicio:contornos",
    () => {
      // Sin capa de la provincia no hay ejercicio: su contorno no hace falta.
      const codigo = provincia();
      const suya = props.resumen?.provincias.find((p) => p.codigo === codigo);
      return zona()?.tipo === "municipio" && suya?.fichero !== undefined ? codigo : undefined;
    },
    (codigo) => {
      void cargarContornosDe([codigo]);
      return undefined;
    },
  );

  const enZona = createMemo(() => {
    const actual = resuelta();
    return actual === undefined ? [] : emplazamientosDeLaZona(actual.zona, props.emplazamientos);
  });
  const cargadas = createMemo(
    () =>
      new Set(
        [...props.provincias].flatMap(([codigo, estado]) =>
          estado.tipo === "lista" ? [codigo] : [],
        ),
      ),
  );
  /** Las provincias de al lado que pueden tener la vecina de alguna estación de la zona. */
  const borde = createMemo(() => {
    const resumen = props.resumen;
    if (resuelta() === undefined || resumen === undefined) return SIN_BORDE;
    return provinciasParaLasVecinas({
      enZona: enZona(),
      todos: props.emplazamientos,
      provincias: provinciasConVecinas(resumen),
      cargadas: cargadas(),
    });
  });
  recurso(
    "ejercicio:vecinas",
    () => {
      const faltan = borde().faltan;
      return faltan.length === 0 ? undefined : faltan.join(",");
    },
    (clave) => {
      props.alPedirProvincias(clave.split(","));
      return undefined;
    },
  );
  const nombreDeProvincia = (codigo: string) =>
    props.resumen?.provincias.find((p) => p.codigo === codigo)?.nombre ?? codigo;
  const vecinasPendientes = createMemo(() =>
    borde().faltan.filter((codigo) => props.provincias.get(codigo)?.tipo !== "fallo"),
  );
  const vecinasFallidas = createMemo(() =>
    borde().faltan.filter((codigo) => props.provincias.get(codigo)?.tipo === "fallo"),
  );

  const leidas = createMemo(() => {
    const actual = bandas();
    return actual.tipo === "leidas" ? actual : undefined;
  });

  /**
   * Las bandas de la capa del mapa, por emplazamiento de la zona. Solo trae las conocidas; de una
   * compañía sin ninguna no se sabe nada.
   */
  const bandasDeLaCapa = createMemo(
    () => new Map(enZona().map((e) => [e.clave, bandasDeEmplazamiento(e)] as const)),
  );
  const conBandasEnCapa = createMemo(
    () => enZona().filter((e) => (e.bandas?.length ?? 0) > 0).length,
  );

  /**
   * Fichas leídas sin ninguna banda conocida de ninguna compañía. Las estaciones base sin ficha en
   * el registro no cuentan: se cuentan aparte.
   */
  const sinBandas = createMemo(() => {
    const hecho = leidas()?.leidas;
    if (hecho === undefined) return 0;
    return [...hecho.bandas].filter(([clave, porCompania]) => {
      const sinFicha = hecho.sinFichaEnRegistro.get(clave) ?? [];
      const resto = Compania.literals.flatMap((compania) => {
        const suyas = porCompania[compania];
        return suyas === undefined || sinFicha.includes(compania) ? [] : [suyas];
      });
      return resto.length > 0 && resto.every((suyas) => suyas.every((mhz) => mhz === null));
    }).length;
  });

  const resultado = createMemo(() => {
    const actual = resuelta();
    if (actual === undefined) return undefined;
    return resolverEjercicio({
      habitantes: actual.habitantes,
      areaKm2: actual.areaKm2,
      enZona: enZona(),
      todos: props.emplazamientos,
      bandas: leidas()?.leidas.bandas ?? bandasDeLaCapa(),
      sinFichaEnRegistro: leidas()?.leidas.sinFichaEnRegistro ?? SIN_MARCAS,
      parametros: parametros(),
    });
  });

  /** Las estaciones base de la zona sin ficha en el registro, y de qué compañías son. */
  const sinFichaEnRegistro = createMemo(() => {
    const deLaZona = (resultado()?.companias ?? []).filter((c) => c.sinFichaEnRegistro > 0);
    return {
      estaciones: deLaZona.reduce((suma, c) => suma + c.sinFichaEnRegistro, 0),
      companias: deLaZona.map((c) => NOMBRE_COMPANIA[c.compania]),
    };
  });

  const presentes = createMemo(() => resultado()?.companias.filter((c) => c.estaciones > 0) ?? []);
  /** La compañía de las cadenas: la elegida si tiene estaciones aquí, o la primera que tenga. */
  const compania = createMemo(() => {
    const aqui = presentes();
    const actual = elegida();
    return aqui.find((c) => c.compania === actual) ?? aqui[0];
  });

  // Otra zona: las bandas leídas eran de otros emplazamientos.
  createEffect(
    () => props.zona,
    () => {
      lectura += 1;
      setBandas({ tipo: "sin-leer" });
    },
    { defer: true },
  );

  // El mapa enseña la zona y las vecinas de la compañía de las cadenas, y encuadra la zona
  // cuando cambia.
  let encuadrada = "";
  createEffect(
    () => {
      const actual = resuelta();
      return {
        actual,
        dibujo:
          actual === undefined
            ? SIN_ZONA
            : zonaEnMapa(actual.poligonos, compania()?.vecinas ?? [], props.emplazamientos),
      };
    },
    ({ actual, dibujo }) => {
      if (actual === undefined) {
        props.alDibujar(SIN_ZONA, undefined);
        return;
      }
      const clave = `${actual.zona.tipo}:${actual.zona.codigo}`;
      const nueva = encuadrada !== clave;
      encuadrada = clave;
      props.alDibujar(dibujo, nueva ? encuadreDe(actual.poligonos) : undefined);
    },
  );

  const fuenteParametros = createMemo(() => fuenteDeParametros(parametros()));
  /** La fecha de los emplazamientos de la zona: la de la capa de su provincia. */
  const fechaCapa = createMemo(() => {
    const actual = capaDeLaZona();
    return actual?.tipo === "lista" ? actual.provincia.fecha : (props.resumen?.fecha ?? 0);
  });

  const tabla = createMemo(() => {
    const actual = resultado();
    const zonaActual = resuelta();
    if (actual === undefined || zonaActual === undefined) return undefined;
    const hecho = leidas();
    return tablaDelEjercicio(actual, {
      zona: zonaActual.titulo,
      origen: zonaActual.origen,
      fechaCapa: fechaCapa(),
      parametros: parametros(),
      bandas:
        hecho === undefined
          ? { de: "capa", fecha: fechaCapa() }
          : { de: "fichas", fecha: hecho.fecha },
    });
  });

  const leer = () => {
    lectura += 1;
    const esta = lectura;
    setBandas({ tipo: "leyendo" });
    void datos
      .runPromiseExit(Effect.zip(leerBandas(enZona()), Clock.currentTimeMillis))
      .then((salida) => {
        if (esta !== lectura) return;
        setBandas(
          Exit.isSuccess(salida)
            ? { tipo: "leidas", leidas: salida.value[0], fecha: salida.value[1] }
            : { tipo: "sin-leer" },
        );
      });
  };

  const cambiarCuota = (grupo: GrupoDeLineas, valor: number) =>
    setParametros((antes) => ({ ...antes, cuotas: { ...antes.cuotas, [grupo]: valor } }));

  const zonasDelBuscador = createMemo(() => {
    const actualIndice = indice();
    const actualPoblacion = poblacion();
    return zonasParaBuscar(
      actualIndice.tipo === "lista" ? actualIndice.datos : undefined,
      actualPoblacion.tipo === "lista" ? actualPoblacion.datos : undefined,
    );
  });
  const encontradas = createMemo(() =>
    buscarZonas(consulta(), zonasDelBuscador()).map((z) => ({
      clave: z.zona.codigo,
      nombre: z.nombre,
      lugar: z.lugar,
    })),
  );
  const elegirZona = (codigo: string) => {
    setConsulta("");
    props.alElegirZona(codigo);
  };

  const dejarDeElegir = () => {
    setEligiendo(false);
    setFueraDelMapa(false);
    props.alEsperarPunto(undefined);
  };
  /** Lo que pasa al tocar el mapa mientras se elige: la zona de ese punto, si hay alguna. */
  const alTocar = (punto: Coordenada) => {
    const actual = indice();
    if (actual.tipo !== "lista") return;
    const actualPoblacion = poblacion();
    const resolver = () => {
      const encontrada = zonaDelPunto(
        punto,
        actual.datos,
        contornosLeidos,
        actualPoblacion.tipo === "lista" ? actualPoblacion.datos : undefined,
      );
      if (encontrada.tipo === "faltan") {
        // Si no han llegado, el punto se queda sin zona: se puede volver a tocar.
        if (encontrada.provincias.every((c) => contornosLeidos.get(c)?.tipo === "fallo")) {
          setFueraDelMapa(true);
          return;
        }
        void cargarContornosDe(encontrada.provincias).then(resolver);
        return;
      }
      if (encontrada.tipo === "ninguna") {
        setFueraDelMapa(true);
        return;
      }
      dejarDeElegir();
      setAltura("media");
      elegirZona(encontrada.zona.codigo);
    };
    resolver();
  };
  const empezarAElegir = () => {
    setEligiendo(true);
    setFueraDelMapa(false);
    // En el móvil la hoja baja para que se vea el mapa.
    setAltura("resumen");
    props.alEsperarPunto(alTocar);
  };

  const opcionesDeBarrio = createMemo(() => {
    const actual = poblacion();
    const barrios = actual.tipo === "lista" ? actual.datos.barrios : [];
    return [
      { valor: MUNICIPIO_DE_BARCELONA, etiqueta: "Todo el municipio" },
      ...barrios
        .map((b) => ({ valor: b.codigo, etiqueta: b.nombre }))
        .toSorted((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
    ];
  });

  return (
    <PanelEmplazamiento
      nombre="Ejercicio de emplazamientos"
      ancho="ancho"
      altura={altura()}
      alCambiarAltura={setAltura}
      alCerrar={props.alCerrar}
    >
      <CabeceraFicha
        antetitulo="Modo estudiante · Ejercicio"
        titulo="Estaciones base de una zona"
        lugar={nombreDeLaZona() ?? "Elige un municipio o un barrio para empezar"}
        companias={presentes().map((c) => c.compania)}
      />
      <Switch>
        <Match when={indice().tipo === "cargando" && poblacion().tipo === "cargando"}>
          <EsqueletoEjercicio texto="Cargando los municipios y los barrios…" />
        </Match>
        <Match when={indice().tipo === "fallo" && poblacion().tipo === "fallo"}>
          <SeccionFicha titulo="Zona">
            <Aviso
              tono="fallo"
              encaje="panel"
              titulo="No se han podido cargar las zonas"
              acciones={<Boton onClick={cargarZonas}>Reintentar</Boton>}
            >
              Puede que falle la conexión.
            </Aviso>
          </SeccionFicha>
        </Match>
        <Match when={true}>
          <SeccionFicha titulo="1 · Zona">
            <BuscadorDeZonas
              consulta={consulta()}
              alCambiarConsulta={setConsulta}
              resultados={encontradas()}
              alElegir={elegirZona}
              disabled={indice().tipo !== "lista"}
            />
            <Show
              when={eligiendo()}
              fallback={
                <Acciones>
                  <Boton
                    variante="secundario"
                    disabled={indice().tipo !== "lista"}
                    onClick={empezarAElegir}
                  >
                    Elegir en el mapa
                  </Boton>
                </Acciones>
              }
            >
              <Nota titulo="Toca el mapa dentro de la zona">
                <p>En Barcelona se elige el barrio, y después puedes pasar al municipio entero.</p>
                <Show when={fueraDelMapa()}>
                  <p>Ahí no hay ningún municipio. Toca dentro de uno.</p>
                </Show>
                <Acciones>
                  <Boton variante="secundario" onClick={dejarDeElegir}>
                    Cancelar
                  </Boton>
                </Acciones>
              </Nota>
            </Show>
            <Show when={conBarrios(zona())}>
              <Selector
                etiqueta="Barrio"
                vacio="Elige un barrio"
                opciones={opcionesDeBarrio()}
                valor={zona()?.codigo}
                alCambiar={elegirZona}
              />
            </Show>
            <EstadoDeLaZona
              estado={estado()}
              codigo={props.zona}
              alReintentar={() => {
                const actual = estado();
                const codigo = provincia();
                if (actual.tipo !== "fallo" || codigo === undefined) return;
                if (actual.que === "capa") props.alReintentarProvincias([codigo]);
                else if (actual.que === "contornos") void cargarContornosDe([codigo]);
                else cargarZonas();
              }}
            />
            <Show when={resuelta()}>
              {(actual) => (
                <>
                  <CadenaDelCalculo
                    pasos={[
                      {
                        etiqueta: "Área",
                        valor: `${decimal(actual().areaKm2)} km²`,
                        // La cita del IGN ya lleva la fecha de los límites.
                        fuente:
                          actual().origen.tipo === "barrio"
                            ? `${citaDeLimites(actual().origen)}, ${actual().origen.limites.fecha}`
                            : citaDeLimites(actual().origen),
                      },
                      {
                        etiqueta: "Habitantes",
                        valor:
                          actual().habitantes === null ? "—" : entero(actual().habitantes ?? 0),
                        fuente: citaDelPadron(actual().origen),
                      },
                      {
                        operacion: "÷ área",
                        etiqueta: "Densidad",
                        valor:
                          resultado()?.densidad === undefined
                            ? "—"
                            : `${entero(resultado()?.densidad ?? 0)} hab/km²`,
                        fuente: "Calculada",
                      },
                      {
                        etiqueta: "Emplazamientos en la zona",
                        valor: entero(enZona().length),
                        fuente: "Los del mapa de Celda",
                      },
                    ]}
                  />
                  <Show when={actual().habitantes === null}>
                    <Nota tono="aviso" titulo="El padrón aún no tiene esta zona">
                      <p>
                        El padrón a {actual().origen.poblacion.referencia} no da habitantes de{" "}
                        {actual().nombre}. Sin ellos no salen los usuarios por estación base.
                      </p>
                    </Nota>
                  </Show>
                  <Show when={!actual().cubierta}>
                    <Nota tono="aviso" titulo="Solo una parte de la zona">
                      <p>
                        Celda solo tiene los emplazamientos de una parte de {actual().nombre}, así
                        que los recuentos se quedan cortos.
                      </p>
                    </Nota>
                  </Show>
                  <Acciones>
                    <Enlace
                      variante="enlace"
                      href={actual().origen.poblacion.enlace}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {actual().origen.tipo === "barrio"
                        ? "Padrón en Open Data BCN"
                        : "Padrón en el INE"}
                    </Enlace>
                  </Acciones>
                </>
              )}
            </Show>
          </SeccionFicha>

          <Show when={resuelta() !== undefined && presentes().length === 0}>
            <SeccionFicha titulo="Estaciones base">
              <Nota tono="aviso" titulo="No hay emplazamientos en esta zona">
                <p>Prueba con una zona vecina.</p>
              </Nota>
            </SeccionFicha>
          </Show>

          <Show when={compania()}>
            {(actual) => (
              <>
                <SeccionFicha
                  titulo={
                    <>
                      2 · <Termino termino="radio-de-cobertura">Radio de cobertura</Termino>
                    </>
                  }
                >
                  <Segmentado
                    leyenda="Compañía"
                    opciones={presentes().map((c) => ({
                      valor: c.compania,
                      etiqueta: NOMBRE_COMPANIA[c.compania],
                    }))}
                    valor={actual().compania}
                    alCambiar={setElegida}
                  />
                  <TextoEjercicio>
                    El radio es la mitad de la distancia media de cada{" "}
                    <Termino termino="estacion-base">estación base</Termino> a su vecina más cercana
                    de la misma compañía, esté o no en la zona. Cada línea naranja del mapa une una
                    estación con su vecina.
                  </TextoEjercicio>
                  <Show when={vecinasPendientes().length > 0}>
                    <Nota titulo="Buscando vecinas al otro lado del borde">
                      <p>
                        Cargando los emplazamientos de{" "}
                        {enumerar(vecinasPendientes().map(nombreDeProvincia))}. El radio aún puede
                        cambiar.
                      </p>
                    </Nota>
                  </Show>
                  <Show when={vecinasFallidas().length > 0}>
                    <Nota tono="aviso" titulo="Faltan vecinas al otro lado del borde">
                      <p>
                        No han llegado los emplazamientos de{" "}
                        {enumerar(vecinasFallidas().map(nombreDeProvincia))}. El radio puede salir
                        mayor que el real.
                      </p>
                      <Acciones>
                        <Boton
                          variante="secundario"
                          onClick={() => props.alReintentarProvincias(vecinasFallidas())}
                        >
                          Reintentar
                        </Boton>
                      </Acciones>
                    </Nota>
                  </Show>
                  <Show when={borde().incompletas.length > 0}>
                    <Nota tono="aviso" titulo="Vecinas en una zona a medias">
                      <p>
                        De {enumerar(borde().incompletas.map(nombreDeProvincia))} Celda solo tiene
                        los emplazamientos de una parte, y el radio real puede ser menor.
                      </p>
                    </Nota>
                  </Show>
                  <CadenaDelCalculo pasos={cadenaDelRadio(actual())} />
                </SeccionFicha>

                <SeccionFicha titulo="3 · Usuarios por estación base">
                  <TextoEjercicio>
                    Las líneas de la zona salen de los habitantes y la{" "}
                    <Termino termino="penetracion">penetración</Termino>, y las de cada compañía, de
                    su <Termino termino="cuota-de-lineas">cuota</Termino>. Por defecto se usan los
                    valores de toda España que publica la CNMC para {FUENTE_DE_PARAMETROS.periodo},
                    y puedes cambiarlos.
                  </TextoEjercicio>
                  <RejillaDeCampos>
                    <CampoNumero
                      etiqueta="Penetración"
                      unidad="por 100 hab."
                      valor={parametros().penetracion}
                      minimo={0}
                      maximo={300}
                      alCambiar={(penetracion) =>
                        setParametros((antes) => ({ ...antes, penetracion }))
                      }
                    />
                    <For each={GRUPOS_DE_LINEAS}>
                      {(grupo) => (
                        <CampoNumero
                          etiqueta={`Cuota ${NOMBRE_GRUPO[grupo]}`}
                          unidad="%"
                          valor={parametros().cuotas[grupo]}
                          minimo={0}
                          maximo={100}
                          alCambiar={(valor) => cambiarCuota(grupo, valor)}
                        />
                      )}
                    </For>
                  </RejillaDeCampos>
                  <Acciones>
                    <Boton
                      variante="secundario"
                      disabled={fuenteParametros().fecha !== ""}
                      onClick={() => setParametros(PARAMETROS_POR_DEFECTO)}
                    >
                      Volver a los de la CNMC
                    </Boton>
                    <Enlace
                      variante="enlace"
                      href={FUENTE_DE_PARAMETROS.enlace}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Datos de la CNMC
                    </Enlace>
                  </Acciones>
                  <Show when={resultado()}>
                    {(deLaZona) => (
                      <CadenaDelCalculo
                        pasos={cadenaDeUsuarios(
                          deLaZona(),
                          actual().compania,
                          parametros(),
                          fuenteParametros().texto,
                        )}
                      />
                    )}
                  </Show>
                </SeccionFicha>

                <SeccionFicha titulo="4 · Tecnologías y bandas">
                  <TextoEjercicio>
                    Las <Termino termino="banda">bandas</Termino> salen del registro oficial. Como
                    no publica la tecnología, se deduce de la banda y la tabla dice «probable» o
                    «posible».
                  </TextoEjercicio>
                  {/*
                    Leídas una vez no hay nada que volver a leer: las fichas y la capa son de la
                    misma versión publicada.
                  */}
                  <Show when={leidas() === undefined}>
                    <Acciones>
                      <Boton
                        variante="secundario"
                        cargando={bandas().tipo === "leyendo"}
                        onClick={leer}
                      >
                        {`Leer las fichas de ${entero(enZona().length)} emplazamientos`}
                      </Boton>
                    </Acciones>
                    <TextoEjercicio>
                      El mapa trae bandas de {entero(conBandasEnCapa())} de los{" "}
                      {entero(enZona().length)} emplazamientos de la zona. De los demás, la tabla
                      dice «no consta».
                    </TextoEjercicio>
                  </Show>
                  <Show when={leidas()}>
                    {(hecho) => (
                      <TextoEjercicio>
                        Se han leído {entero(enZona().length - hecho().leidas.fallidas.length)} de{" "}
                        {entero(enZona().length)} fichas.
                        {hecho().leidas.fallidas.length > 0
                          ? ` ${entero(hecho().leidas.fallidas.length)} no han llegado, y en sus bandas la tabla pone «no consta».`
                          : ""}
                        {textoSinFichaEnRegistro(sinFichaEnRegistro())}
                        {sinBandas() > 0
                          ? ` ${entero(sinBandas())} no tienen ninguna banda conocida, y en ellas la tabla también pone «no consta».`
                          : ""}
                      </TextoEjercicio>
                    )}
                  </Show>
                </SeccionFicha>

                <Show when={tabla()}>
                  {(hecha) => (
                    <SeccionFicha titulo="5 · Tabla">
                      <TablaDelEjercicio
                        titulo={hecha().titulo}
                        columnas={hecha().companias.map((c) => ({
                          compania: c,
                          nombre: NOMBRE_COMPANIA[c],
                        }))}
                        secciones={hecha().secciones}
                      />
                      <Show when={vecinasPendientes().length > 0}>
                        <TextoEjercicio>
                          La tabla se podrá descargar cuando lleguen las provincias de al lado.
                        </TextoEjercicio>
                      </Show>
                      <Acciones>
                        <Boton
                          disabled={vecinasPendientes().length > 0}
                          onClick={() =>
                            descargarCsv(
                              csvDeTabla(hecha()),
                              `${nombreDeFichero(resuelta()?.titulo ?? "")}.csv`,
                            )
                          }
                        >
                          Descargar CSV
                        </Boton>
                      </Acciones>
                    </SeccionFicha>
                  )}
                </Show>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </PanelEmplazamiento>
  );
}

/**
 * Lo que se dice de la zona mientras no está lista: que se está cargando, que Celda aún no tiene
 * su provincia, que algo no ha llegado o que el código no es de ninguna zona.
 */
function EstadoDeLaZona(props: {
  readonly estado: ReturnType<typeof estadoDeLaZona>;
  readonly codigo: string;
  readonly alReintentar: () => void;
}) {
  // Cada rama lee el estado de las props y no el valor de `Match`: al cambiar de rama, la vieja
  // puede leer otra vez antes de desmontarse, como en la marca de agua del mapa.
  const nombre = () => {
    const actual = props.estado;
    return actual.tipo === "sin-zona" || actual.tipo === "lista" ? "" : (actual.nombre ?? "");
  };
  const provincia = () => (props.estado.tipo === "sin-datos" ? props.estado.provincia : "");
  return (
    <Switch>
      <Match when={props.estado.tipo === "sin-zona" && props.codigo !== ""}>
        <Nota tono="aviso" titulo="Esa zona no existe">
          <p>Búscala por su nombre o elígela en el mapa.</p>
        </Nota>
      </Match>
      <Match when={props.estado.tipo === "cargando"}>
        <TextoEjercicio>
          {nombre() === "" ? "Cargando la zona…" : `Cargando ${nombre()}…`}
        </TextoEjercicio>
      </Match>
      <Match when={props.estado.tipo === "sin-datos"}>
        <Aviso tono="limite" encaje="panel" titulo={`Celda aún no tiene datos de ${provincia()}`}>
          Puede haber estaciones base en {nombre()} aunque aquí no salgan.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo"}>
        <Aviso
          tono="fallo"
          encaje="panel"
          titulo={`No han llegado los datos de ${nombre() === "" ? "la zona" : nombre()}`}
          acciones={<Boton onClick={() => props.alReintentar()}>Reintentar</Boton>}
        >
          Puede que falle la conexión o que el servidor esté bloqueado.
        </Aviso>
      </Match>
    </Switch>
  );
}
