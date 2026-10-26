# Buzón de aportaciones en Convex, con límites, sin captcha y sin imágenes

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Cambia el ADR 0003 (Convex deja de guardar los emplazamientos y pasa a ser solo el buzón), el 0007 (las aportaciones se pueden compartir) y el apartado «Escrituras del público» del 0008. Lo llevan a cabo el #56 (el buzón) y el #57 (la herramienta de moderación). Completada el 03/10/2026 con el #56 y el #57: ver [Cómo quedó en el #56](#cómo-quedó-en-el-56) y [Cómo quedó en el #57](#cómo-quedó-en-el-57). Corregida el 26/10/2026 con el ADR 0007: el buzón ya no recibe medidas propias. Quedan tres mutaciones públicas (`pedirIdentidad`, `enviarCorreccion` y `enviarCorroboracion`), y la fila de las medidas de la tabla de límites y la comprobación de su sector ya no se aplican.

## Contexto

Celda v1 guarda las aportaciones en el dispositivo (ADR 0007), y el ADR 0008 dejó Convex sin ninguna función pública. Cuando la ingesta salga de Convex (#51), a Convex le queda un solo papel: recibir lo que el público comparte. El usuario lo confirmó el 02/10/2026.

Compartir abre escrituras al público, y el ADR 0008 ya avisaba de lo que eso cuesta. La exploración 04 midió que un rechazo también cuenta como llamada: un solo cliente hizo 124 rechazos por segundo en local, y a ese ritmo el millón de llamadas al mes del plan gratuito dura unas dos horas, con límites o sin ellos. Además, el local se creía la cabecera `X-Forwarded-For`, y no se comprobó si la nube también.

El usuario no quiere captchas de ningún tipo, ni cuentas, y el gasto tiene que ser 0 €. Celda será abierta del todo.

## Decisión

### Qué hace Convex

- Recibe lo que se comparte: medidas propias, solo con sus números, correcciones propuestas y corroboraciones. Guarda la cola de moderación.
- El mapa público nunca lee de Convex. La ingesta nocturna recoge lo aceptado y lo publica en estático con lo demás (ADR 0004 y 0018).
- Las únicas funciones públicas son las de enviar y la de pedir una identidad. Ninguna devuelve aportaciones de nadie. Lo que una persona ha enviado lo sabe su dispositivo (ADR 0007).

### Nunca se sube una imagen

La captura se lee en el dispositivo y solo se envían los números, como pide el #29. Una captura del modo de información puede enseñar el IMEI o el IMSI, el número de teléfono, la hora y el lugar. Celda no quiere responder de imágenes arbitrarias, y el plan gratuito tiene 1 GB de almacenamiento de ficheros. Las correcciones propuestas tampoco llevan fotos.

### Qué se puede proponer

Para empezar, cinco tipos de corrección propuesta:

- la posición del emplazamiento está mal, con el punto propuesto;
- una compañía está o no está en un emplazamiento;
- el emplazamiento ya no existe;
- falta un emplazamiento, con su punto y sus compañías;
- una nota opcional en cualquiera de las anteriores.

Una corrección propuesta nunca cambia por sí sola lo que se publica: antes tiene que aceptarla la moderación.

### Identidad

- Cada dispositivo tiene una identidad anónima que crea el servidor: el proveedor anónimo de Convex Auth, que está en beta, o un token firmado equivalente. Pedir una identidad está limitado por IP.
- La IP se lee en el servidor con `ctx.meta.getRequestMetadata()` (`ip` y `userAgent` en convex 1.46.0). Hay que comprobar en la nube que no se puede falsear con `X-Forwarded-For`.
- La IP solo se guarda como HMAC con una sal que cambia cada día, y se borra a las 24 horas, por el RGPD.

### Límites

Cubos de fichas con `@convex-dev/rate-limiter`:

| Qué | Por dispositivo | Por IP | En total |
|---|---|---|---|
| Medidas propias | 10 por hora, con ráfaga de 3 | 300 por hora | 5.000 al día |
| Correcciones propuestas | 10 al día, con ráfaga de 3 | 50 al día | 300 al día |
| Corroboraciones | 50 al día | 200 al día | |
| Identidades nuevas | | unas 100 al día | |

Los límites por IP son flojos a propósito. Las redes móviles españolas usan CGNAT, y en una red como eduroam un aula entera sale por la misma IP.

Además del límite de cada función, el despliegue tiene sus propios umbrales de Convex, por debajo de los topes del plan gratuito, para que se apague el buzón antes de que el plan apague el despliegue.

### Validación

- Las medidas se comprueban contra los rangos de 3GPP, con el esquema de `MedidaPropia` que ya existe, y su posición tiene que ser verosímil para el emplazamiento y el sector al que dicen estar unidas.
- Una medida suelta es un dato personal: un lugar, una hora y un dispositivo. Solo se publican agregados.

### En la ficha

Una corrección aceptada se enseña con su procedencia al lado del valor del registro, por ejemplo «el registro dice X; N personas lo sitúan en Y». Nunca sustituye en silencio al registro:

- las condiciones de reutilización del registro piden citar la fuente y no desnaturalizarla (ADR 0021);
- un solo aviso anónimo podría servir para acosar a alguien, por ejemplo poniendo una antena falsa en su casa.

### Moderación

Modera el usuario solo, con la ayuda de Claude, desde una herramienta de línea de órdenes del repositorio (#57). La herramienta enseña cada aportación pendiente con su contexto y está hecha para que un agente pueda clasificarla y proponer un veredicto que el usuario confirma. Lo aceptado sale de ahí hacia la publicación nocturna.

Una corroboración pasa por la moderación igual que una corrección propuesta (decidido en el #56). Solo cambia un número, pero ese número es lo que convence a quien lee la ficha, y sin captcha un script con muchas identidades lo podría inflar. La herramienta de moderación las puede aceptar de golpe, y en el número de personas cuenta cada identidad una vez por corrección.

## Cómo quedó en el #56

- **Identidad.** Un token firmado y no Convex Auth: el proveedor anónimo está en beta y pide claves JWT y rutas HTTP. `buzon:pedirIdentidad` crea una fila en `identidades` y devuelve su `_id` con un HMAC-SHA-256 de ese `_id`. El buzón no guarda el token; lo vuelve a firmar para comprobarlo. La clave es la variable de entorno `CELDA_BUZON_CLAVE` del despliegue, de 32 caracteres como mínimo. Sin ella el buzón está cerrado, y quitarla es la forma de cerrarlo sin tocar el código.
- **Huella de la IP.** Es el HMAC de la IP con esa clave y con una sal aleatoria del día UTC, que se guarda en `salesDeIp` y se borra en cuanto cambia el día. La misma IP da otra huella al día siguiente, y sin la sal ni con la clave se puede volver a calcular la de ayer. La huella se guarda en `huellasDeIp`, en la aportación y en la identidad. Un cron borra cada hora las de más de 24 horas, con sus vetos y sus cubos de límites por IP, y deja `huellaIp` a `null` donde estaba. Un veto por IP dura, por tanto, lo que dura su huella; el veto por identidad no caduca.
- **Límites.** Los de la tabla, sin repartir en fragmentos, en `convex/src/limites.ts`. Su clave es la `_id` de la identidad o la huella de la IP. Un envío rechazado deshace también las fichas que ya había gastado, y una aportación que ya estaba no gasta ninguna. El rechazo dice `reintentarEn` en milisegundos; en los límites del buzón entero lleva hasta 30 s de más. La web no vuelve a llamar antes de esa hora.
- **Funciones públicas.** Cuatro mutaciones: `buzon:pedirIdentidad`, `buzon:enviarMedida`, `buzon:enviarCorreccion` y `buzon:enviarCorroboracion`. Devuelven el token o si la aportación era nueva. Sus argumentos tienen la forma de cada aportación sin las comprobaciones, para que un valor fuera de rango dé `AportacionNoValida` y no un error sin tipo. Ninguna tiene un campo de bytes ni de fichero.
- **Funciones internas.** Para el #57: `moderacion:pendientes`, `moderacion:aceptadas` (lo que lee la noche, por la hora de aceptación), `moderacion:aceptar`, `moderacion:rechazar` y `moderacion:vetar`, más `limpieza:huellas`, que lanza el cron.
- **En la ficha.** Una corrección aceptada llega en `Ficha.correcciones` (`packages/dominio/src/ficha.ts`): la clave de la corrección, el cambio, cuántas personas la sostienen, la fecha de aceptación y `CC0-1.0`. La ficha la enseña en el contraste de «Registro oficial y comunidad», con el registro al lado.
- **En la web.** El cliente de Convex va en su propio trozo (`apps/web/src/buzon/convex.ts`) y se descarga al pulsar «Enviar» la primera vez. Es el cliente HTTP, no el de WebSocket: sin envíos no hay ninguna conexión abierta. La dirección del buzón es `VITE_CELDA_CONVEX_URL`; sin ella, el buzón está cerrado y la aportación se queda en el dispositivo.
- **`X-Forwarded-For`.** El backend local se la cree, también con el buzón: una petición con la cabecera dio otra huella el 03/10/2026. En la nube sigue sin comprobar, porque el #56 no despliega nada. Si la nube también se la cree, un script puede saltarse los límites por IP, pero no los de identidad ni los del buzón entero. Pendiente del usuario: llamar a `buzon:pedirIdentidad` en el despliegue con y sin la cabecera y ver si sale otra huella en `huellasDeIp`.
- **Región.** Sin comprobar si Convex tiene región en la UE para el plan gratuito. Pendiente del usuario, al crear el despliegue.
- **Umbrales del despliegue.** Se ponen en el panel de Convex, no en el código: ver «Antes del primer despliegue del buzón» en `docs/patterns/convex.md`.

## Cómo quedó en el #57

- **La herramienta.** `apps/moderacion`, que se lanza con `pnpm -s moderar <orden>`: `pendientes`, `ver`, `proponer`, `aceptar`, `rechazar`, `vetar` y `aceptadas`. Está hecha para que la lance un agente sin preguntar nada: todo va en los argumentos y, con `--json`, cada orden escribe un objeto con `formato: 1` y los esquemas de `packages/dominio/src/moderacion.ts`. Cómo se usa: «Moderar» en `docs/patterns/convex.md`.
- **El contexto.** De cada aportación, la ficha publicada de su emplazamiento en la versión vigente (el registro oficial y las correcciones ya publicadas), la distancia al punto propuesto, el historial de la identidad que la envió y las demás correcciones propuestas y corroboraciones del mismo emplazamiento. Lo del buzón lo da la función interna nueva `moderacion:contexto`; lo publicado lo lee la herramienta como la web, de `https://celda.elies.site/capas` o de una carpeta. Para buscar lo del mismo emplazamiento, cada aportación lleva ahora su emplazamiento fuera del contenido (`emplazamiento`, `null` si falta uno), con su índice.
- **El veredicto propuesto.** `proponer` da `aceptar`, `rechazar` o `mirar` con sus razones (`proponerVeredicto`), sin cambiar nada. Es una heurística para empezar: lo que envía alguien vetado se propone rechazar, una posición a menos de 15 m de la publicada no cambia nada, una compañía se compara con el registro, y un emplazamiento que desaparece o que falta pide otra identidad que diga lo mismo. Decide el usuario, con la orden explícita y su motivo.
- **Reglas del buzón.** El motivo es obligatorio y no puede estar en blanco; el servidor lo vuelve a comprobar. Un veredicto no se cambia: repetirlo no hace nada, y el contrario falla con `AportacionYaModerada`. Deshacer algo ya aceptado, que puede estar publicado, queda para cuando haga falta. Cada aceptada tiene una hora de aceptación propia y posterior a la de la anterior, aunque el reloj no avance, para que la noche, que sigue desde la última que leyó, no se salte ninguna.
- **Las claves, con el mínimo privilegio.** La herramienta habla con las funciones internas por la API HTTP de Convex con una clave de despliegue (`CELDA_CONVEX_URL` y `CELDA_CONVEX_CLAVE`), sin el paquete de Convex. Esa clave lo puede todo, así que solo la tiene quien modera, en su portátil. La máquina de la noche, que es un ordenador de casa, no la tiene: si alguien entrase en ella, tendría el buzón entero. La noche lee una sola acción HTTP, `GET /aportaciones/aceptadas`, con su propia clave (`CELDA_PUBLICACION_CLAVE`, variable del despliegue, como `Bearer` y comparada por su SHA-256). Da solo lo que se va a publicar: correcciones propuestas y corroboraciones aceptadas, sin nota, sin huella de IP y con `persona`, el HMAC de la identidad con la clave del buzón, en lugar de la identidad. Sin la clave, o con otra, un 401 vacío. Se descartó firmar cada petición con su hora: por HTTPS y con una clave que solo lee lo publicable, un `Bearer` basta, y repetir una lectura no cambia nada.
- **Hacia la publicación.** La noche lee lo aceptado como una ejecución de la fuente `comunidad`, antes del registro oficial, lo guarda en `aportaciones_aceptadas` de su base, sin identidades ni huellas de IP, y la publicación lo pone en `Ficha.correcciones` (`correccionesDeFicha`): las propuestas que dicen lo mismo son una, cada persona cuenta una vez y una corroboración suma a la que cita. El emplazamiento pasa de verificado a corregido y el registro sigue al lado. Si Convex no contesta, la ejecución queda fallida, el diario lo dice y la noche publica lo demás. En NixOS, la conexión es la credencial `credenciales.convex`, con la URL de las acciones HTTP y la clave de publicación.
- **Lo que aún no se publica.** Las medidas aceptadas no salen hacia la noche: solo se publicarán agregados, y eso traerá su propia acción. Un emplazamiento que falta, aceptado, tampoco sale: no tiene ficha a la que ir, y enseñarlo en el mapa es otro ticket.

## Consecuencias

- **Licencia de Convex.** El backend de Convex es FSL-1.1-Apache-2.0: código disponible, que pasa a Apache 2.0 a los dos años. Quien haga un fork de Celda necesita Convex Cloud, que es gratis, o montar el backend con esa licencia.
- **Una sola empresa.** Si el plan gratuito cambia, hay que mudar el buzón. El mapa no se entera, porque no lee de Convex.
- **El plan gratuito puede apagar el despliegue** si se pasa de sus topes, sin que esté claro por cuánto tiempo. Por eso los umbrales propios van por debajo. Con el buzón apagado, la web lo dice y guarda la aportación en el dispositivo para enviarla más tarde.
- **Los datos de las aportaciones están en los servidores de Convex.** Se guarda lo mínimo. Punto abierto: comprobar si Convex tiene región en la UE.
- Cuando el repositorio sea público, se puede pedir el programa Convex for Open Source, que da el plan Pro gratis.
- **Sin captcha, un atacante puede llenar la cola del día.** No se publica nada, porque todo pasa por la moderación, y las propuestas de verdad esperan un día. La respuesta es vetar la identidad o el HMAC de la IP y bajar el tope global. Una prueba de trabajo invisible solo se añade si hay abuso de verdad, y preguntando antes al usuario.
- Un script que insista gasta llamadas aunque se le rechace. Los umbrales del despliegue cierran el buzón antes de que se acabe el plan, y el mapa sigue igual.

## Alternativas descartadas

- **Un captcha**, de cualquier tipo. El usuario no los quiere. Turnstile, además, depende de Cloudflare y caería durante un bloqueo de LaLiga (ADR 0018).
- **Subir la captura** para leerla en el servidor. Por todo lo de «Nunca se sube una imagen».
- **Publicar las correcciones aceptadas encima del dato del registro.** Por lo de «En la ficha».
