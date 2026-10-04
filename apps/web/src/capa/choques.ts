import type { Coordenada } from "@celda/dominio/area";
import { habitantesDeProvincia } from "@celda/dominio/centroVisual";
import type { Hueco } from "@celda/ui/mapa/huecos.ts";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import {
  type CajaDeZona,
  cajaDeZona,
  type FormaDeZona,
} from "@celda/ui/marcadores/MarcadorZona.tsx";
import { ESCALA_DE_TAMANO, type TamanoDeMarcador } from "@celda/ui/marcadores/tamano.ts";

import type {
  Elemento,
  ElementoBarrio,
  ElementoMunicipio,
  ElementoProvincia,
} from "./agrupacion.ts";

/**
 * Qué se dibuja cuando los rótulos de ciudad y los marcadores de Celda se pisan (ADR 0024). Los
 * rótulos van encima de los datos, así que un hexágono que cae bajo el nombre de una ciudad más
 * poblada no se dibuja, y sale al acercar. Se decide al pararse el mapa o al cambiar de nivel,
 * nunca en cada fotograma: es una función pura de lo que se ve.
 */

/**
 * El tamaño de los hexágonos de cada nivel: a 0,62 por debajo del 9, a 0,8 en el 9 y el 10, a 0,88
 * en el 11 y el 12 y enteros desde el 13.
 */
export const tamanoDeNivel = (nivel: number): TamanoDeMarcador =>
  nivel < 9 ? "lejos" : nivel < 11 ? "medio" : nivel < 13 ? "cerca" : "normal";

/** Un rótulo de ciudad que MapLibre ha colocado, con lo que hace falta para saber dónde cae. */
export interface RotuloEnElMapa {
  /** Única entre los rótulos de una lectura: la capa y el texto. */
  readonly clave: string;
  readonly texto: string;
  readonly posicion: Coordenada;
  /** El tamaño de su letra, en píxeles. */
  readonly tamano: number;
  /** Los del municipio que nombra; 0 si no casa con ninguno, como uno de fuera de España. */
  readonly habitantes: number;
}

/** Lo que se decide: la forma de cada zona y lo que no se dibuja. */
export interface Choques {
  /** Completa, con su nombre, o compacta. Todas las zonas de la escena están aquí. */
  readonly formas: ReadonlyMap<string, FormaDeZona>;
  /**
   * Las claves de lo que cede su sitio y no se dibuja: zonas y, con un filtro, logos y
   * agrupaciones de la red que usan sus compañías (ADR 0026).
   */
  readonly ocultos: ReadonlySet<string>;
  /** Las claves de los rótulos que ceden su sitio. */
  readonly rotulosOcultos: ReadonlySet<string>;
}

/** Una caja en la pantalla, en píxeles. */
export interface Caja {
  readonly izquierda: number;
  readonly arriba: number;
  readonly derecha: number;
  readonly abajo: number;
}

/**
 * Lo que una cinta puede rozar sin que cuente como choque. Las cajas son rectángulos alrededor de
 * hexágonos de punta y de un texto de ancho estimado, así que se pasan unos píxeles: sin holgura,
 * la cinta de Madrid rozaba la caja de Toledo por 1 px a z5,5 y Madrid se quedaba sin nombre. Con
 * 3 px no pasa un solape que se vea: Valladolid pisaba Segovia por 10 (prototipo e0b75de).
 */
export const HOLGURA_DE_CINTA = 3;

/** Lo que ocupa un logo, que no encoge: el botón de 44 px. */
const MEDIO_LOGO = 22;

/** Lo que ocupa de media una letra de un rótulo en Noto Sans, por su tamaño, y el halo. */
const LETRA_DE_ROTULO = 0.56;
const HALO_DE_ROTULO = 4;
/** El alto de una línea de rótulo, por su tamaño. */
const LINEA_DE_ROTULO = 1.15;

const cajaEn = (punto: Salto, relativa: CajaDeZona): Caja => ({
  izquierda: punto.x + relativa.izquierda,
  arriba: punto.y + relativa.arriba,
  derecha: punto.x + relativa.derecha,
  abajo: punto.y + relativa.abajo,
});

