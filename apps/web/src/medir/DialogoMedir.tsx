import { MEDIDA_DE_EJEMPLO } from "@celda/dominio/medida";
import {
  type CodigoModoInformacion,
  MarcaAndroid,
  NOMBRE_MARCA,
} from "@celda/dominio/modoInformacion";
import { Boton } from "@celda/ui/Boton.tsx";
import { Desplegable } from "@celda/ui/Desplegable.tsx";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { Segmentado, Selector } from "@celda/ui/Eleccion.tsx";
import { Etiqueta } from "@celda/ui/Etiqueta.tsx";
import { CodigoQr } from "@celda/ui/medir/CodigoQr.tsx";
import { Termino } from "@celda/ui/termino/Termino.tsx";
import {
  CodigoDelModo,
  MedidaMostrada,
  Nota,
  Opcion,
  Paso,
  Pasos,
  Puntos,
} from "@celda/ui/medir/Medir.tsx";
import { createMemo, createSignal, Match, Show, Switch } from "solid-js";

import {
  type DatosDelNavegador,
  detectarDispositivo,
  type TipoDeDispositivo,
} from "./dispositivo.ts";
import { type Eleccion, instruccionesPara, type MarcaElegida } from "./instrucciones.ts";
import { valoresDeLaLectura } from "./textos.ts";

const TIPOS: ReadonlyArray<{ readonly valor: TipoDeDispositivo; readonly etiqueta: string }> = [
  { valor: "ordenador", etiqueta: "Ordenador" },
  { valor: "android", etiqueta: "Android" },
  { valor: "iphone", etiqueta: "iPhone" },
];

const MARCAS: ReadonlyArray<{ readonly valor: MarcaElegida; readonly etiqueta: string }> = [
  ...MarcaAndroid.literals.map((marca) => ({ valor: marca, etiqueta: NOMBRE_MARCA[marca] })),
  { valor: "otra", etiqueta: "Otra marca" },
];

export interface DialogoMedirProps {
  /** Lo que dice el navegador, con el modelo si ya ha llegado. */
  readonly navegador: DatosDelNavegador;
  /** La dirección que abre este mismo paso, para el código QR. */
  readonly direccionMovil: string;
  readonly alCerrar: () => void;
}

/**
 * El paso de medir la señal (historias 44 a 46 y 49). Explica qué hacer según el dispositivo:
 * en un ordenador, por qué no se puede y qué alternativas hay; en un móvil, el código de su
 * marca y qué le pasa al marcarlo. Desde cualquiera se puede ver la medida de ejemplo.
 */
export function DialogoMedir(props: DialogoMedirProps) {
  const [eleccion, setEleccion] = createSignal<Eleccion>({});
  const [viendoEjemplo, setViendoEjemplo] = createSignal(false);
  const detectado = createMemo(() => detectarDispositivo(props.navegador));
  const instrucciones = createMemo(() => instruccionesPara(detectado(), eleccion()));

  /** Solo si lo ha deducido Celda: puede no ser el de la persona. */
  const ayudaDelTipo = () =>
    eleccion().tipo === undefined && detectado().tipo !== "desconocido"
      ? "Sale de tu navegador. Cámbialo si no es el tuyo."
      : undefined;

  const verEjemplo = (
    <Boton variante="secundario" onClick={() => setViendoEjemplo(true)}>
      Ver la medida de ejemplo
    </Boton>
  );

  return (
    <Dialogo
      titulo={viendoEjemplo() ? "Una medida de ejemplo" : "Medir tu señal"}
      antetitulo="TU SEÑAL"
      alCerrar={props.alCerrar}
    >
      <Show
        when={!viendoEjemplo()}
        fallback={<VistaEjemplo volver={() => setViendoEjemplo(false)} />}
      >
        <Segmentado
          leyenda="Tu dispositivo"
          opciones={TIPOS}
          valor={instrucciones().tipo === "desconocido" ? undefined : instrucciones().tipo}
          alCambiar={(tipo) => setEleccion((previa) => ({ ...previa, tipo }))}
          ayuda={ayudaDelTipo()}
        />
        <Switch>
          <Match when={instrucciones().tipo === "ordenador"}>
            <Nota tono="aviso" titulo="Desde un ordenador no se puede medir">
              <p>
                Hace falta la radio y la SIM de un móvil para recibir las{" "}
                <Termino termino="estacion-base">estaciones base</Termino>.
              </p>
            </Nota>
            <Opcion
              titulo="Abrir Celda en el móvil"
              lado={<CodigoQr texto={props.direccionMovil} nombre="Abre este paso en el móvil" />}
            >
              <p>Escanea el código con la cámara del móvil.</p>
            </Opcion>
            <Opcion
              titulo="Subir una captura que ya tengas"
              etiqueta={<Etiqueta tono="pronto">PRONTO</Etiqueta>}
            >
              <p>
                Aún no se puede, porque falta decidir cómo leerá Celda la captura del{" "}
                <Termino termino="modo-de-informacion">modo de información</Termino>.
              </p>
            </Opcion>
            <Opcion titulo="Ver una medida de ejemplo" acciones={verEjemplo}>
              <p>Es una medida inventada con cada número explicado.</p>
            </Opcion>
          </Match>
          <Match when={instrucciones().tipo === "desconocido"}>
            <Nota titulo="No sabemos desde qué dispositivo abres Celda">
              <p>
                Elígelo arriba. Una tableta sin la app Teléfono no puede marcar el código del{" "}
                <Termino termino="modo-de-informacion">modo de información</Termino>.
              </p>
            </Nota>
            <div>{verEjemplo}</div>
          </Match>
          <Match when={instrucciones().tipo === "iphone" || instrucciones().tipo === "android"}>
            <p>El navegador no deja que una web lea la señal del móvil, así que se mide a mano.</p>
            <Pasos>
              <Paso numero={1} titulo="Abre la app Teléfono y marca este código">
                <Show when={instrucciones().tipo === "android"}>
                  <Selector
                    etiqueta="Marca del móvil"
                    vacio="Elige la marca"
                    opciones={MARCAS}
                    valor={(() => {
                      const actual = instrucciones();
                      return actual.tipo === "android" ? actual.marca : undefined;
                    })()}
                    alCambiar={(marca) => setEleccion((previa) => ({ ...previa, marca }))}
                  />
                </Show>
                <CodigoDelModo
                  codigo={codigoVigente(instrucciones())?.codigo}
                  vacio="Elige la marca para ver su código."
                />
                <Show when={codigoVigente(instrucciones())}>
                  {(codigo) => (
                    <ComoSeAbre codigo={codigo()} deducida={marcaDeducida(instrucciones())} />
                  )}
                </Show>
              </Paso>
              <Paso numero={2} titulo="Haz una captura de pantalla">
                <p>Hazla cuando se vean los números de la señal.</p>
              </Paso>
              <Paso numero={3} titulo="Súbela a Celda">
                <p>
                  <Etiqueta tono="pronto">PRONTO</Etiqueta> Aún no se puede, porque falta decidir
                  cómo leerá Celda la captura. Guárdala para más adelante.
                </p>
              </Paso>
            </Pasos>
            <Desplegable titulo="Qué hace el código en el móvil" abierto variante="recuadro">
              <Puntos>
                <li>Abre una pantalla de fábrica del móvil. No instala ni cambia nada.</li>
                <li>No llama ni cuesta nada.</li>
                <Show when={instrucciones().tipo === "android"}>
                  <li>Si salen botones de pruebas, no los toques. Sal con el botón de volver.</li>
                </Show>
                <li>De la captura que subas, Celda solo lee los números de la señal.</li>
              </Puntos>
            </Desplegable>
            <div>
              <Boton variante="secundario" onClick={() => setViendoEjemplo(true)}>
                Prefiero ver un ejemplo
              </Boton>
            </div>
          </Match>
        </Switch>
      </Show>
    </Dialogo>
  );
}

