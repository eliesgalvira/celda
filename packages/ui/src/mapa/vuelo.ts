import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapaMapLibre,
} from "maplibre-gl";

import type { Rgb } from "./color.ts";

/**
 * El vuelo de los puntos al cambiar de vista en «Funciones» (ADR 0028): al pasar a la vista
 * agrupada, cada punto vuela hasta el hexágono que lo va a recoger y el hexágono sale con su
 * número; al volver a la de puntos, salen de él. Con decenas de miles de puntos no se puede mover
 * uno a uno desde JavaScript: es una capa propia de MapLibre que dibuja todos los puntos de una
 * vez, y su sombreador de vértices lleva cada uno entre su sitio y el de su hexágono con un solo
 * número, `t`, que va de 0 a 1 en `duracionMs`. Al acabar se quita y siguen los hexágonos del DOM
 * o los puntos de siempre.
 */

/** El identificador de la capa mientras dura un vuelo. */
export const CAPA_DE_VUELO = "puntos-en-vuelo";

/** Lo que dura el vuelo. */
export const DURACION_DEL_VUELO_MS = 550;

/**
 * Al juntarse, en qué parte del vuelo empiezan a salir los hexágonos: cuando los puntos están
 * llegando, para que brotar y llegar se solapen.
 */
export const LLEGADA_AL_JUNTARSE = 0.65;

export interface VueloDePuntos {
  /** Dónde está cada punto y dónde va, en coordenadas de Mercator de 0 a 1, de dos en dos. */
  readonly desde: Float32Array<ArrayBuffer>;
  readonly hasta: Float32Array<ArrayBuffer>;
  readonly color: Rgb;
  /** La opacidad y el diámetro en píxeles CSS de los puntos del mapa al zoom del vuelo. */
  readonly opacidad: number;
  readonly diametro: number;
  /**
   * `junta`: van de su sitio a su hexágono y se apagan al llegar. `separa`: salen del hexágono a su
   * sitio, y al llegar se funden con los puntos del mapa en `fundidoMs`.
   */
  readonly sentido: "junta" | "separa";
  readonly fundidoMs: number;
  /** Cuando llegan: al juntarse, en `LLEGADA_AL_JUNTARSE`; al separarse, al final del vuelo. */
  readonly alLlegar: () => void;
  /** Cuando el vuelo, y el fundido si lo hay, han terminado: hay que quitar la capa. */
  readonly alAcabar: () => void;
}

const VERTICES = `#version 300 es
uniform mat4 u_matriz;
uniform float u_t;
uniform float u_tamano;
in vec2 a_desde;
in vec2 a_hasta;
void main() {
  gl_Position = u_matriz * vec4(mix(a_desde, a_hasta, u_t), 0.0, 1.0);
  gl_PointSize = u_tamano;
}`;

