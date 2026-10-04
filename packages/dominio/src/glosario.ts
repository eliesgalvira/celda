/**
 * El glosario de la interfaz (historia 53): lo que se lee al tocar un término subrayado. Cada
 * término se explica aquí una sola vez, en lenguaje llano y para quien no sabe nada de redes, con
 * el término técnico al final para quien quiera buscarlo. Las definiciones siguen a `CONTEXT.md`,
 * que manda; este glosario solo las cuenta con otras palabras.
 */

export const TERMINOS = [
  "emplazamiento",
  "estacion-base",
  "compania",
  "sector",
  "sector-que-da-servicio",
  "azimut",
  "celda",
  "cobertura",
  "banda",
  "mhz",
  "tramo",
  "tecnologia",
  "4g",
  "5g",
  "registro-oficial",
  "expediente",
  "correccion",
  "version-de-los-datos",
  "marca-de-agua",
  "modo-de-informacion",
  "identificador-de-celda",
  "modelo",
  "punto-de-referencia",
  "precision",
  "interferencia",
  "ocupacion",
  "sinr",
  "decibelio",
  "radio-de-cobertura",
  "penetracion",
  "cuota-de-lineas",
  "rumbo",
  "router-movil",
  "antena-exterior",
  "barrido",
] as const;

export type Termino = (typeof TERMINOS)[number];

export interface EntradaGlosario {
  /** Cómo se llama en la interfaz, con mayúscula inicial: el título de la explicación. */
  readonly nombre: string;
  /** Qué es, en lenguaje llano: de una a tres frases. */
  readonly explicacion: string;
  /** Cómo lo llaman los libros y las fuentes, para buscarlo. Va al final de la explicación. */
  readonly tecnico: string;
  /** Otros términos que ayudan a entender este. */
  readonly relacionados: ReadonlyArray<Termino>;
}

/** Una entrada por término, ni una más ni una menos. */
export type Glosario = { readonly [T in Termino]: EntradaGlosario };

