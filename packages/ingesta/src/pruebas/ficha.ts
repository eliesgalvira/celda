/** Una fila de datos de una tabla de la ficha, con su fondo, que va por posición. */
const FILA = /(<tr style="background-color: [^"]*">)([\s\S]*?)(<\/tr>)/gu;

/** Las filas de datos de un trozo de la ficha, cada una en el sitio de la siguiente. */
const rotarTrozo = (trozo: string, vueltas: number): string => {
  const contenidos = [...trozo.matchAll(FILA)].map((fila) => fila[2] ?? "");
  if (contenidos.length < 2) return trozo;
  let indice = 0;
  return trozo.replace(FILA, (_fila, apertura: string, _contenido, cierre: string) => {
    const contenido = contenidos[(indice + vueltas) % contenidos.length] ?? "";
    indice++;
    return `${apertura}${contenido}${cierre}`;
  });
};

/**
 * La misma ficha del registro con las filas de «Características técnicas» y de «Niveles medidos en
 * el entorno» en otro orden, como la da el registro de una petición a otra (ADR 0027): cada fila de
 * datos pasa al sitio de la que va `vueltas` después. El fondo de cada fila se queda en su sitio.
 */
export const conFilasRotadas = (html: string, vueltas = 1): string => {
  const niveles = html.indexOf("NIVELES MEDIDOS");
  return niveles < 0
    ? rotarTrozo(html, vueltas)
    : rotarTrozo(html.slice(0, niveles), vueltas) + rotarTrozo(html.slice(niveles), vueltas);
};
