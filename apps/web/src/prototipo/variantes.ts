/**
 * PROTOTIPO (logo y controles, 28/09/2026): tres variantes del logo y tres de los controles del
 * mapa en la misma pantalla, para compararlas en el móvil. Se eligen en la URL:
 *
 * - `?variante=A|B|C` pone las dos a la vez;
 * - `?logo=A|B|C` y `?controles=A|B|C` las cambian por separado, y ganan a `variante`;
 * - `hoy` en cualquiera de los tres es lo de hoy, con la barra a la vista para comparar.
 *
 * Sin ningún parámetro, la web es la de hoy y no sale la barra del prototipo. Cuando se elija,
 * se lleva lo elegido al código de verdad y esto se borra.
 */
import type { DisposicionControles } from "@celda/ui/controles/aspecto.ts";
import type { VarianteMarca } from "@celda/ui/marca/geometria.ts";

export type Variante = "A" | "B" | "C";

export const VARIANTES: ReadonlyArray<Variante> = ["A", "B", "C"];

const VARIANTE = "variante";
const LOGO = "logo";
const CONTROLES = "controles";

const PARAMETROS: ReadonlyArray<string> = [VARIANTE, LOGO, CONTROLES];

/** Lo de hoy, con la barra del prototipo a la vista. */
const HOY = "hoy";

const leer = (busqueda: URLSearchParams, nombre: string): Variante | "actual" | undefined => {
  const valor = busqueda.get(nombre)?.trim().toUpperCase();
  if (valor === HOY.toUpperCase()) return "actual";
  return VARIANTES.find((variante) => variante === valor);
};

/** Si la URL pide alguna variante, aunque sea la de hoy: entonces se ve la barra del prototipo. */
export const hayPrototipo = (busqueda: URLSearchParams): boolean =>
  PARAMETROS.some((nombre) => leer(busqueda, nombre) !== undefined);

export const logoDe = (busqueda: URLSearchParams): VarianteMarca =>
  leer(busqueda, LOGO) ?? leer(busqueda, VARIANTE) ?? "actual";

export const controlesDe = (busqueda: URLSearchParams): DisposicionControles =>
  leer(busqueda, CONTROLES) ?? leer(busqueda, VARIANTE) ?? "actual";

/** La dirección con otras variantes; el resto de la URL no cambia. */
export const conVariantes = (
  ubicacion: { readonly pathname: string; readonly search: URLSearchParams },
  elegidas: { readonly logo: VarianteMarca; readonly controles: DisposicionControles },
): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  parametros.delete(VARIANTE);
  parametros.set(LOGO, elegidas.logo === "actual" ? HOY : elegidas.logo);
  parametros.set(CONTROLES, elegidas.controles === "actual" ? HOY : elegidas.controles);
  return `${ubicacion.pathname}?${sinIgualesVacios(parametros)}`;
};

/** `medir` y `ajustes` van sin `=`, como los escribe `rutas.ts`. */
const sinIgualesVacios = (parametros: URLSearchParams): string =>
  parametros.toString().replace(/(^|&)(medir|ajustes)=(?=&|$)/gu, "$1$2");

/**
 * Las direcciones de la app se escriben sin las variantes (`ruta`). Para que no se pierdan al
 * abrir una ficha o un diálogo, `navegar` copia las de la dirección actual a la nueva.
 */
export const conservarVariantes = (actual: URLSearchParams, href: string): string => {
  const destino = new URL(href, "http://celda.invalid");
  // Si la dirección nueva ya dice qué variantes, manda ella (la barra del prototipo).
  if (PARAMETROS.some((nombre) => destino.searchParams.has(nombre))) return href;
  let cambiada = false;
  for (const nombre of PARAMETROS) {
    const valor = actual.get(nombre);
    if (valor !== null) {
      destino.searchParams.set(nombre, valor);
      cambiada = true;
    }
  }
  if (!cambiada) return href;
  return `${destino.pathname}?${sinIgualesVacios(destino.searchParams)}${destino.hash}`;
};
