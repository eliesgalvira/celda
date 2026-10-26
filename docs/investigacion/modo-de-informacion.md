# Códigos del modo de información

De dónde salen los códigos que Celda enseña para abrir el modo de información de cada móvil, y los tramos con que explica la potencia y la calidad de la señal. Todas las fuentes se consultaron el 26/09/2026. Los códigos y su grado de comprobación están en `packages/dominio/src/modoInformacion.ts`; sus fuentes, en la tabla por marca.

## Qué quiere decir cada grado

Ningún fabricante ni Apple publica estos códigos. La única fuente primaria es el código fuente de Android (AOSP), así que solo el código general de Android llega a ese grado.

- **Fuente primaria.** Sale del código fuente de Android.
- **Fuente secundaria.** Lo recoge un medio conocido que lo ha probado en móviles de la marca.
- **Sin verificar.** Solo lo recogen guías y foros que no se pudieron abrir, o las fuentes se contradicen.

La interfaz avisa con «Código sin comprobar» en los que no están verificados, y propone el código general de Android o la medida de ejemplo si no se abre nada.

## El código general de Android: `*#*#4636#*#*`

Leído en el código fuente de AOSP:

- El manifiesto de Settings registra `TestingSettingsBroadcastReceiver` para `android.telephony.action.SECRET_CODE` con `android:host="4636"`. Abre el menú «Pruebas» («Testing»), cuya primera entrada es `RadioInfo`, la pantalla «Información del teléfono».
- El receptor no abre nada en las compilaciones de usuario si el fabricante pone `config_hide_testing_settings_menu_for_user_builds` a `true`. AOSP lo trae a `false`, pero cada marca puede cambiarlo.
- `RadioInfo` enseña, para 4G, las columnas `SRV MCC MNC TAC CID PCI EARFCN BW RSRP RSRQ TA`, y para 5G PCI, NRARFCN, SS-RSRP y SS-RSRQ. La banda solo sale en el texto de la configuración del canal físico (`mBand=`). En la tabla aparece el EARFCN.
- El teclado de AOSP abre el código al escribir el último `*`, sin llamar: `SpecialCharSequenceMgr.handleSecretCode` salta cuando el texto empieza por `*#*#` y acaba en `#*#*`. Los teclados de Google, Samsung o Xiaomi no son libres y no se pueden comprobar así.

Fuentes:

