import type { Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  FUENTE_DE_PARAMETROS,
  GRUPOS_DE_LINEAS,
  type GrupoDeLineas,
  NOMBRE_GRUPO,
  PARAMETROS_POR_DEFECTO,
  type ParametrosDelEjercicio,
  resolverEjercicio,
  type ResultadoDelEjercicio,
} from "@celda/dominio/ejercicio";
import type { PoblacionDeBarrios } from "@celda/dominio/poblacion";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton, Enlace } from "@celda/ui/Boton.tsx";
import { CampoNumero, Segmentado, Selector } from "@celda/ui/Eleccion.tsx";
import {
  AccionesEjercicio,
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
import { Termino } from "@celda/ui/termino/Termino.tsx";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
} from "solid-js";

import { usarDatos } from "../datos.tsx";
import { type BandasLeidas, leerBandas } from "./bandas.ts";
import { cadenaDelRadio, cadenaDeUsuarios } from "./textos.ts";
import {
  csvDeTabla,
  decimal,
  entero,
  filasExportadas,
  fuenteDeParametros,
  nombreDeFichero,
  tablaDelEjercicio,
} from "./tabla.ts";
import { xlsxDeFilas } from "./xlsx.ts";
import { cargarPoblacion, encuadreDe, SIN_ZONA, type ZonaEnMapa, zonaEnMapa } from "./zona.ts";

type EstadoPoblacion =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly datos: PoblacionDeBarrios }
  | { readonly tipo: "fallo" };

type EstadoBandas =
  | { readonly tipo: "sin-leer" }
  | { readonly tipo: "leyendo" }
  | { readonly tipo: "leidas"; readonly leidas: BandasLeidas; readonly fecha: number };

export interface PanelEjercicioProps {
  /** Código del barrio elegido, o `""` si aún no hay ninguno. */
  readonly barrio: string;
  /** Los emplazamientos de la capa, con su barrio. */
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  /** Fecha de la capa, si ya ha llegado. */
  readonly fechaCapa: number | undefined;
  readonly alElegirBarrio: (codigo: string) => void;
  /** Lo que el mapa dibuja de la zona y, al cambiar de barrio, dónde encuadrarlo. */
  readonly alDibujar: (zona: ZonaEnMapa, encuadre: Rectangulo | undefined) => void;
  readonly alCerrar: () => void;
}

const CAMPOS_CUOTA: ReadonlyArray<GrupoDeLineas> = GRUPOS_DE_LINEAS;

const SIN_RESULTADO: ResultadoDelEjercicio = {
  habitantes: 0,
  areaKm2: 0,
  densidad: 0,
  lineas: 0,
  companias: [],
};

/** Descarga unos bytes o un texto como fichero, sin pasar por ningún servidor. */
const descargar = (contenido: BlobPart, tipo: string, nombre: string) => {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  // El navegador empieza la descarga al hacer clic: la dirección ya no hace falta.
  URL.revokeObjectURL(url);
};

/**
 * El ejercicio de emplazamientos del modo estudiante (historia 55), en el panel de la izquierda
 * o en la hoja del móvil. Se elige un barrio y el panel cuenta, por compañía, sus estaciones
 * base, el radio de cobertura, los habitantes y usuarios por estación y las tecnologías y bandas,
 * con la fuente de cada valor, y deja descargar la tabla.
 */
