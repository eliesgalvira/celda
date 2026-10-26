/**
 * La página que ve quien abre la API de Celda en el navegador, sin parámetros (ADR 0032): qué es,
 * cómo usarla con un agente de IA, qué devuelve, qué se puede pedir, qué no dicen los datos, sus
 * límites y qué hay que citar. La API contesta en JSON a todo lo demás.
 *
 * La función de Vercel escribe el HTML (`paginaDeLaApi`) pero no puede leer `tema.css`. La hoja de
 * estilo sale de los tokens del tema en la build, con los iconos (`estiloDeLaPagina`, que escribe
 * `iconosDeCelda` en `/iconos/api.css`), y el logo es el favicon, que sale de la geometría de la
 * marca.
 *
 * Importa el dominio por ruta relativa, como la API (ver `apps/web/src/api/consulta.ts`).
 */
import { Compania } from "../../../dominio/src/compania.ts";
import { CREDITO_DEL_REGISTRO_OFICIAL } from "../../../dominio/src/licencias.ts";
import { COMPARTIR, SITIO } from "../marca/alCompartir.ts";
import { CARPETA_ICONOS, ICONOS } from "../marca/geometria.ts";
import { CONSULTA_DE_EJEMPLO, RESPUESTA_DE_EJEMPLO } from "./ejemplo.ts";
import { leerTokens } from "../tokens.ts";

/** La hoja de estilo de la página, que sirve la web junto a los iconos. */
export const HOJA_DE_LA_PAGINA = "api.css";

/** Las variables de `tema.css` que usa la página. Las fuentes solo están en el tema claro. */
const TOKENS = [
  "superficie",
  "superficie-alta",
  "tinta",
  "tinta-suave",
  "primario",
  "primario-texto",
  "primario-fg",
  "linea",
  "superficie-explicacion",
  "tinta-explicacion",
] as const;
const FUENTES = ["fuente-texto", "fuente-titulo", "fuente-mono"] as const;

const variables = (tokens: ReadonlyMap<string, string>, nombres: ReadonlyArray<string>): string =>
  nombres
    .map((nombre) => {
      const valor = tokens.get(nombre);
      if (valor === undefined) throw new Error(`Falta el token --${nombre} en tema.css`);
      return `--${nombre}: ${valor};`;
    })
    .join(" ");

/** La hoja de estilo de la página, con los valores de `tema.css` en los dos temas. */
export const estiloDeLaPagina = (
  css: string,
): string => `:root { ${variables(leerTokens(css, "claro"), [...TOKENS, ...FUENTES])} color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { ${variables(leerTokens(css, "oscuro"), TOKENS)} } }
body { margin: 0; background: var(--superficie); color: var(--tinta); font: 16px/1.55 var(--fuente-texto); }
.contenido { max-width: 680px; margin: 0 auto; padding: 28px 24px 24px; }
.cabecera { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
.cabecera img { width: 34px; height: 34px; }
.cabecera .nombre { font: 600 20px var(--fuente-titulo); letter-spacing: 0.12em; }
.cabecera .api { font: 600 12px var(--fuente-mono); color: var(--primario-texto); border: 1px solid var(--primario); border-radius: 4px; padding: 1px 6px; }
h1 { font: 600 34px/1.15 var(--fuente-titulo); margin: 0 0 12px; }
h2 { font: 600 22px/1.25 var(--fuente-titulo); margin: 34px 0 10px; }
p { margin: 0 0 12px; }
.suave { color: var(--tinta-suave); }
a { color: var(--primario-texto); text-underline-offset: 2px; }
.encargo { background: var(--superficie-alta); border: 1px solid var(--linea); border-left: 4px solid var(--primario); border-radius: 6px; padding: 14px 16px; margin: 0 0 12px; }
.encargo p { margin: 0 0 10px; }
.encargo button { font: 600 14px var(--fuente-texto); background: var(--primario); color: var(--primario-fg); border: 0; border-radius: 5px; padding: 6px 14px; cursor: pointer; }
.encargo output { margin-left: 10px; font-size: 14px; color: var(--tinta-suave); }
pre { background: var(--superficie-explicacion); color: var(--tinta-explicacion); font: 13px/1.5 var(--fuente-mono); padding: 14px 16px; border-radius: 6px; overflow-x: auto; margin: 0 0 12px; white-space: pre; }
.url { word-break: break-all; white-space: pre-wrap; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--linea); }
th { font-weight: 600; }
td code, p code, li code { font: 13.5px var(--fuente-mono); background: var(--superficie-alta); border: 1px solid var(--linea); border-radius: 4px; padding: 0 4px; }
ul { margin: 0 0 12px; padding-left: 20px; }
li { margin-bottom: 6px; }
.pie { margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--linea); display: flex; gap: 18px; flex-wrap: wrap; font-size: 15px; }
@media (max-width: 480px) { .contenido { padding: 22px 16px 18px; } h1 { font-size: 28px; } }
`;

const escapar = (texto: string): string =>
  texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** «a, b, c o d». */
const enumerar = (partes: ReadonlyArray<string>): string =>
  partes.length < 2 ? partes.join("") : `${partes.slice(0, -1).join(", ")} o ${partes.at(-1)}`;

export interface DatosDeLaPagina {
  /** La documentación de la API, que enlaza el pie. */
  readonly documentacion: string;
  /** El repositorio del código. */
  readonly codigo: string;
  readonly radioMaximoKm: number;
  readonly limiteMaximo: number;
  readonly consultasPorMinuto: number;
}

