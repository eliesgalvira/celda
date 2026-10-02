# Fuentes: el registro oficial y las aportaciones propias, sin antenasmoviles.es

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Sustituye la opción descartada del ADR 0009 («No extraer antenasmoviles.es»), la ampliación del ADR 0012 por la unión por código con la comunidad en lo que toca a antenasmoviles.es, el apartado «antenasmoviles.es por zonas» del ADR 0014 y lo que el ADR 0015 guarda y configura de antenasmoviles.es. Lo lleva a cabo el #55.

## Contexto

El ADR 0009 decidió extraer antenasmoviles.es a sabiendas, porque sus correcciones son lo que le falta al registro oficial. La investigación de fuentes comunitarias ya avisaba de que no tener términos de uso no es un permiso. El derecho *sui generis* sobre bases de datos (Directiva 96/9/CE; artículos 133 y siguientes de la LPI) deja al fabricante de una base con inversión sustancial prohibir la extracción de una parte sustancial, y también la extracción repetida y sistemática de partes que no lo son. Leer su listado cada noche es eso.

El extractor existe (#20, #48), pero su interruptor siempre ha estado apagado en público. Comprobado el 02/10/2026: Celda no ha publicado nunca nada de antenasmoviles.es, ni una fila ni un fichero.

El usuario quiere además que Celda sea la fuente de verdad, y no una copia de otra web.

## Decisión

- **Las fuentes de Celda son el registro oficial y las aportaciones de su propia comunidad** (ADR 0020). Lo que Celda publica, el registro más las correcciones aceptadas, cada una con su procedencia, es el conjunto canónico.
- **Se retira todo lo de antenasmoviles.es:**
  - el extractor (`packages/ingesta/src/antenasmoviles/`) y su integración en la ingesta nocturna, con el interruptor `CELDA_ANTENASMOVILES_ACTIVO`;
  - las opciones `services.celda-nocturna.antenasmoviles.*` del módulo de NixOS y el servidor de mentira de su prueba;
  - en Convex, su acción, su cron y la tabla `puntos`, si el #51 no los ha retirado ya;
  - el literal `antenasmoviles` de `Fuente`, sus datos de prueba y sus resultados de referencia;
  - las 11 muestras grabadas de `docs/investigacion/muestras/antenasmoviles/` y los guiones de `docs/investigacion/muestras/espana/` que leen `showf`;
  - el crédito de la interfaz y las menciones en las guías y en el glosario.
- **Los cuadros y las densidades salen del registro.** Los 94 cuadros de `ZONAS_DE_BARRIDO` (`packages/dominio/src/barrido.ts`) se eligieron con los marcadores de antenasmoviles.es, y las densidades de los datos de prueba de España (`apps/nocturna/src/pruebas/espana.ts`) también. Se rehacen con el listado propio de toda España del registro, 69.612 registros. Un cuadro con registros fuera de los 94 nunca aparece en ese listado, porque nadie lo pide, así que hay que pedir una vez cada cuadro que toca los límites de España y quedarse con los que traen algo.
- **La ficha sigue enseñando las dos versiones.** La parte del panel que pone al lado lo que dice el registro y lo que dice otra fuente se queda si se puede hacer independiente de la fuente con poco trabajo, para las correcciones aceptadas. Si no, se quita y se rehace con el buzón (ADR 0020).
- **Ya no hace falta escribir a antenasmoviles.es** (#39). El correo al ministerio sigue.
- Los ADR, la investigación de fuentes comunitarias y la de España guardan sus cifras: son historia. Las investigaciones llevan arriba una nota que remite a este ADR.

## Consecuencias

- Hasta que lleguen las correcciones aceptadas, todo emplazamiento es `verificado` con confianza `media`, como ya pasaba con el interruptor apagado.
- Se pierden las estaciones que antenasmoviles.es tenía fuera del registro (las ER5: 42 en la caja de Barcelona). Celda las tendrá que recibir como aportaciones de «falta un emplazamiento».
- La unión por código del ADR 0012 con observaciones de otras fuentes se queda sin ninguna fuente que la use. Se deja o se quita en el ticket, según lo que pida el buzón.
- Las muestras borradas siguen en el historial de git. Cuando Celda pase a su propio repositorio, el historial que se lleve no debe incluirlas.
- OpenCelliD (#21) no se decide aquí. Su licencia CC BY-SA 4.0 obliga a publicar con esa misma licencia las capas que lleven sus filas, y eso choca con la CC0 de los datos de Celda (ADR 0021).

## Alternativas descartadas

- **Seguir con el extractor apagado y decidir más adelante.** Mantiene código, pruebas, opciones de NixOS y una fuente en el glosario que nunca se va a encender, y deja la duda legal abierta.
- **Pedir permiso a antenasmoviles.es** (#39). Aunque lo diera, Celda seguiría dependiendo de otra web para lo que quiere ser su propio dato.
