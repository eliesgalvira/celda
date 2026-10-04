# De dónde salen los logos

Los ficheros de esta carpeta son los vectores oficiales de cada compañía, pasados por `svgo` 4.1.0 (`svgo -p 2`, `-p 3` el de Orange), sin redibujar nada. `logosDeCompanias.ts` copia de aquí sus trazos tal cual y `LogoCompanias.test.tsx` comprueba que siguen saliendo de estos ficheros. Los ficheros no van en la web: solo sus trazos, en el código.

Celda usa los logos para decir de qué compañía es cada estación base, que es un uso nominativo de la marca: lo permite el art. 37 de la Ley 17/2001 de Marcas y el art. 14 del Reglamento (UE) 2017/1001. La interfaz dice que las marcas son de sus titulares y que Celda no está afiliada a ninguna (`AVISO_DE_MARCAS`). Ninguno de estos ficheros da licencia de marca; solo cubren de dónde sale el dibujo.

Descargados y revisados el 04/10/2026.

## Movistar: `movistar.svg`

- **Qué es.** El isotipo de Movistar, la «M» de 2025, en el lienzo de 72 × 72 de Mística, el sistema de diseño de Telefónica. El color es `movistarBlue`, `#0066FF`, de su `palette`.
- **Origen.** [Telefonica/mistica-web](https://github.com/Telefonica/mistica-web), `src/logo-movistar.tsx` (el tipo `isotype`, que es el de por defecto) y `src/skins/movistar.tsx`, commit `95a8692a73a8a4953831cf854d20c327737e96bd` (01/09/2026). El fichero es el `<path>` de ese componente con su `viewBox` de `src/logo-movistar-shell.tsx`.
- **Licencia.** MIT, © Telefonica Digital España S.L.U. El repositorio no lleva ningún aviso sobre la marca. «movistar» es marca registrada del Grupo Telefónica.
- **Por qué no de movistar.es.** La web sirve la misma «M» (`ssr.col.movistar.es/api/v1/get-glyph/movistar-logo-h-m`), pero su aviso legal solo deja reproducir su contenido para uso personal y privado y pide «que ningún gráfico, icono o imagen disponible en esta Web sea utilizado, copiado o distribuido, separadamente». Mística es de Telefónica y tiene licencia MIT.
- **En el marcador.** La «M» en blanco sobre su azul, como la variante de marca de Mística (`neutralHighBrand` sobre `brand`).

## Vodafone: `vodafone.svg`

- **Qué es.** El icono de Vodafone: la comilla blanca en el círculo rojo `#E60000`.
- **Origen.** <https://www.vodafone.de/media/img/icons/mid-render/New_VF_Icon_RGB_RED.svg>, el logo de la cabecera de vodafone.de. vodafone.es usa el mismo icono, pero solo en PNG (`/c/statics/maestro/logo_vodafone.png`).
- **Licencia.** Marca de Vodafone Group Plc; Vodafone España la usa con licencia. El pie legal de vodafone.de dice que todo el contenido está protegido y se reservan los derechos; el aviso legal de vodafone.es no habla de marcas. Ninguno prohíbe nombrar a la compañía con su logo. Wikimedia Commons trata el logo como `PD-textlogo` y `TOO-UK` ([Vodafone Logo.svg](https://commons.wikimedia.org/wiki/File:Vodafone_Logo.svg)), con el aviso de marca.
- **En el marcador.** El círculo del marcador es el del icono: la comilla guarda su tamaño respecto a él.

## Orange: `orange.svg`

- **Qué es.** El «Small logo» de Orange: el cuadrado naranja `#FF7900` con una línea blanca. Su guía lo pide cuando el logo Master mide menos de 50 px en ordenador o 30 px en el móvil, con un espacio libre de 0,25 veces su lado alrededor, y no deja cambiar el tamaño de la línea ni sus colores.
- **Origen.** «Guidelines aplicación logo Orange», Orange España, septiembre de 2026, página 14: <https://www.orange.es/static/pdf/Guidelines_Logo_Orange.pdf> (sha256 `6617c211d81f75d3bbd4d63c0592aa6a59014d0524fd397fa1a2e1f32cb5a603`), enlazada desde el material corporativo para prensa de MasOrange (<https://masorange.es/prensa/material-corporativo/>, 22/09/2026). El fichero son los dos trazos de esa página sacados con `pdftocairo -svg`, con el `viewBox` en el cuadrado.
- **Licencia.** Marca de Orange Brand Services Limited. El aviso legal de orange.es y el de orange.com dicen de quién son las marcas, sin prohibir nombrar a la compañía con su logo.
- **Lo que no se usó.** El mismo logo está en [Orange-Boosted-Bootstrap](https://github.com/Orange-OpenSource/Orange-Boosted-Bootstrap) (`packages/orange/orange-logo.svg`), pero su `NOTICE.txt` excluye ese fichero de la licencia MIT y prohíbe usar las marcas de Orange salvo para decir de dónde sale el software.
- **En el marcador.** El cuadrado entero, sobre blanco, con su espacio libre hasta donde deja el círculo.

## DIGI: `digi.svg`

- **Qué es.** El logotipo «DIGI» en azul `#002BFF`. Celda usa solo su «D», en blanco sobre el azul, que es como la dibuja el icono de la web (`/images/favicon.png`).
- **Origen.** La imagen de la cabecera de <https://www.digimobil.es/> («Logo DIGI - Ir al inicio»), un SVG en `data:` dentro de la página.
- **Licencia.** «DIGI» es marca registrada de DIGI Spain Telecom, S.A. Su aviso legal (punto 6.2) deja reproducir en parte el contenido de la web sin ánimo de lucro si se dice la fuente, se enlaza la web y no se modifica; prohíbe modificar, transformar o imitar sus elementos. Celda no tiene ánimo de lucro y reproduce la «D» sin cambiarla; la fuente y el enlace están aquí. Wikimedia Commons trata el mismo logotipo como `PD-textlogo` ([Digi 2024 Logo.svg](https://commons.wikimedia.org/wiki/File:Digi_2024_Logo.svg)).

## Yoigo: sin logo

Yoigo va con su nombre escrito en blanco sobre su magenta (`#E42E84`), como antes. No se enseña su logo porque sus condiciones lo prohíben: el punto 2 de la información general de yoigo.com (Xfera Móviles, S.A.U., abril de 2024) deja copiar los elementos de la web, «logotipos» incluidos, «única y exclusivamente, para su uso personal y privado, quedando por tanto terminantemente prohibida la transformación, distribución, comunicación pública […] así como su modificación». Enseñarlo en una web pública es comunicación pública, y su icono, la «y», es un recorte del logotipo.

El logotipo actual es el de <https://www.yoigo.com/>: la palabra «yoigo» con un degradado de `#E42E84` a `#613085`, y el icono de la web es su «y». Si se decide usarlo, hay dos caminos: pedir permiso a MasOrange o tomar las formas de [Yoigo morado.svg](https://commons.wikimedia.org/wiki/File:Yoigo_morado.svg), que Commons trata como `PD-textlogo` y tiene las mismas letras, aunque es un calco de 2012 y no el vector oficial.
