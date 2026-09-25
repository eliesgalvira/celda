/**
 * Reglas de un `robots.txt` que afectan a un agente (RFC 9309, sin comodines): los `Allow` y
 * `Disallow` de su grupo, o los del grupo `*` si no tiene uno propio.
 */
export interface Robots {
  readonly permitidas: ReadonlyArray<string>;
  readonly prohibidas: ReadonlyArray<string>;
}

/** Sin `robots.txt` (un 404) no hay nada prohibido. */
export const SIN_RESTRICCIONES: Robots = { permitidas: [], prohibidas: [] };

interface Grupo {
  readonly agentes: Array<string>;
  readonly permitidas: Array<string>;
  readonly prohibidas: Array<string>;
}

const leerGrupos = (texto: string): ReadonlyArray<Grupo> => {
  const grupos: Array<Grupo> = [];
  let actual: Grupo | undefined;
  let leyendoAgentes = false;
  for (const linea of texto.split(/\r?\n/u)) {
    const [campo = "", ...resto] = (linea.split("#")[0] ?? "").split(":");
    const nombre = campo.trim().toLowerCase();
    const valor = resto.join(":").trim();
    if (nombre === "user-agent") {
      if (actual === undefined || !leyendoAgentes) {
        actual = { agentes: [], permitidas: [], prohibidas: [] };
        grupos.push(actual);
      }
      actual.agentes.push(valor.toLowerCase());
      leyendoAgentes = true;
    } else if (actual !== undefined && (nombre === "allow" || nombre === "disallow")) {
      leyendoAgentes = false;
      if (valor !== "") {
        (nombre === "allow" ? actual.permitidas : actual.prohibidas).push(valor);
      }
    }
  }
  return grupos;
};

/** Las reglas que se aplican a `agente`, el primer producto del `User-Agent`. */
export const leerRobots = (texto: string, agente: string): Robots => {
  const grupos = leerGrupos(texto);
  const nombre = agente.toLowerCase();
  const propio = grupos.filter((g) => g.agentes.some((a) => a !== "*" && nombre.startsWith(a)));
  const elegidos = propio.length > 0 ? propio : grupos.filter((g) => g.agentes.includes("*"));
  return {
    permitidas: elegidos.flatMap((g) => g.permitidas),
    prohibidas: elegidos.flatMap((g) => g.prohibidas),
  };
};

/** Si se puede pedir `ruta` (camino y consulta). Gana la regla más larga; si empatan, `Allow`. */
export const permitido = (robots: Robots, ruta: string): boolean => {
  const larga = (reglas: ReadonlyArray<string>) =>
    Math.max(-1, ...reglas.filter((r) => ruta.startsWith(r)).map((r) => r.length));
  return larga(robots.permitidas) >= larga(robots.prohibidas);
};
