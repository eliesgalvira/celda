import { assert, describe, it } from "@effect/vitest";

import { type DatosDelNavegador, detectarDispositivo } from "./dispositivo.ts";

/** `userAgent` reales de navegadores actuales. */
const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1",
  ipadAntiguo:
    "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  /** Chrome en Android desde la versión 110: el modelo siempre es «K». */
  chromeAndroidReducido:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  androidPixel:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A.241005.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  miuiBrowser:
    "Mozilla/5.0 (Linux; U; Android 13; es-es; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.1.60718",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  /** Firefox en un móvil que no dice su sistema. */
  movilSinSistema: "Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5",
} as const;

const datos = (userAgent: string, extra: Partial<DatosDelNavegador> = {}): DatosDelNavegador => ({
  userAgent,
  puntosTactiles: 0,
  ...extra,
});

describe("detectarDispositivo", () => {
  it("reconoce los ordenadores", () => {
    for (const ua of [UA.chromeWindows, UA.firefoxLinux, UA.safariMac, UA.chromeOs]) {
      assert.deepStrictEqual(detectarDispositivo(datos(ua)), { tipo: "ordenador" }, ua);
    }
  });

  it("reconoce el iPhone en Safari y en Chrome", () => {
    for (const ua of [UA.safariIphone, UA.chromeIphone]) {
      assert.deepStrictEqual(detectarDispositivo(datos(ua, { puntosTactiles: 5 })), {
        tipo: "iphone",
      });
    }
  });

  it("un iPad no es un iPhone ni un ordenador, aunque se presente como un Mac", () => {
    assert.deepStrictEqual(detectarDispositivo(datos(UA.ipadAntiguo, { puntosTactiles: 5 })), {
      tipo: "desconocido",
    });
    assert.deepStrictEqual(detectarDispositivo(datos(UA.safariMac, { puntosTactiles: 5 })), {
      tipo: "desconocido",
    });
  });

  it("saca la marca del modelo que pone el userAgent", () => {
    assert.deepStrictEqual(detectarDispositivo(datos(UA.androidSamsung)), {
      tipo: "android",
      marca: "samsung",
    });
    assert.deepStrictEqual(detectarDispositivo(datos(UA.androidPixel)), {
      tipo: "android",
      marca: "google",
    });
  });

  it("con el userAgent reducido de Chrome usa el modelo que da el navegador aparte", () => {
    const casos = [
      ["SM-A546B", "samsung"],
      ["Pixel 9a", "google"],
      ["23049PCD8G", "xiaomi"],
      ["2201117TG", "xiaomi"],
      ["Redmi Note 13 Pro 5G", "xiaomi"],
      ["moto g54 5G", "motorola"],
      ["RMX3771", "realme"],
      ["XQ-DQ54", "sony"],
    ] as const;
    for (const [modelo, marca] of casos) {
      assert.deepStrictEqual(
        detectarDispositivo(
          datos(UA.chromeAndroidReducido, { plataforma: "Android", modelo, puntosTactiles: 5 }),
        ),
        { tipo: "android", marca },
        modelo,
      );
    }
  });

  it("si no reconoce la marca no la adivina", () => {
    for (const extra of [
      {},
      { modelo: "" },
      // OPPO y OnePlus comparten este prefijo.
      { modelo: "CPH2449" },
      // Huawei y Honor usan esta forma.
      { modelo: "ELN-L09" },
    ]) {
      assert.deepStrictEqual(detectarDispositivo(datos(UA.chromeAndroidReducido, extra)), {
        tipo: "android",
        marca: undefined,
      });
    }
    assert.deepStrictEqual(detectarDispositivo(datos(UA.firefoxAndroid)), {
      tipo: "android",
      marca: undefined,
    });
  });

  it("el navegador de Xiaomi delata la marca aunque el modelo sea «K»", () => {
    assert.deepStrictEqual(detectarDispositivo(datos(UA.miuiBrowser)), {
      tipo: "android",
      marca: "xiaomi",
    });
  });

  it("lo que no reconoce queda como desconocido", () => {
    assert.deepStrictEqual(detectarDispositivo(datos(UA.movilSinSistema)), {
      tipo: "desconocido",
    });
    assert.deepStrictEqual(detectarDispositivo(datos("")), { tipo: "desconocido" });
    assert.deepStrictEqual(detectarDispositivo(datos("", { plataforma: "Windows" })), {
      tipo: "ordenador",
    });
  });
});
