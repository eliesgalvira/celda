import type { AportacionCompartible, Cambio } from "@celda/dominio/aportacion";
import type { Coordenada } from "@celda/dominio/area";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { Ficha } from "@celda/dominio/ficha";
import type {
  AportacionConContexto,
  AportacionEnCola,
  VeredictoPropuesto,
} from "@celda/dominio/moderacion";
import * as DateTime from "effect/DateTime";

/**
 * Lo que la herramienta de moderación escribe para leerlo una persona. Con `--json`, las órdenes
 * dan en su lugar los esquemas del dominio; estos textos pueden cambiar sin avisar.
 */

/** Una fecha en UTC, al minuto: `2026-10-03 10:00 UTC`. */
export const fecha = (milisegundos: number): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).slice(0, 16).replace("T", " ")} UTC`;

/** Una coordenada como se pega en un mapa: latitud y longitud, con cinco decimales (1 m). */
export const punto = (coordenada: Coordenada): string =>
  `${coordenada.latitud.toFixed(5)}, ${coordenada.longitud.toFixed(5)}`;

const metros = (valor: number): string => `${Math.round(valor).toLocaleString("es-ES")} m`;

/** Lo que dice un cambio propuesto, en una frase. */
export const textoCambio = (cambio: Cambio): string => {
  switch (cambio.tipo) {
    case "posicion":
      return `la posición está mal: está en ${punto(cambio.posicion)}`;
    case "compania":
      return `${NOMBRE_COMPANIA[cambio.compania]} ${cambio.esta ? "está" : "no está"} en el emplazamiento`;
    case "ya-no-existe":
      return "el emplazamiento ya no existe";
    case "falta":
      return `falta un emplazamiento en ${punto(cambio.posicion)}, con ${cambio.companias.map((c) => NOMBRE_COMPANIA[c]).join(", ")}`;
  }
};

/** Lo que dice una aportación, en una frase. */
export const textoAportacion = (contenido: AportacionCompartible): string => {
  switch (contenido.tipo) {
    case "correccion-propuesta":
      return `Corrección propuesta: ${textoCambio(contenido.cambio)}`;
    case "corroboracion":
      return `Corroboración de la corrección ${contenido.correccion}`;
  }
};

/** La ficha publicada: el registro oficial de cada compañía y lo que ya se ha aceptado. */
const textoPublicado = (ficha: Ficha, version: string | null): ReadonlyArray<string> => [
  `  Publicado${version === null ? "" : ` (${version})`}: ${ficha.clave}, ${ficha.direccion}, en ${punto(ficha.posicion)} · ${ficha.estado}`,
  ...ficha.estaciones.map((estacion) => {
    const registro = estacion.origenes.find(
      (o) => o.fuente === "registro-oficial" && o.afirma === "presente",
    );
    return (
      `    ${NOMBRE_COMPANIA[estacion.compania]} (${estacion.codigos.join(", ")}): ` +
      (registro === undefined
        ? "no está en el registro oficial"
        : `registro oficial desde ${fecha(registro.fecha)} · ${registro.url}`)
    );
  }),
  ...(ficha.correcciones ?? []).map(
    (c) =>
      `    Corrección ya publicada ${c.clave}: ${textoCambio(c.cambio)} · ${c.personas} ${c.personas === 1 ? "persona" : "personas"}`,
  ),
];

const textoRelacionada = (a: AportacionEnCola): string =>
  `    ${a.estado} · ${textoAportacion(a.contenido)} · ${a.id} · identidad ${a.identidad} · ${fecha(a.recibidaEl)}`;

/** Una aportación con su contexto, en unas líneas. */
export const textoContexto = (c: AportacionConContexto, orden: string): string => {
  const { aportacion } = c;
  const { contenido } = aportacion;
  const nota =
    contenido.tipo === "correccion-propuesta" && contenido.nota !== null
      ? [`  Nota: «${contenido.nota}»`]
      : [];
  const publicado =
    c.publicado !== null
      ? textoPublicado(c.publicado, c.version)
      : c.emplazamiento === null
        ? []
        : [
            `  Publicado: ${c.emplazamiento} no está en lo publicado${c.version === null ? "" : ` (${c.version})`}`,
          ];
  const distancia =
    c.distanciaM === null
      ? []
      : [
          c.emplazamiento === null
            ? `  Distancia al publicado más cercano: ${metros(c.distanciaM)}`
            : `  Distancia de la posición publicada al punto propuesto: ${metros(c.distanciaM)}`,
        ];
  const cercanos =
    c.emplazamiento === null
      ? c.cercanos.length === 0
        ? ["  Cerca: ningún emplazamiento publicado"]
        : [
            "  Cerca:",
            ...c.cercanos.map(
              (e) =>
                `    ${e.clave} a ${metros(e.metros)}, con ${e.companias.map((x) => NOMBRE_COMPANIA[x]).join(", ")}`,
            ),
          ]
      : [];
  const { historial } = c;
  const relacionadas =
    c.relacionadas.length === 0
      ? ["  Nadie más ha enviado nada sobre este emplazamiento"]
      : [
          `  Sobre el mismo emplazamiento (${c.relacionadas.length}):`,
          ...c.relacionadas.map(textoRelacionada),
        ];
  return [
    `── ${orden} · ${aportacion.id} · ${aportacion.estado} · recibida ${fecha(aportacion.recibidaEl)}${aportacion.vetada ? " · VETADA" : ""}`,
    `  ${textoAportacion(contenido)}`,
    ...nota,
    ...publicado,
    ...distancia,
    ...cercanos,
    `  Quién: identidad ${aportacion.identidad}` +
      ` · huella IP ${aportacion.huellaIp ?? "ya borrada"}` +
      ` · ${historial.aceptadas} aceptadas, ${historial.rechazadas} rechazadas y ${historial.pendientes} pendientes más`,
    ...relacionadas,
    ...(aportacion.motivo === null ? [] : [`  Motivo: ${aportacion.motivo}`]),
  ].join("\n");
};

/** Un veredicto propuesto, con sus razones y la orden que lo confirmaría. */
export const textoVeredicto = (veredicto: VeredictoPropuesto): string =>
  [
    `  Veredicto propuesto: ${veredicto.veredicto}`,
    ...veredicto.razones.map((razon) => `    - ${razon}`),
    veredicto.veredicto === "mirar"
      ? "    (Míralo antes de decidir: no hay orden propuesta.)"
      : `    Para confirmarlo: pnpm -s moderar ${veredicto.veredicto} ${veredicto.id} --motivo "…"`,
  ].join("\n");
