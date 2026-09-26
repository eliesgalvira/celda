import type { Coordenada } from "@celda/dominio/area";
import type { Credito } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import {
  BuscadorDeDirecciones as CampoDeBusqueda,
  EleccionDePunto,
  type EstadoBusqueda,
} from "@celda/ui/ubicacion/EleccionDePunto.tsx";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { MenuUbicacion, OpcionUbicacion } from "@celda/ui/ubicacion/MenuUbicacion.tsx";
import { AccionesPasoPrevio, ListaPasoPrevio } from "@celda/ui/ubicacion/PasoPrevio.tsx";
import {
  ConReferencia,
  EsperandoReferencia,
  SeccionReferencia,
  SinReferencia,
} from "@celda/ui/ubicacion/Referencia.tsx";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { createMemo, createSignal, Match, onSettled, Show, Switch, useContext } from "solid-js";

import { usarDatos } from "../datos.tsx";
import {
  BuscadorDeDirecciones,
  type BusquedaFallida,
  type Direccion,
  LETRAS_MINIMAS,
  normalizarConsulta,
} from "./buscador.ts";
import { UbicacionContexto } from "./controlador.ts";
import { asentado, type MotivoFalloGps } from "./estado.ts";
import {
  COMO_REACTIVAR,
  EXPLICACION_FALLO,
  PARA_QUE_SIRVE,
  TITULO_FALLO,
  textosReferencia,
} from "./textos.ts";

/** El navegador no puede dar la ubicación: pedirla otra vez no serviría. */
const sinGeolocalizacion = (motivo: MotivoFalloGps | undefined) => motivo === "no-disponible";

export interface MenuDeUbicacionProps {
  /** El mapa ya se ve y se puede mover hasta el punto. */
  readonly puedeCentrar: boolean;
  readonly alCentrar: () => void;
}

/** El botón de ubicación del mapa y su menú. */
export function MenuDeUbicacion(props: MenuDeUbicacionProps) {
  const control = useContext(UbicacionContexto);
  const [abierto, setAbierto] = createSignal(false);
  const referencia = control.referencia;
  const actual = createMemo(() => asentado(control.ubicacion().estado));

  /** Por qué no se puede usar la ubicación ahora, o qué pasará si se usa. */
  const detalleUsar = createMemo(() => {
    if (referencia()?.tipo === "gps") return "Ya la estás usando.";
    if (control.ubicacion().permiso === "denegado") {
      return "Bloqueada en este navegador. Actívala en los ajustes de la web.";
    }
    const estado = actual();
    if (estado.tipo === "fallo" && sinGeolocalizacion(estado.motivo)) {
      return "Este navegador no da la ubicación.";
    }
    return "Te explicamos antes para qué sirve. No se guarda.";
  });
  const puedeUsar = createMemo(() => {
    const estado = actual();
    return (
      referencia()?.tipo !== "gps" &&
      control.ubicacion().permiso !== "denegado" &&
      !(estado.tipo === "fallo" && sinGeolocalizacion(estado.motivo))
    );
  });

  const elegir = (accion: () => void) => () => {
    setAbierto(false);
    accion();
  };

  return (
    <MenuUbicacion
      activo={referencia() !== undefined}
      abierto={abierto()}
      alAbrir={() => setAbierto(true)}
      alCerrar={() => setAbierto(false)}
    >
      <OpcionUbicacion
        tono="gps"
        etiqueta="Usar mi ubicación"
        detalle={detalleUsar()}
        disabled={!puedeUsar()}
        onClick={elegir(control.usarUbicacion)}
      />
      <OpcionUbicacion
        tono="elegido"
        etiqueta="Elegir un punto en el mapa"
        detalle="O busca una dirección."
        onClick={elegir(control.elegirEnMapa)}
      />
      <Show when={referencia()}>
        {(actual) => (
          <>
            <OpcionUbicacion
              etiqueta={actual().tipo === "gps" ? "Centrar en mi ubicación" : "Centrar en el punto"}
              detalle={props.puedeCentrar ? undefined : "El mapa aún no ha cargado."}
              disabled={!props.puedeCentrar}
              onClick={elegir(props.alCentrar)}
            />
            <OpcionUbicacion
              tono="quitar"
              etiqueta={actual().tipo === "gps" ? "Quitar mi ubicación" : "Quitar el punto"}
              detalle={
                actual().tipo === "gps" ? "Se apaga el GPS." : "Se borra de este dispositivo."
              }
              onClick={elegir(control.quitar)}
            />
          </>
        )}
      </Show>
    </MenuUbicacion>
  );
}

/**
 * El paso previo al aviso del navegador (historia 24): para qué se usa la ubicación, que se
 * calcula en el dispositivo, que no se guarda y que se puede quitar. Solo al continuar se pide.
 */
