import { Boton } from "../Boton.tsx";

/** Un marco con un tejado y el sol: la foto aérea. */
export function IconoFotoAerea() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    >
      <rect x="2" y="3" width="16" height="14" />
      <path d="M2 14l5-5 4 4 2-2 5 5" />
      <circle cx="13.5" cy="7" r="1.6" />
    </svg>
  );
}

/** La planta de un edificio con su puerta. */
function IconoEdificio() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    >
      <path d="M2 5l6-3 6 3v9H2z" />
      <path d="M6 14v-4h4v4" />
    </svg>
  );
}

/** Lo que ha hecho «Ver el edificio» con el emplazamiento de la ficha. */
export type EstadoEdificio =
  | { readonly tipo: "parado" }
  | { readonly tipo: "buscando" }
  /** El edificio está resaltado; `numero` es su portal de OpenStreetMap, si lo tiene. */
  | { readonly tipo: "resaltado"; readonly numero: string | undefined }
  /** El mapa no tiene ningún edificio dibujado que contenga el emplazamiento. */
  | { readonly tipo: "sin-contorno" };

export interface BotonEdificioProps {
  readonly estado: EstadoEdificio;
  readonly alPulsar: () => void;
}

const NOMBRE = "Ver el edificio";

/** Lo que oye quien usa un lector de pantalla al acabar la búsqueda. */
const aviso = (estado: EstadoEdificio): string => {
  switch (estado.tipo) {
    case "resaltado":
      return estado.numero === undefined
        ? "El edificio está resaltado en el mapa."
        : `El edificio está resaltado en el mapa. En OpenStreetMap lleva el número ${estado.numero}.`;
    case "sin-contorno":
      return "El mapa no tiene ningún edificio dibujado en el emplazamiento.";
    default:
      return "";
  }
};

/**
 * «Ver el edificio» en la cabecera de la ficha: acerca el mapa al emplazamiento, enciende la foto
 * aérea y resalta su edificio. En el móvil, con los logos y el estado al lado, dice «Edificio»; el
 * nombre accesible es siempre «Ver el edificio». La etiqueta y el ancho no cambian nunca: mientras
 * busca, el hexágono ocupa el sitio del icono. Lo encontrado se ve en el mapa, con el contorno y el
 * número de portal, y se anuncia al lector de pantalla. Ese número es de OpenStreetMap y no la
 * dirección del registro, que sigue en la ficha.
 */
export function BotonEdificio(props: BotonEdificioProps) {
  return (
    <>
      <Boton
        variante="secundario"
        tamano="compacto"
        cargando={props.estado.tipo === "buscando"}
        icono={<IconoEdificio />}
        aria-label={NOMBRE}
        title="Acerca el mapa al emplazamiento y resalta su edificio sobre la foto aérea"
        onClick={() => props.alPulsar()}
      >
        <span class="md:hidden">Edificio</span>
        <span class="max-md:hidden">{NOMBRE}</span>
      </Boton>
      <output aria-live="polite" class="sr-only">
        {aviso(props.estado)}
      </output>
    </>
  );
}
