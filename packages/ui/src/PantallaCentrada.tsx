import type { JSX } from "@solidjs/web";

/** Una pantalla sin mapa con un único contenido en el centro, como una página que no existe. */
export function PantallaCentrada(props: { readonly children: JSX.Element }) {
  return (
    <main class="fixed inset-0 grid place-items-center bg-fondo p-4 font-texto text-tinta">
      {props.children}
    </main>
  );
}
