import { diagramaSector } from "@celda/sim/diagramaSector";
import { Simulador } from "@celda/sim/simulador";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import {
  CalculandoDiagrama,
  DiagramaRadiacion,
  LobulosSector,
} from "@celda/ui/panel/DiagramaRadiacion.tsx";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { createMemo, Errored, Loading } from "solid-js";

import { enVivo, usarDatos } from "../datos.tsx";
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
        notas={textos.notas}
        atenuacionMaxima={paramsDiagrama(orientacion).atenuacionMaximaDb}
      >
        <Loading on={props.clave} fallback={<CalculandoDiagrama />}>
          <LobulosSector
            rumbos={RUMBOS_DIAGRAMA}
            sectores={lobulosDe(orientacion, diagrama())}
            orientacion={orientacion.tipo}
            margen={orientacion.tipo === "estimada" ? orientacion.margen : undefined}
            atenuacionMaxima={paramsDiagrama(orientacion).atenuacionMaximaDb}
          />
        </Loading>
      </DiagramaRadiacion>
    </Errored>
  );
}
