import { diagramaSector } from "@celda/sim/diagramaSector";
import { Simulador } from "@celda/sim/simulador";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import {
  CalculandoDiagrama,
  DiagramaRadiacion,
  DireccionReferencia,
  LobulosSector,
} from "@celda/ui/panel/DiagramaRadiacion.tsx";
import { TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { createMemo, Errored, Loading, Show, useContext } from "solid-js";

import { enVivo, usarDatos } from "../datos.tsx";
import { ServicioContexto } from "../servicio/enMapa.ts";
import { lecturaDe } from "../servicio/servicio.ts";
import { UbicacionContexto } from "../ubicacion/controlador.ts";
import {
  lobulosDe,
  MALLA_DIAGRAMA,
  orientacionDe,
  paramsDiagrama,
  RUMBOS_DIAGRAMA,
  textosDiagrama,
} from "./diagrama.ts";

/**
 * El diagrama de radiación de los sectores de un emplazamiento (historias 15 y 16). Lo calcula el
 * simulador en su Worker; mientras tanto el marco ya ocupa su sitio. Cambiar de emplazamiento
 * cierra la lectura anterior, y eso cancela su cálculo si no había acabado.
 */
export function ComoEmite(props: { readonly clave: string }) {
  const datos = usarDatos();
  const servicio = useContext(ServicioContexto);
  const ubicacion = useContext(UbicacionContexto);
  /** Con un punto de referencia, hacia dónde queda y qué sector le da servicio. */
  const haciaElPunto = createMemo(() => {
    const referencia = ubicacion.referencia();
    const calculado = servicio.calculado();
    if (referencia === undefined || calculado?.pedido.clave !== props.clave) return undefined;
    const lectura = lecturaDe(calculado.resultado);
    return lectura === undefined
      ? undefined
      : {
          rumbo: lectura.rumbo,
          sector: lectura.sector,
          etiqueta: referencia.tipo === "gps" ? "TÚ" : "PUNTO",
        };
  });
  // Ninguna fuente publica hacia dónde apuntan los sectores (docs/investigacion/registro-oficial.md):
  // la ficha no trae azimuts y la orientación es siempre la supuesta.
  const orientacion = orientacionDe([]);
  const textos = textosDiagrama(orientacion);

  const diagrama = createMemo(() => {
    // Un cálculo por emplazamiento: al cambiar la clave se abandona el anterior.
    const _clave = props.clave;
    return enVivo(
      datos,
      Stream.fromEffect(
        Effect.gen(function* () {
          const simulador = yield* Simulador;
          return yield* simulador.ejecutar(
            diagramaSector,
            paramsDiagrama(orientacion),
            MALLA_DIAGRAMA,
          );
        }),
      ),
    );
  });

  return (
    <Errored
      fallback={(_error, reintentar) => (
        <Aviso
          tono="fallo"
          encaje="panel"
          titulo="No se ha podido calcular el diagrama"
          acciones={
            <Boton variante="secundario" onClick={() => reintentar()}>
              Reintentar
            </Boton>
          }
        >
          El modelo se calcula en tu navegador y esta vez ha fallado. El resto de la ficha no
          depende de él.
        </Aviso>
      )}
    >
      <DiagramaRadiacion
        titulo={textos.titulo}
        descripcion={textos.descripcion}
        modelo={textos.modelo}
        leyenda={textos.leyenda}
        notas={textos.notas.map((nota) => (
          <TextoConTerminos texto={nota} />
        ))}
        atenuacionMaxima={paramsDiagrama(orientacion).atenuacionMaximaDb}
        azimuts={orientacion.azimuts}
      >
        <Loading on={props.clave} fallback={<CalculandoDiagrama />}>
          <LobulosSector
            rumbos={RUMBOS_DIAGRAMA}
            sectores={lobulosDe(orientacion, diagrama())}
            orientacion={orientacion.tipo}
            margen={orientacion.tipo === "estimada" ? orientacion.margen : undefined}
            atenuacionMaxima={paramsDiagrama(orientacion).atenuacionMaximaDb}
            destacado={haciaElPunto()?.sector}
          />
        </Loading>
        <Show when={haciaElPunto()}>
          {(punto) => <DireccionReferencia rumbo={punto().rumbo} etiqueta={punto().etiqueta} />}
        </Show>
      </DiagramaRadiacion>
    </Errored>
  );
}
