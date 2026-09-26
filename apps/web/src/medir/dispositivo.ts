import type { MarcaAndroid } from "@celda/dominio/modoInformacion";

/** Lo que el navegador dice de sí mismo. Se lee en `navegador.ts`; aquí solo se interpreta. */
export interface DatosDelNavegador {
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`: un iPad se presenta como un Mac, pero con pantalla táctil. */
  readonly puntosTactiles: number;
  /** `navigator.userAgentData.platform`, en los navegadores que lo dan, como «Android». */
  readonly plataforma?: string | undefined;
  /**
   * El modelo del móvil, de `userAgentData.getHighEntropyValues`. Chrome en Android ya no lo
   * pone en el `userAgent` y solo lo da así, un momento después.
   */
  readonly modelo?: string | undefined;
}

export type TipoDeDispositivo = "ordenador" | "android" | "iphone" | "desconocido";

/** El dispositivo desde el que se abre Celda, en lo que importa para medir. */
export type Dispositivo =
  | { readonly tipo: "ordenador" }
  /** `marca` falta si no se reconoce: entonces no se adivina ningún código. */
  | { readonly tipo: "android"; readonly marca: MarcaAndroid | undefined }
  | { readonly tipo: "iphone" }
  | { readonly tipo: "desconocido" };

/**
 * Patrones del modelo o del navegador de cada marca, solo los que no se confunden con otra.
 * OPPO y OnePlus comparten el prefijo `CPH` y Huawei y Honor la forma `ABC-L29`, así que esos
 * modelos no dan marca.
 */
const PATRONES_DE_MARCA: ReadonlyArray<readonly [MarcaAndroid, RegExp]> = [
  ["samsung", /^(?:SM-|SAMSUNG\b|Galaxy\b)/iu],
  ["google", /^Pixel\b/iu],
  // Los Xiaomi, Redmi y POCO recientes se llaman con números, como 2201117TG o 23049PCD8G.
  [
    "xiaomi",
    /^(?:Redmi\b|POCO\b|Xiaomi\b|Mi \w|M\d{4}[A-Z]\d{1,3}[A-Z]{0,3}$|\d{7}[A-Z]{1,3}$|\d{5}[A-Z]{2,4}\d[A-Z]$)/iu,
  ],
  ["motorola", /^(?:moto\b|motorola\b|XT\d{4})/iu],
  ["oneplus", /^(?:OnePlus\b|ONEPLUS)/iu],
  ["oppo", /^OPPO\b/iu],
  ["realme", /^(?:RMX\d{4}|realme\b)/iu],
  ["huawei", /^HUAWEI\b/iu],
  ["honor", /^HONOR\b/iu],
  ["vivo", /^vivo\b/iu],
  ["sony", /^(?:Xperia\b|XQ-[A-Z]{2}\d{2})/iu],
  ["nokia", /^Nokia\b/iu],
];

/** El modelo que el `userAgent` de Android pone tras la versión, si no es la «K» de Chrome. */
const modeloDelUserAgent = (userAgent: string): string | undefined => {
  const modelo = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/u.exec(userAgent)?.[1]?.trim();
  return modelo === undefined || modelo === "K" ? undefined : modelo;
};

/** La marca de un móvil Android, o nada si no se reconoce con seguridad. */
export const marcaAndroid = (datos: DatosDelNavegador): MarcaAndroid | undefined => {
  const modelos = [datos.modelo?.trim(), modeloDelUserAgent(datos.userAgent)].filter(
    (modelo): modelo is string => modelo !== undefined && modelo !== "",
  );
  for (const modelo of modelos) {
    const encontrada = PATRONES_DE_MARCA.find(([, patron]) => patron.test(modelo))?.[0];
    if (encontrada !== undefined) return encontrada;
  }
  // El navegador de Xiaomi solo viene instalado en sus móviles.
  return /\bMiuiBrowser\//u.test(datos.userAgent) ? "xiaomi" : undefined;
};

/**
 * Qué dispositivo es, a partir de lo que dice el navegador. Si no está claro, dice
 * «desconocido» y la persona lo elige; nunca se inventa un tipo.
 */
export const detectarDispositivo = (datos: DatosDelNavegador): Dispositivo => {
  const { userAgent } = datos;
  if (/\b(?:iPhone|iPod)\b/u.test(userAgent)) return { tipo: "iphone" };
  // Un iPad no tiene la app Teléfono, así que no puede marcar el código ni es un ordenador.
  if (/\biPad\b/u.test(userAgent)) return { tipo: "desconocido" };
  if (datos.plataforma === "Android" || /\bAndroid\b/u.test(userAgent)) {
    return { tipo: "android", marca: marcaAndroid(datos) };
  }
  if (/\bMacintosh\b/u.test(userAgent)) {
    // Desde iPadOS 13, Safari en un iPad se presenta como un Mac.
    return datos.puntosTactiles > 1 ? { tipo: "desconocido" } : { tipo: "ordenador" };
  }
  if (/\bMobile\b/u.test(userAgent)) return { tipo: "desconocido" };
  if (/\b(?:Windows NT|CrOS|X11|Linux x86_64)\b/u.test(userAgent)) return { tipo: "ordenador" };
  const plataforma = datos.plataforma ?? "";
  return ["Windows", "macOS", "Linux", "Chrome OS", "Chromium OS"].includes(plataforma)
    ? { tipo: "ordenador" }
    : { tipo: "desconocido" };
};