export const GLOSARIO: Glosario = {
  emplazamiento: {
    nombre: "Emplazamiento",
    explicacion:
      "El sitio donde hay antenas de telefonía, como una azotea, una torre o una farola. " +
      "Varias compañías pueden compartirlo, cada una con sus propios equipos.",
    tecnico: "emplazamiento (en inglés, site)",
    relacionados: ["estacion-base", "compania", "celda"],
  },
  "estacion-base": {
    nombre: "Estación base",
    explicacion:
      "Los equipos que tiene una compañía en un emplazamiento para dar servicio a los móviles " +
      "de alrededor. Si tres compañías comparten una azotea, allí hay tres estaciones base.",
    tecnico: "estación base (eNodeB en 4G, gNodeB en 5G)",
    relacionados: ["emplazamiento", "sector", "banda"],
  },
  compania: {
    nombre: "Compañía",
    explicacion:
      "La empresa de telefonía móvil que emite desde un emplazamiento, como Movistar, " +
      "Vodafone, Orange, Digi o Yoigo. En el mapa se reconoce por su logo.",
    tecnico: "operador de red móvil",
    relacionados: ["emplazamiento", "estacion-base"],
  },
  sector: {
    nombre: "Sector",
    explicacion:
      "Una estación base no emite igual hacia todos lados. Reparte la señal en porciones, " +
      "casi siempre tres de unos 120 grados cada una, y cada porción tiene sus propias antenas.",
    tecnico: "sector",
    relacionados: ["azimut", "estacion-base", "celda"],
  },
  "sector-que-da-servicio": {
    nombre: "Sector que da servicio",
    explicacion:
      "El sector que más señal manda hacia un punto, porque su haz apunta hacia allí. Celda lo " +
      "calcula con un modelo a partir de la dirección, así que depende de hacia dónde se supone " +
      "que apunta cada sector.",
    tecnico: "celda servidora (serving cell)",
    relacionados: ["sector", "azimut", "decibelio"],
  },
  azimut: {
    nombre: "Azimut",
    explicacion:
      "Hacia dónde apunta un sector, en grados, como en una brújula: 0 es el norte, 90 el " +
      "este, 180 el sur y 270 el oeste. Casi nunca se publica, así que suele ser una " +
      "estimación con unos 15 grados de margen.",
    tecnico: "azimut",
    relacionados: ["sector"],
  },
  celda: {
    nombre: "Celda",
    explicacion:
      "La zona del mapa en la que un emplazamiento es el más cercano, y por eso suele ser el " +
      "que da servicio. En los libros de telecomunicaciones la palabra «celda» se usa para " +
      "otra cosa, un sector en una banda.",
    tecnico: "celda de Voronoi",
    relacionados: ["emplazamiento", "sector", "cobertura"],
  },
  cobertura: {
    nombre: "Cobertura",
    explicacion:
      "La zona en la que la señal de una compañía llega con fuerza para usar el móvil. " +
      "Depende de la banda, de la distancia y de los edificios que haya en medio, así que no " +
      "tiene bordes nítidos.",
    tecnico: "área de cobertura",
    relacionados: ["celda", "banda"],
  },
  banda: {
    nombre: "Banda",
    explicacion:
      "La frecuencia en la que emite una compañía, como el número de una emisora de radio. Las " +
      "bandas bajas llegan más lejos y atraviesan mejor las paredes. Las altas dan más " +
      "velocidad, pero llegan menos.",
    tecnico: "banda de frecuencias",
    relacionados: ["mhz", "tramo", "tecnologia"],
  },
  mhz: {
    nombre: "MHz",
    explicacion:
      "La unidad con que se miden las frecuencias. Un megahercio es un millón de ciclos por " +
      "segundo, así que la señal de la banda de 700 MHz oscila 700 millones de veces por " +
      "segundo.",
    tecnico: "megahercio (MHz)",
    relacionados: ["banda"],
  },
  tramo: {
    nombre: "Tramo publicado",
    explicacion:
      "Las frecuencias exactas que un expediente deja usar, de la más baja a la más alta. La " +
      "banda es su nombre corto: el tramo de 778 a 788 MHz está en la banda de 700 MHz.",
    tecnico: "bloque de frecuencias asignado",
    relacionados: ["banda", "expediente", "mhz"],
  },
  tecnologia: {
    nombre: "Tecnología",
    explicacion:
      "La generación de telefonía móvil con la que se emite en una banda: 2G, 3G, 4G o 5G. El " +
      "registro oficial no la publica, así que Celda la deduce de la banda y dice «probable».",
    tecnico: "tecnología de acceso radio",
    relacionados: ["4g", "5g", "banda"],
  },
  "4g": {
    nombre: "4G",
    explicacion:
      "La cuarta generación de telefonía móvil. Es la red que usa el móvil casi todo el " +
      "tiempo, para internet y también para llamar, y se da en casi todas las bandas.",
    tecnico: "LTE",
    relacionados: ["5g", "tecnologia", "banda"],
  },
  "5g": {
    nombre: "5G",
    explicacion:
      "La quinta generación, que da más velocidad y responde antes. En España va sobre todo " +
      "en las bandas de 700 y 3500 MHz, y el móvil solo la usa si es compatible y la tarifa " +
      "la incluye.",
    tecnico: "5G NR (New Radio)",
    relacionados: ["4g", "tecnologia", "banda"],
  },
  "registro-oficial": {
    nombre: "Registro oficial",
    explicacion:
      "La lista de estaciones base que publica el Ministerio con lo que declaran las " +
      "compañías. Es la fuente principal, pero va con retraso. A veces aún tiene antenas " +
      "desmontadas y le faltan otras nuevas.",
    tecnico: "Infoantenas, del Ministerio para la Transformación Digital",
    relacionados: ["expediente", "correccion"],
  },
  expediente: {
    nombre: "Expediente",
    explicacion:
      "El permiso que tramita una compañía para emitir desde un emplazamiento. El registro " +
      "oficial publica uno por cada banda y tecnología, con su número de referencia.",
    tecnico: "expediente de estación radioeléctrica",
    relacionados: ["registro-oficial", "tramo", "banda"],
  },
  correccion: {
    nombre: "Corrección",
    explicacion:
      "Cuando alguien de la comunidad de Celda contradice al registro oficial, por ejemplo " +
      "porque ha visto que una antena ya no está, y la revisión de Celda le da la razón. Celda " +
      "enseña las dos versiones y marca el emplazamiento como corregido.",
    tecnico: "corrección aceptada en la moderación",
    relacionados: ["registro-oficial"],
  },
  "version-de-los-datos": {
    nombre: "Versión de los datos",
    explicacion:
      "La fecha de los datos que se ven. Celda consulta las fuentes cada cierto tiempo y " +
      "publica el mapa entero de una vez, con la fecha de esa consulta.",
    tecnico: "fecha de corte de los datos",
    relacionados: ["marca-de-agua", "registro-oficial"],
  },
  "marca-de-agua": {
    nombre: "Actualizado después del mapa",
    explicacion:
      "La ficha se lee al abrirla y el mapa se publica cada cierto tiempo, así que la ficha " +
      "puede ser más nueva que el mapa. Cuando pasa, la ficha lo indica.",
    tecnico: "fecha de corte de la ficha",
    relacionados: ["version-de-los-datos"],
  },
  "modo-de-informacion": {
    nombre: "Modo de información",
    explicacion:
      "Una pantalla escondida del móvil que se abre marcando un código y enseña a qué red " +
      "está conectado y con cuánta señal. Abrirla no instala ni cambia nada.",
    tecnico: "modo de prueba de campo (field test mode)",
    relacionados: ["identificador-de-celda"],
  },
  "identificador-de-celda": {
    nombre: "Identificador de celda",
    explicacion:
      "El número con que la red distingue cada sector en cada banda. El móvil lo enseña en " +
      "el modo de información, pero el registro oficial no lo publica.",
    tecnico: "Cell ID (ECI en 4G, NCI en 5G)",
    relacionados: ["sector", "modo-de-informacion", "celda"],
  },
  modelo: {
    nombre: "Simulación",
    explicacion:
      "Un cálculo que imita cómo se suele comportar la señal. Celda lo marca como simulación " +
      "para distinguirlo de una medida.",
    tecnico: "modelo",
    relacionados: ["sector", "azimut"],
  },
  "punto-de-referencia": {
    nombre: "Punto de referencia",
    explicacion:
      "El sitio desde el que Celda mide la distancia y la dirección hasta cada emplazamiento. " +
      "Puede ser tu ubicación, la que da el GPS del dispositivo, o un punto que marques a mano " +
      "en el mapa.",
    tecnico: "posición del terminal",
    relacionados: ["precision", "emplazamiento"],
  },
  precision: {
    nombre: "Precisión",
    explicacion:
      "Cuánto se puede equivocar el GPS al decir dónde estás. «±25 m» quiere decir que puedes " +
      "estar en cualquier sitio de un círculo de 25 metros. Dentro de casa suele ser peor.",
    tecnico: "precisión horizontal del GPS",
    relacionados: ["punto-de-referencia"],
  },
  interferencia: {
    nombre: "Interferencia",
    explicacion:
      "La señal de otras antenas que llega a tu móvil y dificulta recibir la que le da " +
      "servicio. Solo interfieren las de la misma compañía en la misma banda.",
    tecnico: "interferencia cocanal (reutilización 1)",
    relacionados: ["sinr", "ocupacion", "banda"],
  },
  ocupacion: {
    nombre: "Ocupación de la red",
    explicacion:
      "Qué parte de la capacidad de la red se está usando. Con mucha gente conectada, las " +
      "antenas vecinas emiten más e interfieren más entre sí, sobre todo en los bordes entre " +
      "celdas.",
    tecnico: "carga de la celda",
    relacionados: ["interferencia", "sinr"],
  },
  sinr: {
    nombre: "Señal frente a interferencia",
    explicacion:
      "Cuánto destaca la señal que da servicio sobre la interferencia y el ruido, en dB. " +
      "Por encima de 20 dB la señal llega limpia, y por debajo de 0 dB la interferencia es " +
      "más fuerte que la señal.",
    tecnico: "SINR (relación señal a interferencia más ruido)",
    relacionados: ["interferencia", "ocupacion", "modelo"],
  },
  decibelio: {
    nombre: "Decibelio",
    explicacion:
      "La unidad con que se compara la señal. Perder 3 dB es quedarse con la mitad y perder " +
      "10 dB, con la décima parte. Por eso unos pocos dB ya se notan.",
    tecnico: "decibelio (dB)",
    relacionados: ["sector-que-da-servicio"],
  },
  "radio-de-cobertura": {
    nombre: "Radio de cobertura",
    explicacion:
      "Hasta dónde llega, más o menos, cada estación base de una compañía. En el ejercicio se " +
      "estima como la mitad de la distancia media a la estación más cercana de la misma " +
      "compañía, porque a partir de ahí lo normal es que dé servicio la otra.",
    tecnico: "radio de celda",
    relacionados: ["estacion-base", "cobertura"],
  },
  penetracion: {
    nombre: "Penetración",
    explicacion:
      "Cuántas líneas de móvil hay por cada 100 habitantes. Pasa de 100 porque hay quien " +
      "tiene dos líneas, o una para el trabajo.",
    tecnico: "penetración de la telefonía móvil",
    relacionados: ["cuota-de-lineas"],
  },
  "cuota-de-lineas": {
    nombre: "Cuota de líneas",
    explicacion:
      "La parte de todas las líneas de móvil que tiene una compañía. Orange y Yoigo son de la " +
      "misma empresa y la estadística oficial da sus líneas juntas.",
    tecnico: "cuota de mercado de líneas móviles",
    relacionados: ["penetracion", "compania"],
  },
  rumbo: {
    nombre: "Rumbo",
    explicacion:
      "Hacia dónde queda el emplazamiento visto desde el punto, en grados, como en una " +
      "brújula: 0 es el norte, 90 el este, 180 el sur y 270 el oeste. Sale de las dos " +
      "posiciones, así que no depende de hacia dónde apunten los sectores.",
    tecnico: "rumbo o demora (bearing)",
    relacionados: ["punto-de-referencia", "azimut"],
  },
  "router-movil": {
    nombre: "Router 4G/5G",
    explicacion:
      "Un aparato con tarjeta SIM que recibe la señal móvil y la reparte por wifi en casa, " +
      "en lugar de la fibra. Recibe mejor junto a una ventana que mire hacia el emplazamiento.",
    tecnico: "router 4G/5G (CPE de interior)",
    relacionados: ["antena-exterior", "decibelio"],
  },
  "antena-exterior": {
    nombre: "Antena exterior",
    explicacion:
      "Una antena que se pone en el balcón o el tejado y se conecta al router 4G/5G. Las " +
      "direccionales captan sobre todo lo que les llega de frente, así que hay que apuntarlas " +
      "al emplazamiento.",
    tecnico: "antena directiva exterior (Yagi o de panel)",
    relacionados: ["router-movil", "rumbo"],
  },
  barrido: {
    nombre: "Barrido",
    explicacion:
      "La última vez que Celda leyó entero el registro oficial de una zona. Aunque no " +
      "cambie nada, dice hasta cuándo se sabe que los datos seguían así.",
    tecnico: "barrido del listado por zonas",
    relacionados: ["registro-oficial", "version-de-los-datos"],
  },
};

