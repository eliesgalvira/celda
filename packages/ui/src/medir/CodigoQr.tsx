import { createMemo, For } from "solid-js";
import { encode } from "uqr";

export interface CodigoQrProps {
  /** Lo que lleva el código, normalmente una dirección. */
  readonly texto: string;
  /** Qué abre el código, dicho para el lector de pantalla. */
  readonly nombre: string;
}

/**
 * Código QR dibujado en el navegador con `uqr`, sin pedir nada a ningún servidor. Cada fila es un
 * solo trazo, así que un código de 33 módulos son 33 nodos y no más de mil. Mide siempre lo mismo
 * (8,5 rem): no mueve nada al aparecer.
 */
export function CodigoQr(props: CodigoQrProps) {
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
    <svg
      role="img"
      aria-label={props.nombre}
      viewBox={`0 0 ${codigo().size} ${codigo().size}`}
      shape-rendering="crispEdges"
      class="size-34 shrink-0 bg-qr-fondo text-qr-tinta"
    >
      <For each={filas()}>{(trazo) => <path d={trazo} fill="currentColor" />}</For>
    </svg>
  );
}
