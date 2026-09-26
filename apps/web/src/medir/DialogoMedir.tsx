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

  const ayudaDelTipo = () => {
    if (eleccion().tipo !== undefined) return "Lo has elegido tú.";
    return detectado().tipo === "desconocido"
      ? "Tu navegador no deja claro qué dispositivo es. Elígelo tú."
      : "Lo hemos deducido de tu navegador. Si no acierta, cámbialo.";
  };

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
                Quien habla con las estaciones base es el móvil, a través de su tarjeta SIM. Un
                ordenador no tiene esa radio, así que desde aquí no hay ninguna señal que medir.
              </p>
            </Nota>
            <p>Tienes tres opciones:</p>
            <Opcion
              titulo="Abrir Celda en el móvil"
              lado={<CodigoQr texto={props.direccionMovil} nombre="Abre este paso en el móvil" />}
            >
              <p>
                Escanea este código con la cámara del móvil. Se abre esta misma página, ya en el
                paso de medir, con el código para tu marca.
              </p>
            </Opcion>
            <Opcion
              titulo="Subir una captura que ya tengas"
              etiqueta={<Etiqueta tono="pronto">PRONTO</Etiqueta>}
            >
              <p>
                Si ya tienes una captura del modo de información de tu móvil, podrás subirla desde
                aquí. Todavía no funciona. Falta decidir cómo leerá Celda los números de la captura.
              </p>
            </Opcion>
            <Opcion titulo="Ver una medida de ejemplo" acciones={verEjemplo}>
              <p>
                Una medida inventada, con lo que quiere decir cada número. Va marcada como ejemplo y
                no cuenta como tuya.
              </p>
            </Opcion>
          </Match>
          <Match when={instrucciones().tipo === "desconocido"}>
            <Nota titulo="No sabemos desde qué dispositivo abres Celda">
              <p>
                Elige arriba si es un ordenador, un Android o un iPhone y te diremos cómo medir. Una
                tableta sin la app Teléfono no puede marcar el código del modo de información.
              </p>
            </Nota>
            <div>{verEjemplo}</div>
          </Match>
          <Match when={instrucciones().tipo === "iphone" || instrucciones().tipo === "android"}>
            <p>
              Tu móvil sabe cómo le llega la señal, pero por privacidad el navegador no deja que una
              web lea esos datos. Por eso se hace a mano, en tres pasos.
            </p>
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
                  vacio="Tu navegador no dice la marca del móvil. Elígela y aquí saldrá su código."
                />
                <Show when={codigoVigente(instrucciones())}>
                  {(codigo) => (
                    <ComoSeAbre codigo={codigo()} deducida={marcaDeducida(instrucciones())} />
                  )}
                </Show>
              </Paso>
              <Paso numero={2} titulo="Haz una captura de pantalla">
                <p>Con los números de la señal a la vista. Luego vuelve aquí.</p>
              </Paso>
              <Paso numero={3} titulo="Súbela a Celda">
                <p>
                  <Etiqueta tono="pronto">PRONTO</Etiqueta> Todavía no se puede. Falta decidir cómo
                  leerá Celda los números de la captura. Guárdala y podrás subirla más adelante.
                </p>
              </Paso>
            </Pasos>
            <Desplegable titulo="¿Qué le pasa a mi móvil?" abierto>
              <Puntos>
                <li>
                  No se instala nada ni cambia ningún ajuste. El código abre una pantalla que el
                  móvil trae de fábrica.
                </li>
                <li>No es una llamada y no cuesta nada.</li>
                <Show when={instrucciones().tipo === "android"}>
                  <li>
                    Algunas marcas enseñan botones de pruebas en esa pantalla. No hace falta tocar
                    ninguno: sal con el botón de volver.
                  </li>
                </Show>
                <li>
                  Celda solo ve la captura que tú subas, y de ella solo lee los números de la señal.
                </li>
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
        <p>La marca sale de tu navegador. Si no es la tuya, cámbiala arriba.</p>
      </Show>
      <Show when={props.codigo.nota}>{(nota) => <p>{nota()}</p>}</Show>
      <Show when={props.codigo.comprobacion === "sin-verificar"}>
        <Nota tono="aviso" titulo="Código sin comprobar">
          <p>
            No lo hemos encontrado en ninguna fuente oficial, solo en guías publicadas por otros. Si
            no se abre nada, no pasa nada. Prueba con «Otra marca», que da el código general de
            Android, o mira la medida de ejemplo.
          </p>
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
          Estos números son inventados y no cuentan como una medida tuya. Son los mismos datos que
          enseña el modo de información de un móvil.
        </p>
      </MedidaMostrada>
      <p>
        Cuando se puedan registrar medidas, cada una se verá en el mapa unida al emplazamiento que
        le daba servicio.
      </p>
      <div>
        <Boton variante="secundario" onClick={() => props.volver()}>
          Volver
        </Boton>
      </div>
    </>
  );
}