const codigoVigente = (
  instrucciones: ReturnType<typeof instruccionesPara>,
): CodigoModoInformacion | undefined =>
  instrucciones.tipo === "iphone" || instrucciones.tipo === "android"
    ? instrucciones.codigo
    : undefined;

const marcaDeducida = (instrucciones: ReturnType<typeof instruccionesPara>): boolean =>
  instrucciones.tipo === "android" && instrucciones.deducida;

const COMO_SE_ABRE: Readonly<
  Record<CodigoModoInformacion["seAbre"], (pantalla: string) => string>
> = {
  solo: (pantalla) => `Se abre «${pantalla}» al escribir el último signo, sin pulsar llamar.`,
  llamar: (pantalla) => `Pulsa el botón de llamar y se abre «${pantalla}».`,
  "sin-comprobar": (pantalla) =>
    `Se abre «${pantalla}». Si no se abre al escribir el último signo, pulsa el botón de llamar.`,
};

/** Qué pantalla abre el código, cómo se abre y si está comprobado. */
function ComoSeAbre(props: { readonly codigo: CodigoModoInformacion; readonly deducida: boolean }) {
  return (
    <>
      <p>
        {COMO_SE_ABRE[props.codigo.seAbre](props.codigo.pantalla)}
        <Show when={props.codigo.despues}>{(despues) => ` ${despues()}`}</Show>
      </p>
      <Show when={props.deducida}>
        <p>Si no es tu marca, cámbiala arriba.</p>
      </Show>
      <Show when={props.codigo.nota}>{(nota) => <p>{nota()}</p>}</Show>
      <Show when={props.codigo.comprobacion === "sin-verificar"}>
        <Nota tono="aviso" titulo="Código sin comprobar">
          <p>Sale de guías de terceros. Si no abre nada, prueba con «Otra marca».</p>
        </Nota>
      </Show>
    </>
  );
}

/** La medida de ejemplo con sus valores explicados. Nunca se presenta como propia (historia 49). */
function VistaEjemplo(props: { readonly volver: () => void }) {
  return (
    <>
      <MedidaMostrada
        tipo="ejemplo"
        etiqueta={<Etiqueta tono="ejemplo">EJEMPLO</Etiqueta>}
        titulo={`Medida de ejemplo en ${MEDIDA_DE_EJEMPLO.lugar}`}
        valores={valoresDeLaLectura(MEDIDA_DE_EJEMPLO.senal)}
      >
        <p>
          Son números inventados, como los del{" "}
          <Termino termino="modo-de-informacion">modo de información</Termino> de un móvil.
        </p>
      </MedidaMostrada>
      <div>
        <Boton variante="secundario" onClick={() => props.volver()}>
          Volver
        </Boton>
      </div>
    </>
  );
}
