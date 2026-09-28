export type Tema = "claro" | "oscuro";

const SELECTORES: Readonly<Record<Tema, string>> = {
  claro: ":root {",
  oscuro: '[data-tema="oscuro"] {',
};

/** Las variables CSS que define el texto de `tema.css` para un tema, con su valor tal cual. */
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