/** Si dos cajas se pisan en más de `holgura` píxeles. */
export const sePisan = (a: Caja, b: Caja, holgura = 0): boolean =>
  a.izquierda < b.derecha - holgura &&
  b.izquierda < a.derecha - holgura &&
  a.arriba < b.abajo - holgura &&
  b.arriba < a.abajo - holgura;

/** Lo que ocupa un rótulo de ciudad centrado en `punto`: una estimación de su texto y su halo. */
export const cajaDeRotulo = (rotulo: RotuloEnElMapa, punto: Salto): Caja => {
  const ancho = rotulo.texto.length * rotulo.tamano * LETRA_DE_ROTULO + HALO_DE_ROTULO;
  const alto = rotulo.tamano * LINEA_DE_ROTULO;
  return {
    izquierda: punto.x - ancho / 2,
    arriba: punto.y - alto / 2,
    derecha: punto.x + ancho / 2,
    abajo: punto.y + alto / 2,
  };
};

/** Una zona: un barrio, un municipio o una provincia. */
type Zona = ElementoBarrio | ElementoMunicipio | ElementoProvincia;

const nombreDe = (zona: Zona): string =>
  zona.tipo === "barrio"
    ? zona.resumen.barrio.nombre
    : zona.tipo === "municipio"
      ? zona.resumen.municipio.nombre
      : zona.provincia.nombre;

/** Una provincia que no está cubierta entera o cuya capa está en camino lleva una línea más. */
const conEstado = (zona: Zona): boolean =>
  zona.tipo === "provincia" && (!zona.provincia.cubierta || zona.carga !== "resumen");

/** Los habitantes con que compite una zona: los del padrón de la provincia o del municipio. */
const habitantesDe = (zona: ElementoMunicipio | ElementoProvincia): number =>
  zona.tipo === "provincia"
    ? habitantesDeProvincia(zona.provincia.codigo)
    : (zona.resumen.municipio.habitantes ?? 0);

/**
 * Lo que ocupa cada marcador de la escena tal como se dibuja con `tamano`, para los huecos del
 * mapa base y los choques: un logo, el hexágono de una agrupación o de una zona compacta, o el
 * hexágono con la cinta de una zona completa.
 */
export const cajaDeMarcador = (
  elemento: Elemento,
  forma: FormaDeZona,
  tamano: TamanoDeMarcador,
): CajaDeZona => {
  if (elemento.tipo === "emplazamiento") {
    return { izquierda: -MEDIO_LOGO, arriba: -MEDIO_LOGO, derecha: MEDIO_LOGO, abajo: MEDIO_LOGO };
  }
  if (elemento.tipo === "agrupacion") return cajaDeZona("compacta", "", false, tamano);
  return cajaDeZona(forma, nombreDe(elemento), conEstado(elemento), tamano);
};

/** Lo que se ha colocado: su caja y, si es un rótulo, su clave y sus habitantes. */
interface Puesto {
  readonly caja: Caja;
  readonly rotulo?: { readonly clave: string; readonly habitantes: number };
}

/** Un candidato del segundo paso: un hexágono de zona o un rótulo, con sus habitantes. */
type Candidato =
  | {
      readonly tipo: "zona";
      readonly zona: ElementoMunicipio | ElementoProvincia;
      readonly habitantes: number;
    }
  | { readonly tipo: "rotulo"; readonly rotulo: RotuloEnElMapa; readonly habitantes: number };

const claveDe = (candidato: Candidato): string =>
  candidato.tipo === "zona" ? candidato.zona.clave : candidato.rotulo.clave;

/** De más a menos habitantes; a igualdad, la zona antes que el rótulo, y por clave. */
const porHabitantes = (a: Candidato, b: Candidato): number =>
  b.habitantes - a.habitantes ||
  (a.tipo === b.tipo ? 0 : a.tipo === "zona" ? -1 : 1) ||
  (claveDe(a) < claveDe(b) ? -1 : 1);

/** Los barrios, de más a menos emplazamientos y por código, para que no bailen. */
const porEmplazamientos = (a: ElementoBarrio, b: ElementoBarrio): number =>
  b.resumen.emplazamientos - a.resumen.emplazamientos ||
  (a.resumen.barrio.codigo < b.resumen.barrio.codigo ? -1 : 1);

