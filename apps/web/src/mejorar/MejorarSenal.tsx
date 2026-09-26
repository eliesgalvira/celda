import { type Coordenada, distanciaMetros, rumboGrados } from "@celda/dominio/area";
import { Boton } from "@celda/ui/Boton.tsx";
import { Deslizador } from "@celda/ui/Eleccion.tsx";
import {
  AccionesBrujula,
  Brujula as DibujoBrujula,
  Consejo,
  HaciaEmplazamiento,
  ListaConsejos,
  LlamadaPunto,
  NotaMejorar,
  TextoBrujula,
} from "@celda/ui/mejorar/Mejorar.tsx";
import { TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
  useContext,
} from "solid-js";

import { type ServiciosDeDatos, usarDatos } from "../datos.tsx";
import { ServicioContexto } from "../servicio/enMapa.ts";
import { lecturaDe } from "../servicio/servicio.ts";
import { UbicacionContexto } from "../ubicacion/controlador.ts";
import { posicionDe } from "../ubicacion/estado.ts";
import { puedePedirUbicacion } from "../ubicacion/Ubicacion.tsx";
import { nombreRumbo } from "../ubicacion/textos.ts";
import { Brujula } from "./brujula.ts";
import { consejos } from "./consejos.ts";
import {
  escuchando,
  type EventoBrujula,
  inicialBrujula,
  rumboMostrado,
  type SituacionBrujula,
  transicionBrujula,
} from "./estado.ts";
import { TEXTOS_BRUJULA, textosGiro } from "./textos.ts";

/** El estado de la brújula y lo que se puede hacer con ella. */
interface ControlBrujula {
  /** `undefined` mientras no se sabe qué ofrece el dispositivo. */
  readonly situacion: () => SituacionBrujula | undefined;
  /** El rumbo de la barra, en grados. */
  readonly simulado: () => number;
  readonly simular: (grados: number) => void;
  readonly enviar: (evento: EventoBrujula) => void;
  /** Acepta la explicación y pide el permiso, dentro del mismo gesto. */
  readonly continuar: () => void;
}

/**
 * La brújula de la ficha, sobre la función `transicionBrujula`. Escucha el dispositivo solo
 * mientras hace falta y deja de escuchar al cerrar la ficha.
 */
const crearBrujula = (
  datos: ManagedRuntime.ManagedRuntime<ServiciosDeDatos, never>,
): ControlBrujula => {
  const [situacion, setSituacion] = createSignal<SituacionBrujula>();
  const [simulado, setSimulado] = createSignal(0);
  const enviar = (evento: EventoBrujula) =>
    setSituacion((actual) => (actual === undefined ? actual : transicionBrujula(actual, evento)));

  onSettled(() => {
    void datos
      .runPromise(Effect.map(Brujula, (brujula) => brujula.disponibilidad))
      .then((disponibilidad) => setSituacion(inicialBrujula(disponibilidad)));
  });

  createEffect(
    () => {
      const actual = situacion();
      return actual !== undefined && escuchando(actual.estado);
    },
    (encendida) => {
      if (!encendida) return;
      const parar = new AbortController();
      void datos.runPromiseExit(
        Stream.runForEach(
          Stream.unwrap(Effect.map(Brujula, (brujula) => brujula.seguir)),
          (lectura) => Effect.sync(() => enviar({ tipo: "lectura", lectura })),
        ).pipe(
          Effect.catchTag("BrujulaSinLecturas", () =>
            Effect.sync(() => enviar({ tipo: "sin-lecturas" })),
          ),
        ),
        { signal: parar.signal },
      );
      return () => parar.abort();
    },
  );

  return {
    situacion,
    simulado,
    simular: setSimulado,
    enviar,
    continuar: () => {
      const actual = situacion();
      if (actual === undefined) return;
      // La lectura de la señal no cambia hasta el siguiente ciclo: se decide con el estado nuevo.
      const siguiente = transicionBrujula(actual, { tipo: "continuar" });
      setSituacion(siguiente);
      if (siguiente.estado.tipo !== "pidiendo-permiso") return;
      // Con los servicios ya montados, el efecto se ejecuta aquí mismo y el navegador recibe la
      // petición dentro del gesto, como exige Safari.
      void datos
        .runPromise(Effect.flatMap(Brujula, (brujula) => brujula.pedirPermiso))
        .then((permiso) => enviar({ tipo: "permiso", permiso }));
    },
  };
};

