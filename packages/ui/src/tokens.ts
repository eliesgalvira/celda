export type Tema = "claro" | "oscuro";

/** Dónde empieza cada tema en `tema.css`: el oscuro va dentro de su variante. */
const SELECTORES: Readonly<Record<Tema, string>> = {
  claro: ":root {",
  oscuro: "@variant oscuro {",
};

/**
 * Las variables CSS que define el texto de `tema.css` para un tema, con su valor tal cual. El
 * bloque acaba en la primera llave de cierre sin sangrar: la de la variante del oscuro va sangrada.
 */
export const leerTokens = (css: string, cual: Tema): ReadonlyMap<string, string> => {
  const inicio = css.indexOf(SELECTORES[cual]);
  const cuerpo = css.slice(inicio, css.indexOf("\n}", inicio));
  return new Map(
    Array.from(cuerpo.matchAll(/--([\w-]+):\s*([^;]+);/gu), ([, nombre = "", valor = ""]) => [
      nombre,
      valor.replaceAll(/\s+/gu, " ").trim(),
    ]),
  );
};
