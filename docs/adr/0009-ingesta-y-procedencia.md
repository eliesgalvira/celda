# Ingesta automática por fuente, con la procedencia de cada dato

Estado: aceptada el 24/09/2026. La regla de fusión la sustituye el [ADR 0012](0012-fusion-a-15-metros.md) (26/09/2026). La decisión de extraer antenasmoviles.es la sustituye el [ADR 0019](0019-fuentes-registro-y-aportaciones-propias.md) (02/10/2026): las fuentes son el registro oficial y las aportaciones propias.

Ninguna fuente basta sola: el registro oficial está desactualizado y las demás lo corrigen sin explicarlo. Celda las junta y enseña de dónde sale cada dato y cuándo.

- Cada fuente tiene su extractor en `packages/ingesta`, un servicio Effect con reintentos y un `Schedule`, que produce observaciones con fuente, fecha y URL.
- La ingesta se programa con los crons del backend y es incremental: solo escribe lo que cambia.
- La fusión es una función pura del dominio. Junta las observaciones cercanas en emplazamientos, calcula la confianza y detecta conflictos. Los conflictos nunca se ocultan. La regla («misma compañía a menos de 60 m») la cambió el ADR 0012: 15 m entre cualquier compañía.
- Cada extractor tiene su propio límite hacia la fuente, por ejemplo una petición por segundo en lotes nocturnos. También lleva un `User-Agent` identificable, caché con ETag, respeto de `robots.txt` y un interruptor para apagarlo sin tocar el resto. El registro oficial no manda ETag: su caché es lo que ya está guardado en Convex, y solo se escribe lo que cambia. antenasmoviles.es tampoco lo manda: cada punto de su listado guarda una huella, y solo se vuelve a pedir el detalle de los que cambian (ticket 18).
- Cada ejecución de ingesta guarda su fuente, fecha, cambios y errores, para que el mantenedor vea su estado.
- La primera tarea de la fase 1 es averiguar qué campos publica el registro oficial y cómo se descarga.

## Opciones descartadas

- No extraer antenasmoviles.es. El autor decidió extraerlo a sabiendas, porque sus correcciones son lo que le falta al registro oficial. Se hace con poca carga para su servidor, con atribución en la ficha y un enlace a la página de cada emplazamiento corregido, y con su extractor aislado para poder apagarlo.
- CellMapper como fuente, por sus condiciones de uso.

## Consecuencias

Los datos de OpenCelliD tienen licencia CC BY-SA 4.0. Si se redistribuyen en las capas públicas, las capas heredan la licencia. Queda para un ADR de licencias.
