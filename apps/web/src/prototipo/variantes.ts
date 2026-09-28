/**
 * PROTOTIPO (logo, 28/09/2026): tres versiones mejoradas de la marca vigente (B) en la misma
 * pantalla, para compararlas en el móvil. Se eligen con `?logo=B1|B2|B3`; `?logo=B` es la vigente
 * con la barra del prototipo a la vista.
 *
 * Sin el parámetro, la web lleva la marca vigente y no sale la barra. Cuando se elija, la
 * elegida pasa a ser la vigente y esto se borra.
 */
import { MARCA_VIGENTE, type VarianteMarca, VARIANTES_MARCA } from "@celda/ui/marca/geometria.ts";

const LOGO = "logo";

const leer = (busqueda: URLSearchParams): VarianteMarca | undefined => {
  const valor = busqueda.get(LOGO)?.trim().toUpperCase();
  return VARIANTES_MARCA.find((variante) => variante === valor);
};

/** Si la URL pide una versión del logo, aunque sea la vigente: entonces se ve la barra. */
export const hayPrototipo = (busqueda: URLSearchParams): boolean => leer(busqueda) !== undefined;

export const logoDe = (busqueda: URLSearchParams): VarianteMarca => leer(busqueda) ?? MARCA_VIGENTE;

/** `medir` y `ajustes` van sin `=`, como los escribe `rutas.ts`. */
const sinIgualesVacios = (parametros: URLSearchParams): string =>
  parametros.toString().replace(/(^|&)(medir|ajustes)=(?=&|$)/gu, "$1$2");

/** La dirección con otra versión del logo; el resto de la URL no cambia. */
export const conLogo = (
  ubicacion: { readonly pathname: string; readonly search: URLSearchParams },
  logo: VarianteMarca,
): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  parametros.set(LOGO, logo);
  return `${ubicacion.pathname}?${sinIgualesVacios(parametros)}`;
};

/**
 * Las direcciones de la app se escriben sin el logo (`ruta`). Para que no se pierda al abrir una
 * ficha o un diálogo, `navegar` lo copia de la dirección actual a la nueva, salvo si la nueva ya
 * lo dice.
 */
export const conservarVariantes = (actual: URLSearchParams, href: string): string => {
  const valor = actual.get(LOGO);
  const destino = new URL(href, "http://celda.invalid");
  if (valor === null || destino.searchParams.has(LOGO)) return href;
  destino.searchParams.set(LOGO, valor);
  return `${destino.pathname}?${sinIgualesVacios(destino.searchParams)}${destino.hash}`;
};
