# La misión de Celda

Estado: aceptada el 22/10/2026 (#80, #82). Fija el alcance que quedó al retirar el [ADR 0005](0005-simulaciones-puras-interfaz-fija.md) el 20/10/2026.

## Contexto

Celda empezó como un mapa de emplazamientos que además simulaba cómo llega la señal: las celdas de Voronoi, los sectores con una orientación supuesta, el sector que da servicio a un punto, la interferencia (SINR) y el diagrama de radiación. Ninguna fuente pública da el azimut, la potencia ni la inclinación de las antenas de una estación base, así que las celdas, los sectores y la SINR simulados engañaban más de lo que informaban, aunque llevaran la etiqueta «Simulación». El #81 los retiró el 20/10/2026. Hasta entonces el glosario y la descripción de la web decían que Celda enseña una estimación de «cómo llega su señal».

Sin la simulación había que decir para qué sirve Celda. Había dos ideas de partida: una interfaz mejor para los datos del registro oficial, y dar la información necesaria para comunicar un problema de recepción o de interferencia a quien corresponda. La investigación 09 ([reclamaciones-y-exposicion.md](../investigacion/reclamaciones-y-exposicion.md), #79) comprobó en fuentes primarias a quién se reclama cada problema, con qué plazos y con qué pruebas, y con eso la segunda idea es viable.

## Decisión

Las dos ideas van juntas en la misión, que abre el README y el `CONTEXT.md`:

> Celda enseña, con los datos oficiales, qué antenas de móvil hay en un sitio, de qué compañía son, en qué bandas emiten y qué ha medido el ministerio a su alrededor, y explica a quién acudir cuando algo va mal.

Entra en la misión:

- el mapa de los emplazamientos del registro oficial, con sus compañías y las correcciones de la comunidad;
- la ficha de cada emplazamiento, con las bandas de cada compañía, la tecnología probable que se deduce de ellas y desde cuándo lo publica el registro;
- las medidas de exposición del ministerio que publica el registro, comparadas con el límite legal y con las de su zona (ADR 0030, #86);
- el panel «Si algo va mal», que dice para seis problemas a quién se acude, en qué orden, con qué plazos y qué conviene guardar, con enlaces a las páginas oficiales (#87);
- lo que sale de dos posiciones reales: la distancia y el rumbo del punto de referencia a un emplazamiento, y los consejos de «Mejorar la señal» con la brújula;
- «Medir mi señal», que explica cómo ver la señal en el modo de información del móvil;
- el modo estudiante y su ejercicio de emplazamientos.

Queda fuera:

- simular la cobertura, la señal o la interferencia con un modelo, como las celdas, los sectores con una orientación supuesta o el sector que da servicio. Volver a hacerlo necesita un ADR nuevo;
- decirle a nadie qué cobertura tiene en un sitio. La cobertura que declaran las compañías al ministerio (#72) también queda fuera de esta versión;
- decir si la exposición en un sitio es segura o peligrosa. La ficha compara cada medida con el límite y con las de su zona, y nada más;
- reclamar o denunciar en nombre de nadie. El panel no tiene formularios, no envía nada y no pide datos personales;
- presentar como seguro lo que la investigación no comprobó en una fuente primaria. Lo que marca como inferido o no confirmado no sale, o sale dicho como dudoso.

## Consecuencias

- El README y el `CONTEXT.md` empiezan por la misión. La descripción de la página y la del manifiesto de la web la resumen en 160 caracteres como mucho, para que un buscador la enseñe entera, y salen de un solo sitio, el plugin de los iconos (`marca/iconos.ts`).
- La misión usa «antenas» porque es la palabra con que busca el público. La interfaz sigue diciendo emplazamiento y estación base, como pide el glosario.
- El panel vale lo que vale la investigación 09, leída el 20/10/2026. Las normas, los plazos y las páginas oficiales cambian, y el panel tiene que revisarse con ellas. Ya hay una duda abierta: la Ley 10/2025 da quince días hábiles a las empresas para contestar una reclamación, y no está claro si eso cambia el mes de la compañía de móvil. Mientras no se aclare, el panel da el mes que dice la Oficina de Atención al Usuario de Telecomunicaciones.
- Lo que se añada a Celda tiene que caber en la misión. Lo que no quepa necesita un ADR que la cambie.

## Alternativas descartadas

- **Solo una interfaz mejor para el registro oficial.** Es la primera de las dos ideas y sigue dentro de la misión. Sola, dejaba a quien ve un problema en el mapa sin saber qué hacer con él.
- **Partir de tres preguntas**: qué antenas hay cerca y de quién son, si una antena es segura y qué hacer sin cobertura. La segunda pide un juicio sanitario. Celda puede comparar una medida con el límite legal, y las del ministerio ni siquiera dicen cuándo se tomaron.
- **Mantener la simulación con más avisos.** Ya llevaba la etiqueta «Simulación» y una nota sobre la orientación supuesta, y aun así las celdas y los sectores dibujados se leían como datos (ADR 0005).