export interface EntradaDeChoques {
  readonly elementos: ReadonlyArray<Elemento>;
  readonly rotulos: ReadonlyArray<RotuloEnElMapa>;
  readonly proyectar: (posicion: Coordenada) => Salto;
  /** El tamaño de los hexágonos en el nivel de la escena (`tamanoDeNivel`). */
  readonly tamano: TamanoDeMarcador;
  /**
   * Lo que mide la pantalla. Un rótulo que no cabe entero en ella no se dibuja: cortado se leería
   * mal («Las Palmas de Gran Canar»). Sin ella, no se mira.
   */
  readonly pantalla?: { readonly ancho: number; readonly alto: number };
  /** La clave del emplazamiento seleccionado: no cede nunca, aunque sea de la red usada. */
  readonly seleccionada?: string | null;
}

/**
 * La regla de choques, en tres pasos. Nada se aparta de su sitio para hacer hueco.
 *
 * 1. Los logos, las agrupaciones y los hexágonos de los barrios se colocan primero y no ceden
 *    nunca: esconderlos escondería emplazamientos que no están en ningún otro sitio.
 * 2. Los hexágonos de las zonas (provincias y municipios) y los rótulos de ciudad, de más a menos
 *    habitantes del padrón: el de la provincia, el del municipio o el de la ciudad del rótulo. A
 *    igualdad, la zona antes. Lo que pisa algo ya colocado no se dibuja, y sale al acercar.
 * 3. Las cintas con el nombre de las zonas, en el mismo orden, y después las de los barrios, que
 *    no tienen habitantes. Una cinta gana a los rótulos con menos habitantes que su zona, que se
 *    esconden, y cede ante todo lo demás: nunca esconde un hexágono. Si cede, la zona va compacta.
 *    Su caja es la que se dibuja, a 0,85, y puede rozar lo demás `HOLGURA_DE_CINTA` píxeles.
 *
 * 4. Con un filtro de compañías, los logos y las agrupaciones de la red que usan (ADR 0026), que
 *    van aparte y ceden ante todo lo demás: lo que pisa algo ya colocado no se dibuja.
 *
 * El rótulo de una capital no se esconde por llamarse como su provincia: compite como cualquier
 * otro, y la cinta en versalitas y el rótulo en caja normal se distinguen (ADR 0024).
 */
export const resolverChoques = (entrada: EntradaDeChoques): Choques => {
  const { proyectar, tamano, pantalla } = entrada;
  const formas = new Map<string, FormaDeZona>();
  const ocultos = new Set<string>();
  const rotulosOcultos = new Set<string>();
  let puestos: Array<Puesto> = [];
  const pisa = (caja: Caja, holgura = 0) => puestos.filter((p) => sePisan(caja, p.caja, holgura));

  // 1. Lo que no cede nunca.
  const candidatos: Array<Candidato> = [];
  const barrios: Array<readonly [ElementoBarrio, Puesto]> = [];
  const deLaRed = entrada.elementos.filter((e) => vaAparte(e, entrada.seleccionada));
  for (const elemento of entrada.elementos) {
    if (vaAparte(elemento, entrada.seleccionada)) continue;
    if (elemento.tipo === "municipio" || elemento.tipo === "provincia") {
      candidatos.push({ tipo: "zona", zona: elemento, habitantes: habitantesDe(elemento) });
      continue;
    }
    const caja = cajaEn(proyectar(elemento.posicion), cajaDeMarcador(elemento, "compacta", tamano));
    const puesto = { caja };
    puestos.push(puesto);
    if (elemento.tipo === "barrio") barrios.push([elemento, puesto]);
  }
  for (const rotulo of entrada.rotulos) {
    const caja = cajaDeRotulo(rotulo, proyectar(rotulo.posicion));
    if (cabeEn(caja, pantalla))
      candidatos.push({ tipo: "rotulo", rotulo, habitantes: rotulo.habitantes });
    else rotulosOcultos.add(rotulo.clave);
  }

  // 2. Hexágonos de zona y rótulos, de más a menos habitantes.
  const colocadas: Array<readonly [ElementoMunicipio | ElementoProvincia, number, Puesto]> = [];
  for (const candidato of candidatos.toSorted(porHabitantes)) {
    if (candidato.tipo === "zona") {
      const { zona } = candidato;
      formas.set(zona.clave, "compacta");
      const caja = cajaEn(proyectar(zona.posicion), cajaDeMarcador(zona, "compacta", tamano));
      if (pisa(caja).length > 0) {
        ocultos.add(zona.clave);
        continue;
      }
      const suyo = { caja };
      puestos.push(suyo);
      colocadas.push([zona, candidato.habitantes, suyo]);
      continue;
    }
    const { rotulo } = candidato;
    const caja = cajaDeRotulo(rotulo, proyectar(rotulo.posicion));
    if (pisa(caja).length > 0) rotulosOcultos.add(rotulo.clave);
    else puestos.push({ caja, rotulo: { clave: rotulo.clave, habitantes: rotulo.habitantes } });
  }

  // 3. Las cintas: ganan a los rótulos con menos habitantes, nunca a un hexágono.
  const conCinta: ReadonlyArray<readonly [Zona, number, Puesto]> = [
    ...colocadas,
    ...barrios
      .toSorted(([a], [b]) => porEmplazamientos(a, b))
      .map(([barrio, suyo]) => [barrio, 0, suyo] as const),
  ];
  for (const [zona, habitantes, suyo] of conCinta) {
    formas.set(zona.clave, "compacta");
    const completa = cajaEn(proyectar(zona.posicion), cajaDeMarcador(zona, "completa", tamano));
    const otros = pisa(completa, HOLGURA_DE_CINTA).filter((p) => p !== suyo);
    if (otros.some((p) => p.rotulo === undefined || p.rotulo.habitantes >= habitantes)) continue;
    for (const p of otros) if (p.rotulo !== undefined) rotulosOcultos.add(p.rotulo.clave);
    // La cinta con su hexágono: ya no cede ante nada de lo que viene detrás.
    puestos = [...puestos.filter((p) => p !== suyo && !otros.includes(p)), { caja: completa }];
    formas.set(zona.clave, "completa");
  }

  // 4. La red usada, aparte: cede ante todo lo demás.
  for (const elemento of deLaRed) {
    const caja = cajaEn(proyectar(elemento.posicion), cajaDeMarcador(elemento, "compacta", tamano));
    if (pisa(caja).length > 0) ocultos.add(elemento.clave);
    else puestos.push({ caja });
  }
  return { formas, ocultos, rotulosOcultos };
};