export function PasoPrevio() {
  const control = useContext(UbicacionContexto);
  return (
    <Show when={control.ubicacion().estado.tipo === "explicando"}>
      <Dialogo titulo="Usar tu ubicación" alCerrar={control.cancelar}>
        <p>Ahora tu navegador te preguntará si quieres compartir tu ubicación con Celda.</p>
        <ListaPasoPrevio>
          <li>
            Solo sirve para calcular a qué distancia y en qué dirección quedan los{" "}
            <Termino termino="emplazamiento">emplazamientos</Termino>.
          </li>
          <li>
            Se calcula en tu dispositivo. Celda no la guarda ni la envía a ningún servidor. El mapa
            sí descarga de OpenFreeMap el callejero de la zona que enseña, como cuando lo mueves.
          </li>
          <li>Puedes quitarla cuando quieras desde el botón «Ubicación».</li>
        </ListaPasoPrevio>
        <AccionesPasoPrevio>
          <Boton variante="secundario" onClick={() => control.elegirEnMapa()}>
            Mejor elijo en el mapa
          </Boton>
          <Boton variante="destacado" onClick={() => control.continuar()}>
            Continuar
          </Boton>
        </AccionesPasoPrevio>
      </Dialogo>
    </Show>
  );
}

const TEXTO_ALMACEN = {
  "sin-guardar": {
    titulo: "El punto no se ha guardado",
    texto:
      "Este navegador no deja a Celda guardar datos en el dispositivo (pasa en algunas ventanas privadas). El punto sirve mientras no cierres la página.",
  },
  "sin-borrar": {
    titulo: "El punto no se ha borrado del dispositivo",
    texto:
      "Ya no se usa, pero puede volver a aparecer al recargar la página. Prueba a quitarlo otra vez.",
  },
} as const;

/**
 * Los avisos de la ubicación bajo la cabecera: que no ha llegado y por qué, que se está pidiendo
 * y que el dispositivo no ha guardado o borrado el punto. Con la ficha abierta, lo que ya cuenta
 * la ficha no se repite aquí.
 */
export function AvisosDeUbicacion(props: { readonly panelAbierto: boolean }) {
  const control = useContext(UbicacionContexto);
  const fallo = createMemo(() => {
    const { aviso } = control.ubicacion();
    const conPunto = control.referencia() !== undefined;
    return aviso !== undefined && (!props.panelAbierto || conPunto) ? aviso : undefined;
  });
  const pidiendo = createMemo(
    () => control.ubicacion().estado.tipo === "pidiendo" && !props.panelAbierto,
  );
  return (
    <>
      <Show when={fallo()} keyed>
        {(motivo) => (
          <Aviso
            tono="fallo"
            titulo={TITULO_FALLO[motivo]}
            acciones={
              <>
                <Boton onClick={() => control.elegirEnMapa()}>Elegir en el mapa</Boton>
                <Boton variante="secundario" onClick={() => control.cerrarAviso()}>
                  Cerrar
                </Boton>
              </>
            }
          >
            {EXPLICACION_FALLO[motivo]}
          </Aviso>
        )}
      </Show>
      <Show when={pidiendo()}>
        <Aviso
          tono="espera"
          titulo="Buscando tu ubicación"
          acciones={
            <Boton variante="secundario" onClick={() => control.cancelar()}>
              Cancelar
            </Boton>
          }
        >
          Si tu navegador te pregunta, elige si la compartes con Celda.
        </Aviso>
      </Show>
      <Show when={control.avisoAlmacen()} keyed>
        {(aviso) => (
          <Aviso
            tono="fallo"
            titulo={TEXTO_ALMACEN[aviso].titulo}
            acciones={
              <>
                <Show when={aviso === "sin-borrar"}>
                  <Boton onClick={() => control.quitar()}>Quitar otra vez</Boton>
                </Show>
                <Boton variante="secundario" onClick={() => control.cerrarAvisoAlmacen()}>
                  Cerrar
                </Boton>
              </>
            }
          >
            {TEXTO_ALMACEN[aviso].texto}
          </Aviso>
        )}
      </Show>
    </>
  );
}

const TEXTO_FALLO_BUSQUEDA: Readonly<Record<BusquedaFallida["motivo"], string>> = {
  apagada: "La búsqueda de direcciones está apagada ahora. Elige el punto en el mapa.",
  limite: "El buscador pide que esperemos un poco. Vuelve a probar en unos segundos.",
  "sin-respuesta":
    "El buscador no responde. Puede fallar la conexión o estar caído el servicio. Puedes elegir el punto en el mapa.",
};

export interface EleccionConBuscadorProps {
  /** En el móvil: usar el punto bajo el pin central. */
  readonly alUsarCentro: () => void;
  /** Llevar el mapa hasta una dirección elegida. */
  readonly alIrA: (posicion: Coordenada) => void;
}