/**
 * Un trozo de un texto de la interfaz: texto llano o, si lleva `termino`, una palabra que se
 * subraya y abre su explicación.
 */
export interface Fragmento {
  readonly texto: string;
  readonly termino?: Termino;
}

/** Un texto de la interfaz con sus términos marcados, en orden de lectura. */
export type TextoMarcado = ReadonlyArray<Fragmento>;

/** Un texto sin términos. */
export const llano = (texto: string): TextoMarcado => [{ texto }];

/** Unas palabras que se subrayan y abren la explicación de `termino`. */
export const termino = (cual: Termino, texto: string): TextoMarcado => [{ texto, termino: cual }];

const esMarcado = (valor: string | TextoMarcado): valor is TextoMarcado => Array.isArray(valor);

/**
 * Plantilla para escribir textos con términos:
 * ``marcado`Por sus ${termino("banda", "bandas")}, probablemente da 5G.` ``. Lo que se
 * intercala puede ser texto llano u otro `TextoMarcado`.
 */
export const marcado = (
  partes: TemplateStringsArray,
  ...valores: ReadonlyArray<string | TextoMarcado>
): TextoMarcado =>
  juntar(
    partes.flatMap((parte, i) => {
      const valor = valores[i];
      const intercalado = valor === undefined ? [] : esMarcado(valor) ? valor : llano(valor);
      return [{ texto: parte }, ...intercalado];
    }),
  );