const ENCARGO = `Tengo un router 4G de Orange en la casa del pueblo, en Medinaceli. ¿Hacia dónde oriento la antena? Usa la API de Celda: ${SITIO}/api/emplazamientos`;

const DESCRIPCION =
  "Esta dirección es para programas y agentes de IA. Les devuelve en JSON los emplazamientos de antenas de telefonía móvil más cercanos a un punto de España, con los datos que registra el Ministerio.";

/**
 * El botón «Copiar» copia la pregunta de ejemplo. Sin JavaScript no aparece, y la página se lee
 * igual.
 */
const GUION = `const boton = document.querySelector(".encargo button");
const aviso = document.querySelector(".encargo output");
boton.hidden = false;
boton.addEventListener("click", () => {
  navigator.clipboard.writeText(document.querySelector(".encargo p").textContent).then(
    () => { aviso.textContent = "Copiado"; },
    () => { aviso.textContent = "No se ha podido copiar"; },
  );
  setTimeout(() => { aviso.textContent = ""; }, 2500);
});`;

/** La página entera, en HTML. */
export const paginaDeLaApi = (datos: DatosDeLaPagina): string => {
  const companias = enumerar(Compania.literals.map((compania) => `<code>${compania}</code>`));
  const meta = [
    ["og:type", "website"],
    ["og:site_name", "Celda"],
    ["og:locale", "es_ES"],
    ["og:url", `${SITIO}/api/emplazamientos`],
    ["og:title", "API de Celda"],
    ["og:description", DESCRIPCION],
    ["og:image", `${SITIO}${COMPARTIR.ruta}`],
    ["og:image:width", String(COMPARTIR.ancho)],
    ["og:image:height", String(COMPARTIR.alto)],
  ]
    .map(([propiedad, valor]) => `<meta property="${propiedad}" content="${escapar(valor ?? "")}">`)
    .join("\n");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API de Celda</title>
<meta name="description" content="${escapar(DESCRIPCION)}">
${meta}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${CARPETA_ICONOS}/${ICONOS.svg}" type="image/svg+xml">
<link rel="stylesheet" href="${CARPETA_ICONOS}/${HOJA_DE_LA_PAGINA}">
</head>
<body>
<main class="contenido">
  <div class="cabecera">
    <img src="${CARPETA_ICONOS}/${ICONOS.svg}" alt="">
    <span class="nombre">CELDA</span><span class="api">API</span>
  </div>

  <h1>La API de Celda</h1>
  <p>${DESCRIPCION}</p>
  <p class="suave">¿Buscas el mapa? Está en <a href="${SITIO}/">celda.elies.site</a>.</p>

  <h2>¿Cómo se usa con un agente de IA?</h2>
  <p>Copia algo así en tu agente (Claude, ChatGPT, Gemini…) y cambia el sitio y la compañía:</p>
  <div class="encargo">
    <p>${escapar(ENCARGO)}</p>
    <button type="button" hidden>Copiar</button><output aria-live="polite"></output>
  </div>
  <p>El agente lee la documentación, hace la consulta y te contesta con la dirección y la distancia del emplazamiento de Orange más cercano.</p>

  <h2>¿Qué devuelve una consulta?</h2>
<pre class="url">GET ${escapar(CONSULTA_DE_EJEMPLO)}</pre>
<pre>${escapar(RESPUESTA_DE_EJEMPLO)}</pre>
  <p>Cada emplazamiento lleva su distancia en metros, sus compañías, sus bandas en MHz, su municipio y el enlace a su ficha. La ficha tiene las medidas de exposición que publica el Ministerio.</p>

  <h2>¿Qué se puede pedir?</h2>
  <table>
    <tr><th>Parámetro</th><th>Qué es</th></tr>
    <tr><td><code>lat</code>, <code>lon</code></td><td>El punto desde el que buscar, en grados decimales. Obligatorios.</td></tr>
    <tr><td><code>radio</code></td><td>Hasta dónde buscar, en metros o con su unidad: <code>1500</code>, <code>1500m</code> o <code>15km</code>. Hasta ${datos.radioMaximoKm} km. Si no se pone, 1 km.</td></tr>
    <tr><td><code>compania</code></td><td>${companias}. Varias, separadas por comas.</td></tr>
    <tr><td><code>limite</code></td><td>Cuántos emplazamientos devolver, de 1 a ${datos.limiteMaximo}. Si no se pone, 20.</td></tr>
  </table>

  <h2>¿Qué no dicen estos datos?</h2>
  <ul>
    <li>Tener un emplazamiento cerca no garantiza cobertura. La señal depende de hacia dónde apunten sus antenas, y ninguna fuente lo publica.</li>
    <li>El acimut de una medida de exposición es la dirección desde la estación base hasta el punto donde se midió. No es hacia dónde apunta una antena.</li>
    <li>El Ministerio no dice cuándo hizo cada medida.</li>
  </ul>

  <h2>¿Hay límites?</h2>
  <p>${datos.consultasPorMinuto} consultas por minuto desde cada IP. Es gratis y no hace falta registrarse.</p>

  <h2>¿Qué hay que citar al reutilizar los datos?</h2>
  <p>Los datos del registro llevan este crédito, con la fecha que trae cada respuesta: «${escapar(CREDITO_DEL_REGISTRO_OFICIAL)}». Lo que calcula Celda es de dominio público (CC0) y se puede usar sin citar.</p>

  <div class="pie">
    <a href="${escapar(datos.documentacion)}">Documentación completa</a>
    <a href="${escapar(datos.codigo)}">Código en GitHub (0BSD)</a>
    <a href="${SITIO}/">El mapa</a>
  </div>
</main>
<script>${GUION}</script>
</body>
</html>
`;
};