/** La elección de un punto, con el buscador de direcciones (historias 26 y 27). */
export function EleccionConBuscador(props: EleccionConBuscadorProps) {
  const control = useContext(UbicacionContexto);
  const datos = usarDatos();
  const [consulta, setConsulta] = createSignal("");
  const [estado, setEstado] = createSignal<EstadoBusqueda>({ tipo: "inicial" });
  const [direcciones, setDirecciones] = createSignal<ReadonlyArray<Direccion>>([]);
  const [atribucion, setAtribucion] = createSignal<Credito>();
  // Solo cuenta la respuesta de la última búsqueda.
  let busqueda = 0;

  onSettled(() => {
    void datos
      .runPromise(Effect.map(BuscadorDeDirecciones, (b) => b.atribucion))
      .then(setAtribucion);
  });

  const buscar = () => {
    if (normalizarConsulta(consulta()).length < LETRAS_MINIMAS) {
      setEstado({ tipo: "aviso", texto: "Escribe al menos tres letras de la dirección." });
      return;
    }
    busqueda += 1;
    const esta = busqueda;
    setEstado({ tipo: "buscando" });
    void datos
      .runPromiseExit(Effect.flatMap(BuscadorDeDirecciones, (b) => b.buscar(consulta())))
      .then((salida) => {
        if (esta !== busqueda) return;
        if (Exit.isFailure(salida)) {
          const error = Option.getOrUndefined(Cause.findErrorOption(salida.cause));
          setEstado({
            tipo: "aviso",
            texto: TEXTO_FALLO_BUSQUEDA[error?.motivo ?? "sin-respuesta"],
          });
          return;
        }
        setDirecciones(salida.value);
        setEstado(
          salida.value.length === 0
            ? {
                tipo: "aviso",
                texto:
                  "No hay ninguna dirección así en la zona de Barcelona. Prueba con la calle y el número.",
              }
            : { tipo: "resultados", direcciones: salida.value },
        );
      });
  };

  return (
    <EleccionDePunto
      alCancelar={() => control.cancelar()}
      alUsarCentro={() => props.alUsarCentro()}
      buscador={
        <CampoDeBusqueda
          consulta={consulta()}
          alCambiarConsulta={setConsulta}
          alBuscar={buscar}
          estado={estado()}
          atribucion={atribucion() ?? { texto: "", enlace: "" }}
          alElegir={(indice) => {
            const elegida = direcciones()[indice];
            if (elegida === undefined) return;
            control.elegir(elegida.posicion, "busqueda");
            props.alIrA(elegida.posicion);
          }}
        />
      }
    />
  );
}

/**
 * El punto de referencia en la ficha de un emplazamiento. Sin punto, explica qué se ganaría y
 * cómo darlo; con punto, desde dónde se mira y a qué distancia y rumbo queda el emplazamiento.
 */
export function ReferenciaEnFicha(props: { readonly emplazamiento: Coordenada }) {
  const control = useContext(UbicacionContexto);
  const estado = () => control.ubicacion().estado;
  const sinPunto = createMemo(() => {
    const actual = asentado(estado());
    if (actual.tipo === "denegada") return { aviso: COMO_REACTIVAR, puedeUsar: false };
    if (actual.tipo === "fallo") {
      return {
        aviso: EXPLICACION_FALLO[actual.motivo],
        puedeUsar: !sinGeolocalizacion(actual.motivo),
      };
    }
    return { aviso: undefined, puedeUsar: control.ubicacion().permiso !== "denegado" };
  });

  const cancelar = () => (
    <Boton variante="enlace" onClick={() => control.cancelar()}>
      Cancelar
    </Boton>
  );

  return (
    <SeccionReferencia>
      <Switch
        fallback={
          <SinReferencia
            titulo="¿Desde dónde lo miramos?"
            texto={<TextoConTerminos texto={PARA_QUE_SIRVE} />}
            aviso={sinPunto().aviso}
            acciones={
              <>
                <Show when={sinPunto().puedeUsar}>
                  <Boton onClick={() => control.usarUbicacion()}>Usar mi ubicación</Boton>
                </Show>
                <Boton variante="secundario" onClick={() => control.elegirEnMapa()}>
                  Elegir en el mapa
                </Boton>
              </>
            }
          />
        }
      >
        <Match when={estado().tipo === "pidiendo"}>
          <EsperandoReferencia texto="Buscando tu ubicación…" acciones={cancelar()} />
        </Match>
        <Match when={estado().tipo === "eligiendo"}>
          <EsperandoReferencia
            texto="Elige el punto en el mapa o busca una dirección."
            acciones={cancelar()}
          />
        </Match>
        <Match when={control.referencia()}>
          {(referencia) => {
            const textos = createMemo(() => textosReferencia(referencia(), props.emplazamiento));
            return (
              <ConReferencia
                tipo={referencia().tipo}
                desde={<TextoConTerminos texto={textos().desde} />}
                relacion={textos().relacion}
                margen={(() => {
                  const margen = textos().margen;
                  return margen === undefined ? undefined : <TextoConTerminos texto={margen} />;
                })()}
                acciones={
                  <>
                    <Boton variante="enlace" onClick={() => control.elegirEnMapa()}>
                      Cambiar
                    </Boton>
                    <Boton variante="enlace" onClick={() => control.quitar()}>
                      Quitar
                    </Boton>
                  </>
                }
              />
            );
          }}
        </Match>
      </Switch>
    </SeccionReferencia>
  );
}
