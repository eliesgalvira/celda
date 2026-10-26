/**
 * Qué contesta la API a quien la abre sin parámetros (ADR 0032): un navegador recibe una página que
 * explica cómo usarla, y un programa o un agente, JSON. Una consulta con parámetros contesta
 * siempre en JSON, porque algunos agentes piden con la cabecera `Accept` de un navegador y tienen
 * que recibir los datos.
 */

/** La calidad que da `accept` al tipo `tipo`, contando los comodines; 0 si no lo acepta. */
const calidad = (accept: string, tipo: string): number => {
  const [grupo] = tipo.split("/");
  let mejor = { precision: -1, q: 0 };
  for (const parte of accept.split(",")) {
    const [rango = "", ...parametros] = parte.split(";").map((trozo) => trozo.trim().toLowerCase());
    const precision =
      rango === tipo ? 2 : rango === `${grupo}/*` ? 1 : rango === "*/*" ? 0 : undefined;
    if (precision === undefined || precision < mejor.precision) continue;
    const q = Number(parametros.find((p) => p.startsWith("q="))?.slice(2) ?? "1");
    mejor = { precision, q: Number.isFinite(q) ? q : 0 };
  }
  return mejor.q;
};

/**
 * Si la petición prefiere HTML a JSON: solo cuando nombra `text/html` y le da más calidad que a
 * `application/json`. `curl` manda `*\/*` y un agente suele mandar `application/json`: los dos
 * reciben JSON.
 */
export const prefiereHtml = (accept: string | null): boolean => {
  if (accept === null || !/(^|,)\s*text\/html/iu.test(accept)) return false;
  return calidad(accept, "text/html") > calidad(accept, "application/json");
};

/** Si la URL no lleva ningún parámetro. */
export const sinConsulta = (url: URL): boolean => url.search === "";

/** Si a esta petición sin parámetros hay que contestarle con la página. */
export const quiereLaPagina = (peticion: Request, url: URL): boolean =>
  sinConsulta(url) && prefiereHtml(peticion.headers.get("accept"));
