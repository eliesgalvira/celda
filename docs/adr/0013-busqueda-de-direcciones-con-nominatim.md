# Búsqueda de direcciones con el Nominatim público, solo al pedirla

Estado: aceptada el 26/09/2026.

## Contexto

Para elegir un punto de referencia hay que poder buscar una dirección (historias 26 y 27). Celda no tiene cuentas ni servidor propio para esto, y la búsqueda se hace desde el navegador de cada persona. Hacía falta un geocodificador sin clave, con datos que se puedan citar y con reglas de uso claras.

Se miraron dos, los dos sobre datos de OpenStreetMap:

- **Nominatim** (`nominatim.openstreetmap.org`), de la Fundación OpenStreetMap. Su [política de uso](https://operations.osmfoundation.org/policies/nominatim/) es concreta: como mucho una petición por segundo, un `Referer` o `User-Agent` que identifique la aplicación, caché de los resultados, atribución visible y nada de autocompletar mientras se escribe. Acepta las búsquedas que lanza la persona si el número de usuarios es moderado, y pide que se pueda cambiar de servicio sin actualizar la aplicación.
- **Photon** (`photon.komoot.io`), de Komoot. Está hecho para autocompletar, pero sus condiciones se reducen a «úsalo con justicia; el uso intenso se limitará». No dice cuánto.

## Decisión

- Se usa Nominatim, porque sus límites están escritos y se pueden cumplir y probar.
- Se busca al enviar el formulario (Intro o «Buscar»), nunca mientras se escribe. Las consultas de menos de tres letras no se envían.
- El servicio `BuscadorDeDirecciones` deja al menos un segundo entre dos peticiones del mismo navegador y las hace de una en una. Guarda en memoria cada respuesta buena durante 12 horas; los fallos no se guardan.
- Las búsquedas se limitan a la zona de Barcelona (`viewbox` con los límites del mapa, `bounded=1`, `countrycodes=es`) y piden los nombres en castellano.
- Las peticiones van sin cabeceras propias. El navegador pone el `Referer` con el origen de Celda, que la identifica. Las cabeceras de trazas de Effect se quitan: con ellas, cada búsqueda serían dos peticiones (la de CORS y la buena).
- Bajo el buscador se cita «Nominatim · datos de OpenStreetMap (ODbL)» con su enlace.
- La dirección del servicio sale de `VITE_BUSCADOR_URL`. Cambiar de servidor o apagar el buscador (`VITE_BUSCADOR_URL=apagado`) es cambiar esa variable y volver a publicar la web, sin tocar el código. Con el buscador apagado, la interfaz lo dice y deja elegir el punto en el mapa.

## Consecuencias

- Si Celda tiene mucho público, el límite de Nominatim es por aplicación y no por persona. Entonces habrá que pasar a una instancia propia de Nominatim o Photon, o a un proveedor de pago, cambiando solo `VITE_BUSCADOR_URL` y, si hace falta, la lectura de la respuesta dentro del servicio.
- No hay autocompletado. Quien busca escribe la dirección y pulsa «Buscar».
- Un 429 de Nominatim se enseña como «el buscador pide que esperemos», no como un fallo de Celda.