/**
 * La sección «Mejorar la señal» de la ficha (historias 34 a 37). Sin punto de referencia da
 * consejos generales y dice qué se ganaría con uno. Con punto, hacia dónde orientar un router
 * 4G/5G y a qué rumbo apuntar una antena exterior, con la brújula del móvil o, en un ordenador,
 * con la barra que simula el giro.
 */
export function MejorarSenal(props: {
  readonly clave: string;
  readonly emplazamiento: Coordenada;
}) {
  const control = useContext(UbicacionContexto);
  const servicio = useContext(ServicioContexto);
  const brujula = crearBrujula(usarDatos());

  const textos = createMemo(() => {
    const referencia = control.referencia();
    if (referencia === undefined) return consejos(undefined);
    const desde = posicionDe(referencia);
    const calculado = servicio.calculado();
    return consejos({
      tipo: referencia.tipo,
      distancia: distanciaMetros(desde, props.emplazamiento),
      rumbo: rumboGrados(desde, props.emplazamiento),
      servicio:
        calculado?.pedido.clave === props.clave ? lecturaDe(calculado.resultado) : undefined,
      orientacion: servicio.orientacion,
    });
  });

  const conPunto = createMemo(() => {
    const actuales = textos();
    return actuales.tipo === "con-punto" ? actuales : undefined;
  });
  const sinPunto = createMemo(() => {
    const actuales = textos();
    return actuales.tipo === "sin-punto" ? actuales : undefined;
  });

  return (
    <>
      <Show when={conPunto()}>
        {(actuales) => (
          <HaciaEmplazamiento>
            <TextoConTerminos texto={actuales().hacia} />
          </HaciaEmplazamiento>
        )}
      </Show>
      <ListaConsejos>
        <For each={textos().consejos}>
          {(consejo) => (
            <Consejo tono={consejo.tono}>
              <TextoConTerminos texto={consejo.texto} />
            </Consejo>
          )}
        </For>
      </ListaConsejos>
      <Show when={sinPunto()}>
        {(actuales) => (
          <LlamadaPunto
            texto={<TextoConTerminos texto={actuales().llamada} />}
            acciones={
              <>
                <Show when={puedePedirUbicacion(control)}>
                  <Boton onClick={() => control.usarUbicacion()}>Usar mi ubicación</Boton>
                </Show>
                <Boton variante="secundario" onClick={() => control.elegirEnMapa()}>
                  Elegir en el mapa
                </Boton>
              </>
            }
          />
        )}
      </Show>
      <Show when={conPunto()}>
        {(actuales) => (
          <>
            <Show when={actuales().objetivo}>
              {(objetivo) => <BrujulaEnFicha objetivo={objetivo()} control={brujula} />}
            </Show>
            <NotaMejorar>
              <TextoConTerminos texto={actuales().nota} />
            </NotaMejorar>
          </>
        )}
      </Show>
    </>
  );
}

