# Una ejecución de ingesta al mes, el primer fin de semana, que lo lee todo

Estado: aceptada el 20/10/2026, con la decisión del usuario del mismo día (#77). Sustituye del [ADR 0014](0014-barrido-por-zonas-y-ritmo-en-espana.md) las zonas que se turnan, las fichas de cada noche en una ventana, la prioridad de Barcelona y Cataluña, la relectura a los 30 días y la espera de un día que se dobla tras cada fallo de una ficha. Sustituye del [ADR 0015](0015-ingesta-y-publicacion-fuera-de-convex.md) el temporizador de cada noche y la noche perdida que se recupera al encender la máquina. El ritmo de 1 s del 0014 pasa a ser el de por defecto. El glosario gana la ronda y cambia la ejecución de ingesta, el barrido y la zona de barrido.

## Contexto

Hasta ahora la ingesta corría cada noche a las 00:30 de Madrid en la máquina de producción, un portátil con NixOS. Cada noche barría una de las siete zonas de barrido, por turnos, y leía las fichas nuevas, las de listado cambiado y las leídas hace más de 30 días, a una por segundo y en una ventana de 24 horas (`horario = "*-*-* 00:30:00 Europe/Madrid"`, `registroOficial.fichas.ventana = 1440` y `registroOficial.fichas.ritmo = 1` en la configuración de la máquina).

El registro oficial cambia poco, y leerlo cada noche arriesga que el ministerio bloquee la máquina de producción. Además, las 47.216 fichas que se leyeron el 7 y el 8 de octubre iban a vencer a la vez hacia el 6 y el 7 de noviembre, y las noches de esa semana las habrían releído de golpe.

El 20/10/2026 el usuario decidió una ejecución al mes, en fin de semana, porque el ministerio no suele tocar nada los fines de semana, y que en sus 24 horas se lea todo: el listado de las siete zonas y todas las fichas.

Lo medido en la máquina de producción el 07/10/2026, en el diario: el geoportal contesta una ficha en unos 0,1 s, y con la pausa de 1 s salían 500 fichas cada 9 min 10 s, unos 1,1 s por ficha. La cola tenía entonces unas 69.700 fichas, que a ese ritmo son unas 21 h 20 min. El listado de las siete zonas son unas 215 peticiones a una cada 3 s, unos 11 minutos. La carga del 7 y el 8 de octubre leyó 47.216 fichas a ese ritmo sin ningún rechazo.

## Decisión

### Cuándo corre

- **El temporizador** se dispara el primer sábado de cada mes y el domingo siguiente a las 00:30 de Madrid: `Sat *-*-01..07 00:30:00 Europe/Madrid` y `Sun *-*-02..08 00:30:00 Europe/Madrid`. El primer sábado cae siempre entre el 1 y el 7, y el domingo siguiente entre el 2 y el 8 del mismo mes. La hora y la zona horaria son opciones del módulo (`hora` y `zonaHoraria`), y el módulo escribe con ellas el calendario del temporizador.
- **Sin recuperar lo perdido.** El temporizador ya no lleva `Persistent=`. Con él, una ejecución perdida con la máquina apagada se lanzaba al encenderla, y eso podía ser un martes. Sin él, si la máquina está apagada a las 00:30 del sábado, la ejecución la hace el domingo, y si tampoco, espera al mes siguiente. La opción `recuperarNochesPerdidas` desaparece.
- **Un disparo tardío no corre.** Con `Persistent=` apagado, el temporizador solo se dispara fuera de su hora tras una suspensión de la máquina o un salto del reloj, y lo hace en cuanto vuelve, sea el día que sea. El servicio lleva una condición (`ExecCondition=`) que solo deja correr un disparo del temporizador el primer sábado del mes o el domingo siguiente, y como mucho 15 minutos después de la hora. Mira `$TRIGGER_UNIT`, que systemd solo pone cuando lanza el servicio un temporizador, así que una ejecución lanzada a mano con `systemctl start` corre cualquier día. El diario dice por qué no corre un disparo tardío.
- **Una ejecución acaba el mismo día.** La ventana de fichas pasa a 22 horas por defecto: con la ejecución a las 00:30, cierra a las 22:30. El tiempo máximo del servicio pasa a ser la ventana, la hora de espera antes de repetir una publicación fallida y un cuarto de hora para publicar, copiar la base y subir el archivo de páginas: 23 h 15 min, en minutos en la opción `tiempoMaximo`. Una comprobación del módulo rechaza una configuración en la que la hora, los 15 minutos de margen de la condición y el tiempo máximo pasen de la medianoche. Así la ejecución del sábado nunca sigue corriendo a las 00:30 del domingo, cuando systemd juntaría el disparo del domingo con la ejecución en curso y el domingo no correría, y la del domingo nunca llega al lunes.
- **Por qué 22 horas y no 24.** Con 24 horas de fichas, la publicación del final, su repetición, la copia y el archivo acabarían pasada la medianoche. A 1,1 s por ficha, 22 horas son unas 72.000 fichas, y el listado se lleva 11 minutos de ellas: caben las unas 69.700 con una media hora de margen, unas 1.700 fichas. Si no caben, las lee la ejecución del domingo.

### La ronda

- **Lo leído en el último día y medio no se vuelve a pedir** (`RECIENTE`, 36 horas, en `packages/ingesta/src/barrido.ts`). Cada ejecución barre las zonas sin un barrido completado desde 36 horas antes de empezar y lee las fichas que no se han leído desde entonces, más las leídas con una versión anterior de la lectura. Las ejecuciones que caen así juntas son una ronda. La del primer sábado lo lee todo, porque la ronda anterior es de hace un mes. La del domingo solo lee lo que dejó la del sábado: las zonas que no completó y las fichas que no llegó a leer o que fallaron por algo pasajero. Si la del sábado no corrió, la del domingo lo lee todo. Si no queda nada, no pide nada al registro, ni siquiera `robots.txt`, y sigue con la publicación y la copia.
- **Por qué 36 horas.** Tiene que ser más que el día que separa el disparo del sábado del del domingo y mucho menos que las cuatro o cinco semanas hasta el primer sábado del mes siguiente. Con dos días justos, una ejecución lanzada exactamente 48 horas antes de un primer sábado quedaría en el límite, y así habría quedado la última noche del calendario de antes si se instala el jueves 5/11.
- **Dónde está lo pendiente.** En la base SQLite, en lo que ya guardaba: el estado y el inicio de cada barrido, y cuándo se leyó cada ficha, con qué versión de la lectura y hasta cuándo espera tras un fallo. No hay tablas nuevas ni versión nueva del esquema. La ejecución del domingo sabe lo que dejó la del sábado con las mismas consultas, contando desde 36 horas antes de su inicio. Un barrido a medias de una ronda anterior no se retoma: queda fallido («a medias en una ronda anterior») y la ronda nueva lo empieza de cero, porque sus cuadros guardados son de hace un mes.
- **Sin relectura.** La opción `registroOficial.fichas.relectura` y `CELDA_REGISTRO_FICHAS_RELECTURA_DIAS` desaparecen. Una ficha se lee en cada ronda si no se ha leído en el último día y medio, así que cada mes se releen todas. El día y medio es una constante del código. Como opción solo admitiría valores entre el día que separa el sábado del domingo y las cuatro semanas que separan dos rondas: con los 30 días de antes, la ronda que llega 28 días después de otra no releería nada de lo que leyó aquella.
- **Las fichas que fallan.** Una que no responde ni tras los reintentos no espera, y la vuelve a pedir el domingo. Una ilegible, o una que el registro no tiene («Código de emplazamiento no válido»), espera a la ronda siguiente, 36 horas, porque pedirla otra vez el domingo daría lo mismo. Se va la espera de un día que se doblaba con cada fallo hasta los 30 días. Sin esto, las dos estaciones base sin ficha en el registro harían correr la ejecución del domingo todos los meses.
- **El orden de las fichas** es el mismo en toda España, sin provincias ni zonas por delante: primero las nuevas y las de listado cambiado, en el orden en que llegaron, y luego las demás, de la leída hace más tiempo a la más reciente (`ordenarFichas`). Una ficha sale una vez en la cola. El orden solo importa si la ventana no da para todas, para que lo que quede para el domingo sea lo leído más recientemente. La opción `registroOficial.fichas.prioridad` y `CELDA_REGISTRO_FICHAS_PRIORIDAD` desaparecen.
- **Una ejecución pide cada ficha como mucho una vez**, y una ronda también: lo que el sábado lee, el domingo no lo pide. Solo se pide dos veces en una ronda una ficha que falló por algo pasajero, o en la que la fuente paró las fichas.
- **Las zonas.** Cada ronda barre todas las de `registroOficial.zonas`, por defecto las siete, en su orden. Las opciones `zonasEnTurno` y `zonasPorNoche`, y sus variables, desaparecen con los turnos.

### Cuando la fuente para

Las salvaguardas del extractor no cambian: el `User-Agent`, `robots.txt`, los reintentos y la parada ante un 401, un 403, un 429, un 503 que pide esperar más de un minuto, una página que no es una ficha o tres fallos seguidos. Si la fuente para la ejecución del sábado, lo que falta sigue pendiente y la ejecución del domingo lo intenta una vez más. Si vuelve a parar, no queda otra ejecución ese mes. Al acabar cada ejecución, el diario dice lo que queda de la ronda y qué ejecución lo lee: «Lo que queda de la ronda, 30 fichas, lo lee la ejecución del domingo 8/11/2026 a las 00:30 (Europe/Madrid)», o con un aviso, «Lo que queda de la ronda, 20 fichas, se queda sin leer este mes, porque no hay otra ejecución hasta la del sábado 5/12/2026 a las 00:30 (Europe/Madrid), que empieza otra ronda». Para eso el programa recibe del módulo la hora y la zona horaria (`CELDA_INGESTA_HORA` y `CELDA_INGESTA_ZONA_HORARIA`), y con ellas calcula la próxima ejecución (`apps/nocturna/src/calendario.ts`). No decide nada con ellas.

### La orden `estado`

Dice cuándo es la próxima ejecución y qué hará: la del domingo, lo que queda de la ronda y que no pedirá nada si no queda nada; la del primer sábado, que empieza otra ronda. Durante una ejecución, la última sale en curso con las fichas que le quedan a la ronda. Las fichas por leer ya no van por provincias y zonas en el orden de la cola, porque no hay más que un orden; salen en una sola cuenta, y por zona de barrido junto a su último barrido.

### La publicación a mitad de la ventana se queda

Cada ejecución sigue publicando a mitad de la ventana de fichas y al acabar. Con los valores por defecto, la mitad cae hacia las 11:30 del sábado, antes de los partidos de la tarde y de la noche del fin de semana, en los que los bloqueos de LaLiga pueden cortar R2 (ADR 0015). El final cae hacia las 22:30, en plena noche de partidos. Si la publicación del final y la que se repite una hora después no llegan a R2, la publica la ejecución del domingo a las 00:30, que corre siempre y, sin nada pendiente, publica sin pedir nada al registro. Si la ejecución que lo lee todo es la del domingo y su final tampoco publica, lo que llegó a mitad es lo que verá el mapa hasta el mes siguiente. Y si un corte de luz para la del sábado por la tarde, la mitad de lo leído ya está publicada. Cuesta una publicación más por ejecución, que solo escribe las provincias y los lotes que cambian. Una ronda deja dos o tres versiones, así que las ocho que se conservan cubren unos tres meses.

### Memoria y tiempo máximo

El tiempo máximo es el de arriba, 23 h 15 min. La memoria no cambia: 512 MB de montón de V8, `MemoryHigh=` a 1 GiB y `MemoryMax=` a 1,5 GiB. Una ronda hace lo mismo que la noche de todas las fichas medida el 03/10/2026 (734 MB de RSS como mucho, convex.md), repartido en 22 horas. Por ficha no crece nada, salvo la lista de las que fallan; la cola se lee entera al empezar las fichas. Medido otra vez el 20/10/2026 con la España sintética, el montón a 512 MB y el código de esta decisión (`pnpm run medir-espana`, convex.md): la ronda del mes siguiente, con las siete zonas y las 69.612 fichas trayendo otras bandas, que cambian casi todos los lotes, llega a 729 MB de RSS como mucho, y la de las primeras fichas, a 748 MB. Las dos quedan por debajo de los 1.024 MB de `MemoryHigh=`, y parte de ese RSS es la propia España sintética. En la máquina virtual de la prueba, la ejecución de las 40 fichas llega a 310 MB.

### Retirada y altas

La regla no cambia: una observación que falta en dos barridos seguidos de su zona se retira. Con un barrido por ronda, retirar un emplazamiento tarda dos meses, y uno nuevo tarda hasta un mes en salir, cinco semanas si la ronda siguiente cae el día 7.

### Peticiones

Una ronda son unas 215 peticiones de listado y unas 69.700 fichas: unas 70.000 peticiones al mes, en un solo día y al mismo ritmo de la carga del 7 y el 8 de octubre. El calendario de antes pedía las mismas fichas a lo largo del mes, unas 2.300 cada noche con la relectura de 30 días, y unas 930 peticiones de listado, 31 cada noche. Ahora el geoportal ve la ingesta uno o dos días al mes, en fin de semana, y no los treinta.

### La configuración de la máquina de producción

Los valores por defecto del módulo y del programa son los de producción: las 00:30 de Madrid, una ficha por segundo, 22 horas de ventana y las siete zonas. La configuración de la máquina deja de poner `horario`, `registroOficial.fichas.ventana` y `registroOficial.fichas.ritmo`. Con `horario` el módulo da un error que lo explica, y con la ventana de 1440 minutos la comprobación del mismo día no pasa.

## Consecuencias

- Una alta tarda hasta un mes en verse, y una baja, dos.
- Lanzar la ejecución a mano con `systemctl start` lee todo lo que no se ha leído en el último día y medio: tras un mes, unas 70.000 peticiones. Para probar sin fichas, `CELDA_INGESTA_MAX_FICHAS=0` en una ejecución local.
- Una ejecución lanzada a mano, o la última noche del calendario de antes, que corra menos de 36 horas antes de un primer sábado hace que esa ronda no repita lo que leyó. Por eso esta configuración se instala en la máquina de producción antes del viernes 6/11/2026: la primera ronda es la del sábado 7/11/2026, y la última noche de antes, como tarde la del jueves 5/11 a las 00:30, queda fuera del día y medio.
- El servicio y el paquete conservan el nombre `celda-nocturna`, y la orden, `noche`.
- La prueba de la máquina virtual comprueba el calendario: el temporizador de los dos días, un disparo tardío entre semana que no corre, un sábado entero tras el que el domingo no pide nada, un miércoles en el que no pasa nada y un sábado y un domingo en los que la fuente para las fichas.

## Alternativas descartadas

- **`Persistent=` con la condición de los días.** Recuperaría el sábado si la máquina se enciende a mediodía, pero esa ejecución duraría hasta el mediodía del domingo, se tragaría el disparo del domingo y, si fuera el domingo, llegaría al lunes. Sin `Persistent=`, la del domingo hace de recuperación.
- **Un servicio para el sábado y otro para el domingo.** Haría falta que no corrieran a la vez y repetir su configuración. Con uno solo y dos calendarios basta, porque cada ejecución sabe por la base lo que queda.
- **Apuntar la ronda en una columna de `ejecuciones`.** Decir cuándo empieza una ronda nueva pediría igualmente una regla de tiempo, y la frescura de lo que ya guarda la base da lo mismo sin migrar el esquema.
- **Que el programa decida con el calendario qué toca leer**, por ejemplo lo no leído desde el último primer sábado. Repetiría en el programa lo que ya decide systemd, y una ejecución a mano a mitad de mes no sabría si es de la ronda del mes o de otra.
- **Dejar de publicar a mitad de la ventana.** Sería más sencillo, pero en fin de semana el final de la ejecución cae en horas de partido.
- **Una ventana de 24 horas.** La ejecución acabaría al día siguiente, como se explica arriba.
