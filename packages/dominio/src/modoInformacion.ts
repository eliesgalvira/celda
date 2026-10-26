import * as Schema from "effect/Schema";

/**
 * Códigos que abren el modo de información de cada marca y sistema. De dónde sale cada uno y
 * qué dice cada fuente está en docs/investigacion/modo-de-informacion.md.
 */

/** Marcas de móviles Android con un código conocido para abrir el modo de información. */
export const MarcaAndroid = Schema.Literals([
  "samsung",
  "xiaomi",
  "google",
  "motorola",
  "oppo",
  "realme",
  "oneplus",
  "huawei",
  "honor",
  "vivo",
  "sony",
  "nokia",
]);
export type MarcaAndroid = typeof MarcaAndroid.Type;

/** Cómo se escribe cada marca en los textos. */
export const NOMBRE_MARCA: Readonly<Record<MarcaAndroid, string>> = {
  samsung: "Samsung",
  xiaomi: "Xiaomi, Redmi o POCO",
  google: "Google Pixel",
  motorola: "Motorola",
  oppo: "OPPO",
  realme: "realme",
  oneplus: "OnePlus",
  huawei: "Huawei",
  honor: "Honor",
  vivo: "vivo",
  sony: "Sony",
  nokia: "Nokia",
};

/**
 * Cuánto fiarse de un código. `fuente-primaria`: sale del código fuente de Android. Ningún
 * fabricante ni Apple publican estos códigos. `fuente-secundaria`: lo recoge un medio conocido
 * que lo ha probado. `sin-verificar`: solo lo recogen guías y foros, o las fuentes se
 * contradicen.
 */
export const Comprobacion = Schema.Literals([
  "fuente-primaria",
  "fuente-secundaria",
  "sin-verificar",
]);
export type Comprobacion = typeof Comprobacion.Type;

/** Un código para abrir el modo de información, con cuánto fiarse de él. */
export const CodigoModoInformacion = Schema.Struct({
  sistema: Schema.Literals(["android", "ios"]),
  codigo: Schema.String,
  /** Cómo se llama la pantalla que abre, tal como sale en el móvil. */
  pantalla: Schema.String,
  /**
   * `solo`: se abre al escribir el último signo. `llamar`: hay que pulsar el botón de llamar.
   * `sin-comprobar`: ninguna fuente lo dice.
   */
  seAbre: Schema.Literals(["solo", "llamar", "sin-comprobar"]),
  /** Qué tocar dentro de esa pantalla para llegar a los números de la señal, si hace falta. */
  despues: Schema.NullOr(Schema.String),
  comprobacion: Comprobacion,
  /** Algo que conviene saber antes de marcarlo, dicho para las personas. */
  nota: Schema.NullOr(Schema.String),
});
export type CodigoModoInformacion = typeof CodigoModoInformacion.Type;

/** El código de Android, del menú de pruebas que trae el sistema. */
const CUATRO_SEIS_TRES_SEIS = {
  sistema: "android",
  codigo: "*#*#4636#*#*",
  pantalla: "Pruebas",
  seAbre: "solo",
  despues: "Toca «Información del teléfono». Si el móvil está en inglés, «Phone information».",
} as const;

/** El código general de Android, para una marca que no está en la tabla. */
export const CODIGO_ANDROID_GENERAL: CodigoModoInformacion = {
  ...CUATRO_SEIS_TRES_SEIS,
  comprobacion: "fuente-primaria",
  nota: "Es el código que trae Android, pero cada fabricante puede quitarlo. Funciona con la app Teléfono que venía con el móvil.",
};

/** El código de cada marca Android. */
export const CODIGOS_POR_MARCA: Readonly<Record<MarcaAndroid, CodigoModoInformacion>> = {
  samsung: {
    sistema: "android",
    codigo: "*#0011#",
    pantalla: "ServiceMode",
    seAbre: "sin-comprobar",
    despues: null,
    comprobacion: "fuente-secundaria",
    nota: "Samsung no deja usar estos códigos mientras está encendido el Bloqueador automático. En algunos móviles bloqueados por una compañía sale un error de conexión.",
  },
  xiaomi: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    nota: "Hay que marcarlo en la app Teléfono de Xiaomi, porque la de Google no lo abre. Las versiones recientes de HyperOS han quitado algunos códigos.",
  },
  google: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Es el código de Android, pero las fuentes no se ponen de acuerdo en si sigue abriéndose en los Pixel recientes.",
  },
  motorola: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    nota: null,
  },
  oppo: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "OPPO ha quitado muchos códigos desde ColorOS 13, y no sabemos si este sigue funcionando.",
  },
  realme: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Funcionaba en realme UI 2.0. De las versiones posteriores no hay nada claro.",
  },
  oneplus: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    nota: "Márcalo en la app Teléfono de OnePlus. Desde OxygenOS 13 algunos códigos han dejado de funcionar.",
  },
  huawei: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Huawei tiene además su propio menú de pruebas, *#*#2846579#*#*, pero ninguna fuente dice que enseñe los números de la señal.",
  },
  honor: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Solo lo recogen guías que no hemos podido consultar.",
  },
  vivo: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    nota: "vivo quita algunos códigos en cada versión del sistema.",
  },
  sony: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Es el código de Android. No hay ninguna fuente sobre los Sony recientes.",
  },
  nokia: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    nota: "Es el código de Android. Solo lo recogen guías que no hemos podido consultar.",
  },
};

/** El código del iPhone. Apple no lo documenta. */
export const CODIGO_IPHONE: CodigoModoInformacion = {
  sistema: "ios",
  codigo: "*3001#12345#*",
  pantalla: "Field Test",
  seAbre: "llamar",
  despues:
    "Los números de la señal salen en «Dashboard». En versiones de iOS anteriores a la 18 están en «All Metrics».",
  comprobacion: "fuente-secundaria",
  nota: "Apple cambia esta pantalla en cada versión de iOS, así que puede verse distinta. Con dos líneas, solo se actualiza bien la que está en uso.",
};
