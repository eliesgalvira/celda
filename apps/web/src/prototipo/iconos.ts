import { carpetaDeIconos, ICONOS, type VarianteMarca } from "@celda/ui/marca/geometria.ts";

/**
 * PROTOTIPO (logo): cambia el favicon, el icono de la pantalla de inicio y el manifiesto a los de
 * una variante del logo. Los enlaces los pone en el HTML el plugin de iconos con los de hoy.
 */
export const ponerIconos = (documento: Document, variante: VarianteMarca): void => {
  const carpeta = carpetaDeIconos(variante);
  const cambiar = (selector: string, fichero: string) => {
    const enlace = documento.head.querySelector<HTMLLinkElement>(selector);
    const href = `${carpeta}/${fichero}`;
    if (enlace !== null && enlace.getAttribute("href") !== href) enlace.setAttribute("href", href);
  };
  cambiar('link[rel="icon"][type="image/svg+xml"]', ICONOS.svg);
  cambiar('link[rel="icon"][sizes="32x32"]', ICONOS.png32);
  cambiar('link[rel="apple-touch-icon"]', ICONOS.toque);
  cambiar('link[rel="manifest"]', ICONOS.manifiesto);
};