const FRAGMENTOS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 color;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  color = u_color * (1.0 - smoothstep(0.7, 1.0, d));
}`;

/** Una curva que arranca y llega despacio. */
const suave = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const entre = (desde: number, hasta: number, t: number): number => {
  const x = Math.min(1, Math.max(0, (t - desde) / (hasta - desde)));
  return x * x * (3 - 2 * x);
};

/** Un momento del vuelo: por dónde van los puntos (`t`, de 0 a 1), su opacidad y si ha acabado. */
export interface MomentoDelVuelo {
  readonly t: number;
  readonly opacidad: number;
  readonly acabado: boolean;
}

/** La posición y la opacidad de los puntos a `ms` del despegue, y si el vuelo ha terminado. */
export const momentoDelVuelo = (
  vuelo: Pick<VueloDePuntos, "sentido" | "opacidad" | "fundidoMs">,
  ms: number,
): MomentoDelVuelo => {
  const t = Math.min(1, ms / DURACION_DEL_VUELO_MS);
  if (vuelo.sentido === "junta") {
    return {
      t: suave(t),
      opacidad: vuelo.opacidad * (1 - entre(LLEGADA_AL_JUNTARSE, 1, t)),
      acabado: t >= 1,
    };
  }
  const fundido = vuelo.fundidoMs <= 0 ? 1 : (ms - DURACION_DEL_VUELO_MS) / vuelo.fundidoMs;
  return {
    t: suave(t),
    opacidad: vuelo.opacidad * entre(0, 0.3, t) * (t < 1 ? 1 : 1 - Math.min(1, fundido)),
    acabado: t >= 1 && fundido >= 1,
  };
};

const compilar = (gl: WebGL2RenderingContext, tipo: number, fuente: string): WebGLShader => {
  const sombreador = gl.createShader(tipo);
  if (sombreador === null) throw new Error("WebGL no da un sombreador");
  gl.shaderSource(sombreador, fuente);
  gl.compileShader(sombreador);
  return sombreador;
};

/**
 * El programa de cada contexto de WebGL, compilado la primera vez que vuela algo: compilar en
 * cada vuelo costaba un fotograma largo al empezar.
 */
const programas = new WeakMap<WebGL2RenderingContext, WebGLProgram>();

const programaDe = (gl: WebGL2RenderingContext): WebGLProgram => {
  const hecho = programas.get(gl);
  if (hecho !== undefined) return hecho;
  const programa = gl.createProgram();
  gl.attachShader(programa, compilar(gl, gl.VERTEX_SHADER, VERTICES));
  gl.attachShader(programa, compilar(gl, gl.FRAGMENT_SHADER, FRAGMENTOS));
  gl.linkProgram(programa);
  programas.set(gl, programa);
  return programa;
};

/**
 * La capa del vuelo. Dibuja con `gl.POINTS` desde dos búferes que se suben una vez al añadirla;
 * en cada fotograma solo cambian `t` y el color. Pide otro fotograma mientras vuela.
 */
export const capaDeVuelo = (vuelo: VueloDePuntos): CustomLayerInterface => {
  let mapa: MapaMapLibre | undefined;
  let programa: WebGLProgram | null = null;
  let arreglo: WebGLVertexArrayObject | null = null;
  const buferes: Array<WebGLBuffer> = [];
  let despegue: number | undefined;
  let llegado = false;
  let acabado = false;
  const cuantos = vuelo.desde.length / 2;
  return {
    id: CAPA_DE_VUELO,
    type: "custom",
    renderingMode: "2d",
    onAdd: (alMapa, gl) => {
      mapa = alMapa;
      programa = programaDe(gl);
      arreglo = gl.createVertexArray();
      gl.bindVertexArray(arreglo);
      for (const [nombre, datos] of [
        ["a_desde", vuelo.desde],
        ["a_hasta", vuelo.hasta],
      ] as const) {
        const bufer = gl.createBuffer();
        buferes.push(bufer);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufer);
        gl.bufferData(gl.ARRAY_BUFFER, datos, gl.STATIC_DRAW);
        const lugar = gl.getAttribLocation(programa, nombre);
        gl.enableVertexAttribArray(lugar);
        gl.vertexAttribPointer(lugar, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    onRemove: (_mapa, gl) => {
      for (const bufer of buferes) gl.deleteBuffer(bufer);
      gl.deleteVertexArray(arreglo);
    },
    render: (gl, opciones: CustomRenderMethodInput) => {
      if (programa === null || mapa === undefined || acabado) return;
      const ahora = performance.now();
      despegue ??= ahora;
      const momento = momentoDelVuelo(vuelo, ahora - despegue);
      const { r, g, b } = vuelo.color;
      const a = momento.opacidad;
      gl.useProgram(programa);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(programa, "u_matriz"),
        false,
        // La matriz de la proyección de Mercator: lleva coordenadas de 0 a 1 al espacio de recorte.
        opciones.defaultProjectionData.mainMatrix,
      );
      gl.uniform1f(gl.getUniformLocation(programa, "u_t"), momento.t);
      gl.uniform1f(
        gl.getUniformLocation(programa, "u_tamano"),
        vuelo.diametro * mapa.getPixelRatio(),
      );
      gl.uniform4f(gl.getUniformLocation(programa, "u_color"), r * a, g * a, b * a, a);
      gl.bindVertexArray(arreglo);
      gl.drawArrays(gl.POINTS, 0, cuantos);
      gl.bindVertexArray(null);
      const llega =
        vuelo.sentido === "junta"
          ? ahora - despegue >= LLEGADA_AL_JUNTARSE * DURACION_DEL_VUELO_MS
          : ahora - despegue >= DURACION_DEL_VUELO_MS;
      if (llega && !llegado) {
        llegado = true;
        queueMicrotask(vuelo.alLlegar);
      }
      if (momento.acabado) {
        acabado = true;
        queueMicrotask(vuelo.alAcabar);
      } else {
        mapa.triggerRepaint();
      }
    },
  };
};
