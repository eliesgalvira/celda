# Simulaciones como funciones puras detrás de una interfaz fija, sin Bend en la v1

Estado: aceptada el 24/09/2026. El 04/10/2026 el usuario decidió que la interfaz no enseña el `id` ni la `version` de una simulación: es un detalle de implementación que nadie que use la web necesita. Sigue diciendo que es un modelo o una simulación. El `id` y la `version` quedan en el código, en los resultados de referencia y en lo que se exporte.

Celda tiene que servir de base para experimentos de simulación, y quien investigue debe poder añadir uno sin tocar el resto de la aplicación. Toda simulación cumple esta interfaz:

```ts
interface Simulacion<Params, Resultado> {
  id: string; version: string;
  params: Schema.Schema<Params>;                 // también es el formato de intercambio
  ejecutar(p: Params, malla: Malla): Resultado;  // pura; salida en arrays tipados
}
```

En el navegador se ejecutan en un Web Worker orquestado con Effect. La implementación en TypeScript es la referencia. Cada `version` tiene ficheros de resultados de referencia, y cualquier otra implementación debe coincidir con ellos dentro de una tolerancia declarada. La interfaz dice siempre que el resultado es un modelo, sin su `id` ni su `version`.

Las simulaciones de la v1 vienen del prototipo:

- diagrama de sector del 3GPP, A(φ) = −mín(12·(φ/65°)², 30 dB);
- pérdidas urbanas, 128,1 + 37,6·log10(d km), con corrección por frecuencia;
- celdas de Voronoi y reparto por sectores;
- SINR sobre malla hexagonal por compañía y banda, con reutilización 1 y ocupación ajustable.

## Opciones descartadas

Bend queda fuera de la v1, tanto en la aplicación como en lotes fuera de línea. Su salida a JavaScript usa un solo núcleo y es unas 20 veces más lenta que la nativa, no tiene salida oficial a WASM y solo trabaja con F32. Más adelante puede entrar detrás de la misma interfaz de dos formas. Una es un laboratorio de leyes que compruebe que cada punto tiene un único servidor, que las celdas forman una partición y que el traspaso no oscila. La otra son lotes pesados que generan capas precalculadas.
