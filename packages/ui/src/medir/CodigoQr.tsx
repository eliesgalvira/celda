import { createMemo, createUniqueId, For } from "solid-js";
import { encode } from "uqr";

export interface CodigoQrProps {
  /** Lo que lleva el código, normalmente una dirección. */
  readonly texto: string;
  /** Qué abre el código. Se lee bajo el dibujo y es el nombre de la figura. */
  readonly nombre: string;
}

/**
 * Código QR dibujado en el navegador con `uqr`, sin pedir nada a ningún servidor. Cada fila es un
 * solo trazo, así que un código de 33 módulos son 33 nodos y no más de mil. Mide siempre lo mismo
 * (8,5 rem de ancho) y no mueve nada al aparecer.
 */
export function CodigoQr(props: CodigoQrProps) {
  const idPie = createUniqueId();
  const codigo = createMemo(() => encode(props.texto, { ecc: "M", border: 2 }));
  /** Un trazo por fila con un tramo por cada serie de módulos negros. */
  const filas = createMemo(() =>
    codigo().data.map((fila, y) => {
      let trazo = "";
      let x = 0;
      while (x < fila.length) {
        if (fila[x] === true) {
          const inicio = x;
          while (fila[x] === true) x += 1;
          trazo += `M${inicio} ${y}h${x - inicio}v1h${inicio - x}z`;
        } else {
          x += 1;
        }
      }
      return trazo;
    }),
  );
  return (
    <figure aria-labelledby={idPie} class="flex w-34 shrink-0 flex-col items-center gap-1">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${codigo().size} ${codigo().size}`}
        class="size-34 bg-qr-fondo text-qr-tinta [shape-rendering:crispEdges]"
      >
        <For each={filas()}>{(trazo) => <path d={trazo} fill="currentColor" />}</For>
      </svg>
      <figcaption id={idPie} class="text-center text-xs leading-snug text-tinta-suave">
        {props.nombre}
      </figcaption>
    </figure>
  );
}
