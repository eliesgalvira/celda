# Límites de uso: el público solo lee ficheros estáticos

Estado: aceptada el 28/09/2026, tras la exploración técnica 04 (issue #6, rama `spike/celda-limites`). Revisada el 02/10/2026: el límite de la función que sirve R2 ya no existe, porque el ADR 0018 sirve las capas solo desde Vercel; y las escrituras del público, con sus límites, las fija el ADR 0020. Revisada el 03/10/2026: desde el #51 la ingesta y la publicación ya no corren en Convex, sino en la ingesta nocturna (ADR 0015), y Convex no tiene funciones hasta el buzón. Revisada otra vez el 03/10/2026 con el #56: el buzón tiene cuatro mutaciones públicas con límites de cubos de fichas (ADR 0020), y la web carga el cliente HTTP de Convex solo al compartir.

## Contexto

Celda v1 es pública y no tiene cuentas. La arquitectura del 24/09 servía el mapa desde una CDN y la ficha de cada emplazamiento con una consulta en vivo de Convex, y dejaba para esta decisión cómo limitar esa consulta.

La exploración 04 midió el problema en un backend local. Lo importante:

- Una consulta de Convex no puede gastar un límite, porque no escribe, y tampoco ve la IP. Para limitar la ficha habría que leerla con una mutación que gaste tres cubos (por cliente, por IP y global).
- Un rechazo también cuenta como llamada. Un solo cliente hizo 124 rechazos por segundo en local: a ese ritmo, el millón de llamadas al mes del plan gratuito se acaba en unas dos horas, con límites o sin ellos. Contra eso solo protege el tope de uso del panel de Convex o el plan de pago.
- Cada actualización de una suscripción cuenta como una llamada por cliente conectado, y el plan gratuito admite 1.000 sesiones a la vez.
- El local se cree la cabecera `X-Forwarded-For`. No se comprobó si la nube también, así que el límite por IP podría no parar a un script.

El veredicto dejaba una salida más: servir también la ficha desde la CDN. La decisión del 28/09 es esa.

## Decisión

Convex deja de estar expuesto al público. Solo lo usan la ingesta, por sus crons, y la publicación.

| Qué | Dónde se lee | Límite |
|---|---|---|
| Mapa (capa) | Fichero estático versionado en la CDN (ADR 0004) | El de la CDN |
| Ficha | Lote de fichas estático de la misma versión que la capa (ADR 0004) | El de la CDN |
| Qué versión cargar | `vigente.json`, en la CDN, con caché corta | El de la CDN |
| Búsqueda de emplazamientos | En el navegador, sobre la capa | Ninguno |
| Búsqueda de direcciones | Nominatim público (ADR 0013) | El suyo, una petición por segundo |
| Estado de la ingesta | La orden `estado` de la ingesta nocturna, en su máquina (ADR 0015) | No es pública |

Todas las funciones de Convex son internas: `datos:version`, `datos:ficha`, `capas:vigente` e `ingesta:estado` dejaron de ser públicas con esta decisión. La web ya no abre ningún WebSocket con Convex, y su paquete no lleva el cliente de Convex ni el de Confect. La publicación corre dentro de Convex, al final de cada ingesta, y escribe los ficheros en el almacén (ADR 0010).

Con esto no hace falta la mutación limitada, ni los cubos por cliente, IP o globales, ni el componente `@convex-dev/rate-limiter`. El volumen de lectura lo absorbe la CDN, que es para lo que está hecha.

## Qué queda por limitar, y dónde

- **Las peticiones a la función que sirve R2.** La CDN no es gratis del todo: cada petición a una Pages Function o un Worker gasta de la cuota de 100.000 al día de Cloudflare, también los aciertos de caché (exploración 05). Abrir una ficha nueva es una petición como mucho, porque las fichas van en lotes de 128 emplazamientos vecinos y el navegador guarda cada lote leído durante la visita. La web precarga los lotes de lo que se ve de cerca (ADR 0004): son las mismas peticiones que haría al abrir esas fichas, antes, y como mucho dos cada vez que se para el mapa. Si la cuota se acaba, Cloudflare responde con el error 1027 y el cliente tiene que pasar a la copia de Vercel (ADR 0010, ticket #14). Ahí no hay nada que limitar en Celda: el tope lo pone Cloudflare y la reserva lo absorbe.
- **La transferencia de Vercel.** Hobby da 100 GB al mes. Con la web, la capa y las fichas de Barcelona, una visita que abre tres fichas descarga unos 500 KB comprimidos, casi todo MapLibre y la propia web; la capa son 18 KB y cada lote de fichas, unos 8 KB. Se vigila en el panel de Vercel.
- **Nominatim.** Sigue con su límite, en el cliente, como fija el ADR 0013.
- **Convex.** Sin lecturas públicas, el gasto es el de la ingesta: unas decenas de mutaciones por noche y una acción de publicación. Conviene poner igualmente un tope de uso diario en el panel de Convex, por si una ingesta se enreda, pero ningún visitante puede gastar llamadas.
- **Escrituras del público.** No hay en la v1: las aportaciones viven en el dispositivo (ADR 0007). Si un día se comparten, esas acciones HTTP necesitarán límites por IP, por cliente y globales, y el veredicto de la exploración 04 sirve de punto de partida, con el aviso de que la IP se puede falsear.

## Consecuencias

- La ficha deja de ser en vivo. Cambia cuando cambia la capa, una vez por ingesta con cambios, y de todas formas los datos solo cambiaban con la ingesta nocturna.
- La marca de agua sigue: la ficha y la capa pueden tener versiones distintas en un caso concreto, que explica el ADR 0004.
- La historia 63 (límites por sesión y globales en la ficha y la búsqueda) se cumple sin código de límites: esas lecturas ya no pasan por el backend. La historia 64 (qué ha pasado y cuándo reintentar) se reduce a los errores de la CDN, que el panel ya cuenta con un reintento.
- El issue #19 cambia de alcance: sin consultas públicas no hay límites que programar en Convex. Lo que queda es el aviso cuando la CDN y la reserva fallan, que se solapa con el #14.
- Si mañana hiciera falta algo en vivo para el público, habría que volver a esta decisión y al veredicto de la exploración 04.
