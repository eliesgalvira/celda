/** Una indicación breve sobre el mapa, que no tapa los gestos: «acércate para ver…». */
export function Pista(props: { readonly texto: string }) {
  return (
    <output class="cinta animate-aparecer bg-superficie-invertida px-4 py-1 text-center font-mono text-xs leading-5 text-tinta-invertida [--pico:8px]">
      {props.texto}
    </output>
  );
}
