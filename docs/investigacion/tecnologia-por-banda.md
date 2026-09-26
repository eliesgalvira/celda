# Tecnología probable de cada banda

Consultado el 26/09/2026. Es la tabla que usa `packages/dominio/src/tecnologia.ts` para decir, en la ficha, si un emplazamiento «probablemente» da 4G o 5G.

## Por qué hace falta

El registro oficial publica, por estación base, los expedientes del Registro Nacional de Frecuencias con su tramo en MHz. No publica la tecnología. Según el ministerio, cada expediente «se refiere a una determinada banda destinada a dicho servicio y a una tecnología utilizada en la banda», pero Infoantenas no dice cuál (ver `registro-oficial.md`, apartado 1). Así que la tecnología solo se puede deducir de la banda, y la interfaz la da siempre como probable.

## La tabla

| Banda | Tramo en el registro | Tecnología probable hoy | Otras posibles | Franja |
|---|---|---|---|---|
| 700 MHz | 758-788 | 5G | | baja |
| 800 MHz | 832-862 (subida) | 4G | | baja |
| 900 MHz | 925-960 | 4G | 2G, 3G | baja |
| 1800 MHz | 1805-1880 | 4G | 2G | media |
| 2100 MHz | 1900-1920 y 2110-2170 | 4G | 3G | media |
| 2600 MHz | 2570-2690 | 4G | | alta |
| 3500 MHz | 3400-3800 | 5G | | alta |

La franja no sale de ninguna fuente de datos, sino de la propagación: por debajo de 1 GHz la señal llega más lejos y atraviesa mejor las paredes, y las bandas altas tienen bloques más anchos, que dan más velocidad con menos alcance.

## De dónde sale

**Comprobado** (fuentes oficiales):

- **700 MHz, 5G.** La subasta de julio de 2021 adjudicó la banda de 700 MHz como «prioritaria para desplegar redes y servicios 5G» y fue la tercera subasta de espectro para 5G ([La Moncloa, 21/07/2021](https://www.lamoncloa.gob.es/serviciosdeprensa/notasprensa/asuntos-economicos/Paginas/2021/210721-subasta-5g.aspx); [Ministerio, 16/07/2021](https://portal.mineco.gob.es/es-es/comunicacion/Paginas/210716_np_5g.aspx)).
- **3500 MHz, 5G.** La subasta de julio de 2018 fue de «espectro radioeléctrico en la banda 3600-3800 MHz» para servicios 5G ([Ministerio, 17/07/2018](https://portal.mineco.gob.es/es-es/comunicacion/Paginas/180717_np_subasta5g.aspx)).
- **800 y 2600 MHz, 4G; 900 y 1800 MHz, neutrales.** El real decreto de abril de 2011 sacó a subasta las bandas de 800 MHz (dividendo digital), 900 MHz y 2,6 GHz, autorizó el uso con neutralidad tecnológica de las de 900 y 1800 MHz y dijo que «permitirá la introducción de la cuarta generación de telefonía móvil (LTE)» ([La Moncloa, 01/04/2011](https://www.lamoncloa.gob.es/consejodeministros/paginas/enlaces/010411Radioelectrico.aspx)). La subasta se resolvió con la [Orden ITC/2508/2011](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2011-15023).

**Fuente secundaria:**

- **3G a la baja en 2100 y 900 MHz.** Vodafone apagó su 3G en 2024 y Movistar en 2025; Orange lo mantiene hasta finales de 2027 y el 2G hasta 2030 ([adslzone](https://www.adslzone.net/noticias/operadores/apagado-redes-3g/)). Por eso el 4G va primero en esas bandas.

**Inferido:**

- En 900, 1800 y 2100 MHz la tecnología más probable hoy es 4G. Con neutralidad tecnológica cada compañía decide, y puede haber 2G, 3G o 5G compartiendo la banda con 4G (DSS). Por eso la frase dice «probablemente» y los datos técnicos enseñan las otras posibles.
- El 700 MHz se trata como 5G porque se subastó para eso, aunque el mismo tramo podría llevar 4G. No lo he comprobado sobre el terreno.

## Cómo lo usa la interfaz

- La frase del panel dice «probablemente da 4G y 5G» y, si no todas las compañías tienen bandas de 5G, con cuáles.
- Si de alguna compañía no se conocen las bandas, la frase habla de «las bandas que se conocen» y no afirma lo que falta.
- Los datos técnicos enseñan, por expediente, la tecnología probable y las otras posibles, con una nota que dice que es una deducción.
