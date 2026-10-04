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

/** Una página pública que da el código, con la fecha en que se consultó. */
export const FuenteDelCodigo = Schema.Struct({
  titulo: Schema.String,
  url: Schema.String,
  /** Fecha de consulta, AAAA-MM-DD. */
  consultada: Schema.String,
});
export type FuenteDelCodigo = typeof FuenteDelCodigo.Type;

/** Un código para abrir el modo de información, con de dónde sale. */
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
  fuentes: Schema.Array(FuenteDelCodigo),
  /** Algo que conviene saber antes de marcarlo, dicho para las personas. */
  nota: Schema.NullOr(Schema.String),
});
export type CodigoModoInformacion = typeof CodigoModoInformacion.Type;

const CONSULTA = "2026-09-26";

const fuente = (titulo: string, url: string): FuenteDelCodigo => ({
  titulo,
  url,
  consultada: CONSULTA,
});

const AOSP = [
  fuente(
    "Android (AOSP): Settings, AndroidManifest.xml, código secreto 4636",
    "https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/main/AndroidManifest.xml",
  ),
  fuente(
    "Android (AOSP): RadioInfo.java, la pantalla «Información del teléfono»",
    "https://android.googlesource.com/platform/packages/services/Telephony/+/refs/heads/main/src/com/android/phone/settings/RadioInfo.java",
  ),
  fuente(
    "Android (AOSP): SpecialCharSequenceMgr.java, el teclado abre el código sin llamar",
    "https://android.googlesource.com/platform/packages/apps/Dialer/+/refs/heads/main/java/com/android/dialer/dialpadview/SpecialCharSequenceMgr.java",
  ),
];

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
  fuentes: AOSP,
  nota: "Es el código que trae Android, pero cada fabricante puede quitarlo. Funciona con la app Teléfono que venía con el móvil.",
};

const BEEBOM = (marca: string, ruta: string) =>
  fuente(`Beebom: códigos secretos de ${marca}`, `https://gadgets.beebom.com/guides/${ruta}`);

/** El código de cada marca Android. */
export const CODIGOS_POR_MARCA: Readonly<Record<MarcaAndroid, CodigoModoInformacion>> = {
  samsung: {
    sistema: "android",
    codigo: "*#0011#",
    pantalla: "ServiceMode",
    seAbre: "sin-comprobar",
    despues: null,
    comprobacion: "fuente-secundaria",
    fuentes: [
      fuente(
        "Android Authority: códigos secretos de los Samsung (julio de 2026)",
        "https://www.androidauthority.com/secret-dial-codes-samsung-phones-3684761/",
      ),
      fuente(
        "UberSignal: modo Field Test en Android e iPhone (enero de 2025)",
        "https://www.ubersignal.com/blogs/articles/field-test-mode",
      ),
    ],
    nota: "Samsung no deja usar estos códigos mientras está encendido el Bloqueador automático. En algunos móviles bloqueados por una compañía sale un error de conexión.",
  },
  xiaomi: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    fuentes: [BEEBOM("Xiaomi", "xiaomi-secret-security-codes-list"), ...AOSP],
    nota: "Hay que marcarlo en la app Teléfono de Xiaomi, porque la de Google no lo abre. Las versiones recientes de HyperOS han quitado algunos códigos.",
  },
  google: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: [
      fuente(
        "Android Police: forzar 4G o 5G en Android (diciembre de 2025)",
        "https://www.androidpolice.com/force-phone-lte-5g-tutorial/",
      ),
      fuente(
        "UberSignal: modo Field Test en Android e iPhone (enero de 2025)",
        "https://www.ubersignal.com/blogs/articles/field-test-mode",
      ),
      ...AOSP,
    ],
    nota: "Es el código de Android, pero las fuentes no se ponen de acuerdo en si sigue abriéndose en los Pixel recientes.",
  },
  motorola: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    fuentes: [
      fuente(
        "Android Police: forzar 4G o 5G en Android (diciembre de 2025)",
        "https://www.androidpolice.com/force-phone-lte-5g-tutorial/",
      ),
      ...AOSP,
    ],
    nota: null,
  },
  oppo: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: [BEEBOM("OPPO", "oppo-secret-check-codes"), ...AOSP],
    nota: "OPPO ha quitado muchos códigos desde ColorOS 13, y no sabemos si este sigue funcionando.",
  },
  realme: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: [BEEBOM("realme", "realme-secret-test-codes-list"), ...AOSP],
    nota: "Funcionaba en realme UI 2.0. De las versiones posteriores no hay nada claro.",
  },
  oneplus: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    fuentes: [BEEBOM("OnePlus", "oneplus-secret-codes-list"), ...AOSP],
    nota: "Márcalo en la app Teléfono de OnePlus. Desde OxygenOS 13 algunos códigos han dejado de funcionar.",
  },
  huawei: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: [
      fuente(
        "Huawei: el menú de pruebas *#*#2846579#*#* existe, pero no dice que enseñe la señal",
        "https://consumer.huawei.com/en/support/content/en-us00774019/",
      ),
      ...AOSP,
    ],
    nota: "Huawei tiene además su propio menú de pruebas, *#*#2846579#*#*, pero ninguna fuente dice que enseñe los números de la señal.",
  },
  honor: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: AOSP,
    nota: "Solo lo recogen guías que no hemos podido consultar.",
  },
  vivo: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "fuente-secundaria",
    fuentes: [BEEBOM("vivo", "vivo-phone-check-codes-list"), ...AOSP],
    nota: "vivo quita algunos códigos en cada versión del sistema.",
  },
  sony: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: AOSP,
    nota: "Es el código de Android. No hay ninguna fuente sobre los Sony recientes.",
  },
  nokia: {
    ...CUATRO_SEIS_TRES_SEIS,
    comprobacion: "sin-verificar",
    fuentes: AOSP,
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
  fuentes: [
    fuente(
      "XDA Developers: cómo abrir Field Test en iOS (abril de 2024)",
      "https://www.xda-developers.com/how-access-field-test-mode-ios/",
    ),
    fuente(
      "Celona: Field Test en iOS (abril de 2025)",
      "https://docs.celona.io/en/articles/11159852-apple-ios-field-test-mode",
    ),
  ],
  nota: "Apple cambia esta pantalla en cada versión de iOS, así que puede verse distinta. Con dos líneas, solo se actualiza bien la que está en uso.",
};
