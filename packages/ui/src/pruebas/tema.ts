import tema from "../tema.css?raw";

export type Tema = "claro" | "oscuro";

const SELECTORES: Readonly<Record<Tema, string>> = {
  claro: ":root {",
  oscuro: '[data-tema="oscuro"] {',
};

/** Las variables CSS que define tema.css para un tema, con su valor tal cual. */
export const tokensDelTema = (cual: Tema): ReadonlyMap<string, string> => {
  const inicio = tema.indexOf(SELECTORES[cual]);
  const cuerpo = tema.slice(inicio, tema.indexOf("\n}", inicio));
  return new Map(
    Array.from(cuerpo.matchAll(/--([\w-]+):\s*([^;]+);/gu), ([, nombre = "", valor = ""]) => [
      nombre,
      valor.replaceAll(/\s+/gu, " ").trim(),
    ]),
  );
};