/**
 * Un logo o una agrupación de la red que usa una compañía del filtro (ADR 0026), que se coloca
 * aparte y cede. El emplazamiento seleccionado no cede nunca.
 */
const vaAparte = (elemento: Elemento, seleccionada: string | null | undefined): boolean =>
  elemento.tipo === "emplazamiento"
    ? elemento.redUsada === true && elemento.emplazamiento.clave !== seleccionada
    : elemento.tipo === "agrupacion" && elemento.redUsada === true;

/** Si una caja cabe entera en la pantalla. Sin pantalla, no se mira. */
const cabeEn = (
  caja: Caja,
  pantalla: { readonly ancho: number; readonly alto: number } | undefined,
): boolean =>
  pantalla === undefined ||
  (caja.izquierda >= 0 &&
    caja.arriba >= 0 &&
    caja.derecha <= pantalla.ancho &&
    caja.abajo <= pantalla.alto);

/** Lo que mide medio hexágono de alto a su tamaño: los huecos empiezan en lo alto del hexágono. */
const MEDIO_HEXAGONO = 28;

/**
 * Los huecos que deja cada marcador que se dibuja en el mapa base, para que sus rótulos lo
 * esquiven (ADR 0024): su caja tal como se dibuja, desde lo alto del hexágono. Las zonas que ceden
 * su sitio no dejan hueco.
 */
export const huecosDe = (
  elementos: ReadonlyArray<Elemento>,
  choques: Choques,
  tamano: TamanoDeMarcador,
): ReadonlyArray<Hueco> =>
  elementos.flatMap((elemento) => {
    if (choques.ocultos.has(elemento.clave)) return [];
    const caja = cajaDeMarcador(elemento, choques.formas.get(elemento.clave) ?? "compacta", tamano);
    const escala = elemento.tipo === "emplazamiento" ? 1 : ESCALA_DE_TAMANO[tamano];
    return [
      {
        longitud: elemento.posicion.longitud,
        latitud: elemento.posicion.latitud,
        ancho: 2 * Math.max(-caja.izquierda, caja.derecha),
        alto: caja.abajo + MEDIO_HEXAGONO * escala,
        escala,
      },
    ];
  });