/** La brújula con su estado y sus controles, o la barra que simula el giro. */
function BrujulaEnFicha(props: { readonly objetivo: number; readonly control: ControlBrujula }) {
  const estado = () => props.control.situacion()?.estado;
  const mostrado = createMemo(() => {
    const actual = estado();
    return actual === undefined
      ? { rumbo: props.control.simulado(), fuente: "barra" as const }
      : rumboMostrado(actual, props.control.simulado());
  });
  const giro = createMemo(() => textosGiro(props.objetivo, mostrado().rumbo, mostrado().fuente));
  const sinSensor = createMemo(() => {
    const actual = estado();
    return actual?.tipo === "sin-sensor" ? actual.motivo : undefined;
  });
  const margenActiva = () => {
    const actual = estado();
    return actual?.tipo === "activa" ? actual.lectura.margen : undefined;
  };
  const barra = () => (
    <Deslizador
      etiqueta="Simular el giro"
      valor={props.control.simulado()}
      minimo={0}
      maximo={359}
      paso={1}
      texto={`${props.control.simulado()}° · ${nombreRumbo(props.control.simulado())}`}
      alCambiar={props.control.simular}
    />
  );
  const usar = (etiqueta: string) => (
    <Boton onClick={() => props.control.enviar({ tipo: "usar" })}>{etiqueta}</Boton>
  );
  const dejar = () => (
    <Boton variante="enlace" onClick={() => props.control.enviar({ tipo: "apagar" })}>
      Dejar la brújula
    </Boton>
  );

  return (
    <DibujoBrujula
      objetivo={props.objetivo}
      rumbo={mostrado().rumbo}
      fuente={mostrado().fuente}
      titulo={giro().titulo}
      descripcion={giro().descripcion}
      guia={giro().guia}
      alineado={giro().alineado}
      rumbos={giro().rumbos}
    >
      <Switch>
        <Match when={sinSensor()}>
          {(motivo) => (
            <>
              <TextoBrujula titulo={TEXTOS_BRUJULA.sinSensor(motivo()).titulo}>
                {TEXTOS_BRUJULA.sinSensor(motivo()).texto}
              </TextoBrujula>
              {barra()}
              <Show when={motivo() === "sin-lecturas"}>
                <AccionesBrujula>{usar("Probar otra vez")}</AccionesBrujula>
              </Show>
            </>
          )}
        </Match>
        <Match when={estado()?.tipo === "apagada"}>
          <AccionesBrujula>{usar("Usar la brújula del móvil")}</AccionesBrujula>
          <TextoBrujula>{TEXTOS_BRUJULA.apagada}</TextoBrujula>
          {barra()}
        </Match>
        <Match when={estado()?.tipo === "explicando"}>
          <TextoBrujula titulo={TEXTOS_BRUJULA.explicando.titulo}>
            {TEXTOS_BRUJULA.explicando.texto}
          </TextoBrujula>
          <AccionesBrujula>
            <Boton variante="destacado" onClick={() => props.control.continuar()}>
              Continuar
            </Boton>
            <Boton variante="secundario" onClick={() => props.control.enviar({ tipo: "cancelar" })}>
              Ahora no
            </Boton>
          </AccionesBrujula>
        </Match>
        <Match when={estado()?.tipo === "pidiendo-permiso"}>
          <TextoBrujula>{TEXTOS_BRUJULA.pidiendo}</TextoBrujula>
        </Match>
        <Match when={estado()?.tipo === "denegada"}>
          <TextoBrujula titulo={TEXTOS_BRUJULA.denegada.titulo}>
            {TEXTOS_BRUJULA.denegada.texto}
          </TextoBrujula>
          {barra()}
          <AccionesBrujula>{usar("Probar otra vez")}</AccionesBrujula>
        </Match>
        <Match when={estado()?.tipo === "esperando"}>
          <TextoBrujula>{TEXTOS_BRUJULA.esperando}</TextoBrujula>
          <AccionesBrujula>{dejar()}</AccionesBrujula>
        </Match>
        <Match when={estado()?.tipo === "activa"}>
          <TextoBrujula titulo={TEXTOS_BRUJULA.activa.titulo}>
            {TEXTOS_BRUJULA.activa.texto(margenActiva())}
          </TextoBrujula>
          <AccionesBrujula>{dejar()}</AccionesBrujula>
        </Match>
        <Match when={estado()?.tipo === "dudosa"}>
          <TextoBrujula titulo={TEXTOS_BRUJULA.dudosa.titulo}>
            {TEXTOS_BRUJULA.dudosa.texto}
          </TextoBrujula>
          <AccionesBrujula>{dejar()}</AccionesBrujula>
        </Match>
      </Switch>
    </DibujoBrujula>
  );
}