/** Une los trozos llanos seguidos y quita los vacíos. */
export const juntar = (texto: TextoMarcado): TextoMarcado =>
  texto.reduce<Array<Fragmento>>((juntos, fragmento) => {
    const anterior = juntos.at(-1);
    if (fragmento.texto === "") return juntos;
    if (
      fragmento.termino === undefined &&
      anterior !== undefined &&
      anterior.termino === undefined
    ) {
      juntos[juntos.length - 1] = { texto: anterior.texto + fragmento.texto };
    } else {
      juntos.push(fragmento);
    }
    return juntos;
  }, []);

/** El texto tal cual se lee, sin marcas: para nombres accesibles y pruebas. */
export const textoPlano = (texto: TextoMarcado): string => texto.map((f) => f.texto).join("");

/** Los términos marcados en unos textos, en orden de lectura. */
export const terminosDe = (textos: ReadonlyArray<TextoMarcado>): ReadonlyArray<Termino> =>
  textos.flatMap((texto) => texto.flatMap((f) => (f.termino === undefined ? [] : [f.termino])));

/**
 * Un bloque de textos que se leen en orden, como una sección del panel. Cada texto que pasa por
 * él conserva marcados solo los términos que aún no habían salido en el bloque, así que un
 * término se subraya una vez por bloque y no en cada frase.
 */
export const bloque = (): ((texto: TextoMarcado) => TextoMarcado) => {
  const vistos = new Set<Termino>();
  return (texto) =>
    juntar(
      texto.map((fragmento) => {
        if (fragmento.termino === undefined) return fragmento;
        if (vistos.has(fragmento.termino)) return { texto: fragmento.texto };
        vistos.add(fragmento.termino);
        return fragmento;
      }),
    );
};

/** Unos textos leídos en orden como un solo bloque. */
export const primeraVezEn = (textos: ReadonlyArray<TextoMarcado>): ReadonlyArray<TextoMarcado> =>
  textos.map(bloque());

/** `primeraVezEn` para un solo texto. */
export const primeraVez = (texto: TextoMarcado): TextoMarcado => primeraVezEn([texto])[0] ?? [];