- [Settings, AndroidManifest.xml](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/main/AndroidManifest.xml), junto con `TestingSettingsBroadcastReceiver.java`, `res/xml/testing_settings.xml` y `res/values/config.xml` del mismo repositorio.
- [RadioInfo.java](https://android.googlesource.com/platform/packages/services/Telephony/+/refs/heads/main/src/com/android/phone/settings/RadioInfo.java)
- [SpecialCharSequenceMgr.java](https://android.googlesource.com/platform/packages/apps/Dialer/+/refs/heads/main/java/com/android/dialer/dialpadview/SpecialCharSequenceMgr.java)
- [CellSignalStrengthLte.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/telephony/java/android/telephony/CellSignalStrengthLte.java)

## Tabla por marca

| Marca o sistema | Código | Pantalla | Grado | Fuentes |
|---|---|---|---|---|
| Android, otra marca | `*#*#4636#*#*` | Pruebas › Información del teléfono | Fuente primaria | AOSP, arriba |
| Samsung | `*#0011#` | ServiceMode | Fuente secundaria | [Android Authority, 10/07/2026](https://www.androidauthority.com/secret-dial-codes-samsung-phones-3684761/); [UberSignal, 03/01/2025](https://www.ubersignal.com/blogs/articles/field-test-mode) |
| Xiaomi, Redmi y POCO | `*#*#4636#*#*` | Pruebas | Fuente secundaria | [Beebom](https://gadgets.beebom.com/guides/xiaomi-secret-security-codes-list) |
| Google Pixel | `*#*#4636#*#*` | Pruebas | Sin verificar | [Android Police, 15/12/2025](https://www.androidpolice.com/force-phone-lte-5g-tutorial/); [UberSignal](https://www.ubersignal.com/blogs/articles/field-test-mode) |
| Motorola | `*#*#4636#*#*` | Pruebas | Fuente secundaria | [Android Police](https://www.androidpolice.com/force-phone-lte-5g-tutorial/) |
| OPPO | `*#*#4636#*#*` | Pruebas | Sin verificar | [Beebom](https://gadgets.beebom.com/guides/oppo-secret-check-codes) |
| realme | `*#*#4636#*#*` | Pruebas | Sin verificar | [Beebom](https://gadgets.beebom.com/guides/realme-secret-test-codes-list) |
| OnePlus | `*#*#4636#*#*` | Pruebas | Fuente secundaria | [Beebom](https://gadgets.beebom.com/guides/oneplus-secret-codes-list) |
| Huawei | `*#*#4636#*#*` | Pruebas | Sin verificar | [Huawei, menú de pruebas](https://consumer.huawei.com/en/support/content/en-us00774019/) |
| Honor | `*#*#4636#*#*` | Pruebas | Sin verificar | Solo AOSP |
| vivo | `*#*#4636#*#*` | Pruebas | Fuente secundaria | [Beebom](https://gadgets.beebom.com/guides/vivo-phone-check-codes-list) |
| Sony | `*#*#4636#*#*` | Pruebas | Sin verificar | Solo AOSP |
| Nokia | `*#*#4636#*#*` | Pruebas | Sin verificar | Solo AOSP |
| iPhone | `*3001#12345#*` y llamar | Field Test | Fuente secundaria | [XDA Developers, 26/04/2024](https://www.xda-developers.com/how-access-field-test-mode-ios/); [Celona, 29/04/2025](https://docs.celona.io/en/articles/11159852-apple-ios-field-test-mode) |

Notas por marca:

- **Samsung.** Su pantalla es propia, no la de AOSP. Según UberSignal enseña RSRP, RSRQ, SINR, la banda y la frecuencia. Android Authority cuenta que el Bloqueador automático impide la mayoría de códigos, y que One UI 8.5 lo vuelve a encender a los 30 minutos. En móviles bloqueados por una compañía sale un error de conexión. El teclado de Samsung bloquea `4636` en la mayoría de Galaxy. Ninguna fuente dice si `*#0011#` se abre al escribir la última `#` o hace falta llamar, así que la interfaz dice las dos cosas.
- **Xiaomi.** Beebom (mayo de 2026) dice que las versiones nuevas de HyperOS han quitado muchos códigos y que solo funcionan en la app Teléfono de Xiaomi, no en la de Google.
- **Google Pixel.** Las fuentes se contradicen. UberSignal dice que «puede funcionar según la versión de Android» y Android Police da a entender que en los Pixel ya no. Queda sin verificar aunque el código sea el de AOSP.
- **OPPO y realme.** Beebom dice que muchos códigos que funcionaban en ColorOS 11 y 12 dejan de hacerlo desde ColorOS 13. De realme solo hay confirmación para realme UI 2.0.
- **OnePlus y vivo.** Beebom los da por buenos, con el aviso de que cada versión del sistema quita alguno.
- **Huawei.** La página de Huawei solo confirma que existe su menú de pruebas `*#*#2846579#*#*` (en tabletas, desde la calculadora). Ninguna fuente dice que ese menú enseñe la señal, así que Celda da el código de AOSP y lo marca sin verificar.
- **Honor, Sony y Nokia.** Solo había guías que no se pudieron abrir (respondían 403). Celda da el código de AOSP y lo marca sin verificar.
- **iPhone.** Apple no documenta Field Test. La pantalla cambia con cada versión de iOS: iOS 14 la rehízo, en iOS 15 el RSRP salía a 0 para algunos, iOS 16 lo llevó a «All Metrics», iOS 17 quitó el RSRP de 5G e iOS 18 lo devolvió al «Dashboard» en vivo. Con dos líneas solo se actualiza bien la que está en uso (Celona). Siempre hay que pulsar el botón de llamar.

## Tramos de la potencia y la calidad

Salen de la [guía de Teltonika Networks](https://wiki.teltonika-networks.com/view/Mobile_Signal_Strength_Recommendations), un fabricante de routers 4G. No son una norma y otras fuentes ponen los cortes un poco distintos. Están en `packages/dominio/src/medida.ts`.

| | Excelente | Buena | Regular | Mala |
|---|---|---|---|---|
| Potencia, RSRP (dBm) | ≥ −80 | −80 a −90 | −90 a −100 | < −100 |
| Calidad, RSRQ (dB) | ≥ −10 | −10 a −15 | −15 a −20 | ≤ −20 |

## Lo que no se pudo comprobar

- Samsung Community, XDA Forums, MacRumors, los foros de Lenovo y hardreset.info respondían 403. Lo que dependía solo de ellos queda sin verificar.
- Si los teclados cerrados abren los códigos al escribir el último signo. Beebom y MakeUseOf dicen que sí en los móviles que probaron, pero siempre con la app Teléfono de la marca.
- La pantalla «Información del teléfono» deja cambiar el tipo de red preferido o apagar la radio. Celda solo pide leer los números, y la interfaz dice que no hace falta tocar nada.