export function PanelEjercicio(props: PanelEjercicioProps) {
  const datos = usarDatos();
  const [altura, setAltura] = createSignal<AlturaHoja>("media");
  const [poblacion, setPoblacion] = createSignal<EstadoPoblacion>({ tipo: "cargando" });
  const [parametros, setParametros] = createSignal<ParametrosDelEjercicio>(PARAMETROS_POR_DEFECTO);
  const [elegida, setElegida] = createSignal<Compania>();
  const [bandas, setBandas] = createSignal<EstadoBandas>({ tipo: "sin-leer" });
  // Cada lectura de bandas tiene su número: una que acaba después de cambiar de barrio no vale.
  let lectura = 0;

  const cargar = () => {
    setPoblacion({ tipo: "cargando" });
    void datos.runPromiseExit(cargarPoblacion).then((salida) => {
      setPoblacion(
        Exit.isSuccess(salida) ? { tipo: "lista", datos: salida.value } : { tipo: "fallo" },
      );
    });
  };
  onSettled(() => {
    cargar();
    return () => {
      lectura += 1;
      props.alDibujar(SIN_ZONA, undefined);
    };
  });

  const lista = createMemo(() => {
    const actual = poblacion();
    return actual.tipo === "lista" ? actual.datos : undefined;
  });
  const barrio = createMemo(() => lista()?.barrios.find((b) => b.codigo === props.barrio));
  const opciones = createMemo(() =>
    (lista()?.barrios ?? [])
      .map((b) => ({ valor: b.codigo, etiqueta: b.nombre }))
      .toSorted((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
  );
  const enZona = createMemo(() => props.emplazamientos.filter((e) => e.barrio === props.barrio));
  const leidas = createMemo(() => {
    const actual = bandas();
    return actual.tipo === "leidas" ? actual : undefined;
  });

  const resultado = createMemo(() => {
    const actual = barrio();
    if (actual === undefined) return undefined;
    return resolverEjercicio({
      habitantes: actual.habitantes,
      areaKm2: actual.areaKm2,
      enZona: enZona(),
      todos: props.emplazamientos,
      bandas: leidas()?.leidas.bandas ?? new Map(),
      parametros: parametros(),
    });
  });

  const presentes = createMemo(() => resultado()?.companias.filter((c) => c.estaciones > 0) ?? []);
  /** La compañía de las cadenas: la elegida si tiene estaciones aquí, o la primera que tenga. */
  const compania = createMemo(() => {
    const aqui = presentes();
    const actual = elegida();
    return aqui.find((c) => c.compania === actual) ?? aqui[0];
  });

  // Otro barrio: las bandas leídas eran de otros emplazamientos.
  createEffect(
    () => props.barrio,
    () => {
      lectura += 1;
      setBandas({ tipo: "sin-leer" });
    },
    { defer: true },
  );

  // El mapa enseña la zona y las vecinas de la compañía de las cadenas, y encuadra el barrio
  // cuando cambia.
  let encuadrado = "";
  createEffect(
    () => ({ zona: barrio(), vecinas: compania()?.vecinas ?? [] }),
    ({ zona, vecinas }) => {
      if (zona === undefined) {
        props.alDibujar(SIN_ZONA, undefined);
        return;
      }
      const nuevo = encuadrado !== zona.codigo;
      encuadrado = zona.codigo;
      props.alDibujar(
        zonaEnMapa(zona.poligonos, vecinas, props.emplazamientos),
        nuevo ? encuadreDe(zona.poligonos) : undefined,
      );
    },
  );

  const fuenteParametros = createMemo(() =>
    fuenteDeParametros(parametros(), PARAMETROS_POR_DEFECTO),
  );

  const tabla = createMemo(() => {
    const actual = resultado();
    const lista_ = lista();
    const zona = barrio();
    if (actual === undefined || lista_ === undefined || zona === undefined) return undefined;
    return tablaDelEjercicio(
      actual,
      {
        zona: zona.nombre,
        poblacion: lista_.fuente,
        limites: lista_.fuenteDeLimites,
        fechaCapa: props.fechaCapa ?? 0,
        parametros: parametros(),
        fechaBandas: leidas()?.fecha,
      },
      PARAMETROS_POR_DEFECTO,
    );
  });

  const leer = () => {
    lectura += 1;
    const esta = lectura;
    const claves = enZona().map((e) => e.clave);
    setBandas({ tipo: "leyendo" });
    void datos
      .runPromiseExit(Effect.zip(leerBandas(claves), Clock.currentTimeMillis))
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

  return (
    <PanelEmplazamiento
      nombre="Ejercicio de emplazamientos"
      altura={altura()}
      alCambiarAltura={setAltura}
      alCerrar={props.alCerrar}
    >
      <CabeceraFicha
        antetitulo="Modo estudiante · Ejercicio"
        titulo="Estaciones base de un barrio"
        lugar={barrio()?.nombre ?? "Elige un barrio para empezar"}
        companias={presentes().map((c) => c.compania)}
      />
      <Switch>
        <Match when={poblacion().tipo === "cargando"}>
          <EsqueletoEjercicio />
        </Match>
        <Match when={poblacion().tipo === "fallo"}>
          <SeccionFicha titulo="Zona">
            <Aviso
              tono="fallo"
              encaje="panel"
              titulo="No se han podido cargar los habitantes"
              acciones={<Boton onClick={cargar}>Reintentar</Boton>}
            >
              Sin ellos no se puede hacer el ejercicio. Puede fallar la conexión con Celda.
            </Aviso>
          </SeccionFicha>
        </Match>
        <Match when={lista()}>
          {(cargada) => (
            <>
              <SeccionFicha titulo="1 · Zona">
                <Selector
                  etiqueta="Barrio"
                  vacio="Elige un barrio"
                  opciones={opciones()}
                  valor={barrio()?.codigo}
                  alCambiar={(codigo) => props.alElegirBarrio(codigo)}
                />
                <TextoEjercicio>
                  El ejercicio se hace sobre uno de los 73 barrios de Barcelona, con los habitantes
                  del padrón. Los municipios de alrededor no tienen barrios.
                </TextoEjercicio>
                <Show when={barrio()}>
                  {(zona) => (
                    <CadenaDelCalculo
                      pasos={[
                        {
                          etiqueta: "Área",
                          valor: `${decimal(zona().areaKm2)} km²`,
                          fuente: `Límites de barrio, ${cargada().fuenteDeLimites.atribucion}, ${cargada().fuenteDeLimites.fecha}`,
                        },
                        {
                          etiqueta: "Habitantes",
                          valor: entero(zona().habitantes),
                          fuente: `Padrón a ${cargada().fuente.referencia}, ${cargada().fuente.atribucion}, ${cargada().fuente.licencia}`,
                        },
                        {
                          operacion: "÷ área",
                          etiqueta: "Densidad",
                          valor: `${entero(resultado()?.densidad ?? 0)} hab/km²`,
                          fuente: "Calculada",
                        },
                        {
                          etiqueta: "Emplazamientos en el barrio",
                          valor: entero(enZona().length),
                          fuente: "Los del mapa de Celda",
                        },
                      ]}
                    />
                  )}
                </Show>
                <AccionesEjercicio>
                  <Enlace
                    variante="enlace"
                    href={cargada().fuente.enlace}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Padrón en Open Data BCN
                  </Enlace>
                </AccionesEjercicio>
              </SeccionFicha>

              <Show when={barrio() !== undefined && presentes().length === 0}>
                <SeccionFicha titulo="Estaciones base">
                  <Nota tono="aviso" titulo="No hay emplazamientos en este barrio">
                    <p>
                      El mapa no tiene ningún emplazamiento dentro de sus límites, así que no hay
                      estaciones base que contar. Prueba con un barrio vecino.
                    </p>
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
                        El radio de cada <Termino termino="estacion-base">estación base</Termino> es
                        la mitad de la distancia media a su vecina más cercana de la misma compañía,
                        esté dentro o fuera del barrio. En el mapa, cada línea naranja une una
                        estación con su vecina.
                      </TextoEjercicio>
                      <CadenaDelCalculo pasos={cadenaDelRadio(actual())} />
                    </SeccionFicha>

                    <SeccionFicha titulo="3 · Usuarios por estación base">
                      <TextoEjercicio>
                        Las líneas de la zona salen de los habitantes y la{" "}
                        <Termino termino="penetracion">penetración</Termino>, y las de cada
                        compañía, de su <Termino termino="cuota-de-lineas">cuota</Termino>. Por
                        defecto son las de toda España según la CNMC ({FUENTE_DE_PARAMETROS.periodo}
                        ); puedes cambiarlas.
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
                        <For each={CAMPOS_CUOTA}>
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
                      <AccionesEjercicio>
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
                      </AccionesEjercicio>
                      <CadenaDelCalculo
                        pasos={cadenaDeUsuarios(
                          resultado() ?? SIN_RESULTADO,
                          actual().compania,
                          parametros(),
                          fuenteParametros().texto,
                        )}
                      />
                    </SeccionFicha>

                    <SeccionFicha titulo="4 · Tecnologías y bandas">
                      <TextoEjercicio>
                        Las <Termino termino="banda">bandas</Termino> salen de la ficha de cada
                        emplazamiento. El registro oficial no publica la tecnología: se deduce de la
                        banda y por eso la tabla dice «probable» o «posible».
                      </TextoEjercicio>
                      <AccionesEjercicio>
                        <Boton
                          variante="secundario"
                          cargando={bandas().tipo === "leyendo"}
                          onClick={leer}
                        >
                          {leidas() === undefined
                            ? `Leer las fichas de ${entero(enZona().length)} emplazamientos`
                            : "Volver a leerlas"}
                        </Boton>
                      </AccionesEjercicio>
                      <Show when={leidas()}>
                        {(hecho) => (
                          <TextoEjercicio>
                            Leídas {entero(enZona().length - hecho().leidas.fallidas.length)} de{" "}
                            {entero(enZona().length)} fichas.
                            {hecho().leidas.fallidas.length > 0
                              ? ` ${entero(hecho().leidas.fallidas.length)} no han llegado: de sus bandas la tabla dice «no consta».`
                              : ""}
                          </TextoEjercicio>
                        )}
                      </Show>
                    </SeccionFicha>

                    <Show when={tabla()}>
                      {(hecha) => (
                        <SeccionFicha titulo="5 · Tabla">
                          <TextoEjercicio>
                            Cada fila dice de dónde sale y de qué fecha es. Pasa el cursor por un
                            valor para verlo junto a él.
                          </TextoEjercicio>
                          <TablaDelEjercicio
                            titulo={hecha().titulo}
                            columnas={hecha().companias.map((c) => ({
                              compania: c,
                              nombre: NOMBRE_COMPANIA[c],
                            }))}
                            secciones={hecha().secciones}
                          />
                          <AccionesEjercicio>
                            <Boton
                              onClick={() =>
                                descargar(
                                  csvDeTabla(hecha()),
                                  "text/csv;charset=utf-8",
                                  `${nombreDeFichero(barrio()?.nombre ?? "")}.csv`,
                                )
                              }
                            >
                              Descargar CSV
                            </Boton>
                            <Boton
                              variante="secundario"
                              onClick={() =>
                                descargar(
                                  xlsxDeFilas(
                                    barrio()?.nombre ?? "Tabla",
                                    filasExportadas(hecha()),
                                  ),
                                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                  `${nombreDeFichero(barrio()?.nombre ?? "")}.xlsx`,
                                )
                              }
                            >
                              Descargar XLSX
                            </Boton>
                          </AccionesEjercicio>
                        </SeccionFicha>
                      )}
                    </Show>
                  </>
                )}
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </PanelEmplazamiento>
  );
}
