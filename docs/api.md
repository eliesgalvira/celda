# API de Celda

Los datos del mapa de Celda se pueden reutilizar sin pedir permiso y sin clave. Hay dos formas de leerlos:

- **`GET /api/emplazamientos`** busca los emplazamientos más cercanos a un punto.
- **Los ficheros de `/capas`** son los mismos que descarga el mapa: las fichas de cada emplazamiento, con sus bandas y las medidas de exposición del ministerio, y el conjunto entero por provincias.

Las dos salen de la misma publicación, que la ingesta rehace una vez al mes con el registro oficial. Cómo se decidió está en el [ADR 0032](adr/0032-api-publica.md).

## Emplazamientos cerca de un punto

```
GET https://celda.elies.site/api/emplazamientos?lat=40.41693&lon=-3.70358&radio=300&limite=5
```

| Parámetro | Obligatorio | Qué es |
|---|---|---|
| `lat`, `lon` | sí | El punto desde el que se busca, en grados decimales (WGS84), con punto decimal. |
| `radio` | no | Hasta dónde se busca, en metros enteros. De 1 a 10.000; si falta, 1.000. |
| `compania` | no | Solo los emplazamientos donde está alguna de estas compañías: `movistar`, `vodafone`, `orange`, `digi` o `yoigo`, separadas por comas. |
| `limite` | no | Cuántos devolver como mucho. De 1 a 50; si falta, 20. |

Un parámetro que no está en la tabla, o uno repetido, da un error en lugar de ignorarse.

La respuesta trae los emplazamientos ordenados del más cercano al más lejano. Esta es la de arriba, recortada a uno:

```json
{
  "version": "sitios@2026-10-21T22:30:02Z",
  "fecha": "2026-10-21T22:30:02.000Z",
  "consulta": { "lat": 40.41693, "lon": -3.70358, "radio": 300, "companias": [], "limite": 5 },
  "total": 17,
  "hayMas": true,
  "emplazamientos": [
    {
      "clave": "orange-MADR3318B",
      "posicion": { "longitud": -3.703442, "latitud": 40.41721 },
      "distanciaMetros": 33,
      "estado": "verificado",
      "companias": ["orange"],
      "bandas": [{ "compania": "orange", "mhz": [800, 1800, 2100, 2600, 3500] }],
      "municipio": { "codigo": "28079", "nombre": "Madrid" },
      "provincia": { "codigo": "28", "nombre": "Madrid" },
      "ficha": "https://celda.elies.site/capas/fichas/28/fe49a53fb7c5b79e.json",
      "enlace": "https://celda.elies.site/?emplazamiento=orange-MADR3318B&provincia=28"
    }
  ],
  "licencias": { "propios": { "licencia": "CC0-1.0", "…": "…" }, "terceros": ["…"] }
}
```

- `version` y `fecha` dicen de qué publicación salen los datos. Todo lo de una respuesta es de la misma.
- `total` es cuántos hay dentro del radio con el filtro. Si pasa de `limite`, `hayMas` es `true` y la respuesta trae solo los más cercanos. No hay páginas: para ver más, sube `limite` o baja `radio`.
- `distanciaMetros` es la distancia en línea recta del punto al emplazamiento, en metros enteros.
- `estado` es `verificado` si el registro oficial lo tiene y nadie lo contradice, `corregido` si una corrección de la comunidad lo contradice y `nuevo` si solo lo conoce la comunidad.
- `bandas` son las frecuencias, en MHz, en que emite cada compañía según el registro. Una compañía de la que el registro aún no ha dado ninguna no aparece.
- `municipio` y `provincia` llevan el código INE y el nombre oficial. `municipio` es `null` en un territorio compartido entre municipios o en el mar.
- `ficha` es el lote de fichas donde está la de este emplazamiento (ver abajo).
- `enlace` abre el emplazamiento en el mapa de Celda.
- `licencias` dice qué datos son de quién y qué crédito hay que dar (ver «Licencias y crédito»).

### Errores

Un error trae `error` y `mensaje`, un texto en castellano para quien escribió la consulta:

```json
{ "error": "consulta-no-valida", "mensaje": "radio tiene que ser un número entero de metros, de 1 a 10000." }
```

| Estado | `error` | Cuándo |
|---|---|---|
| 400 | `consulta-no-valida` | Falta `lat` o `lon`, un valor está fuera de rango o hay un parámetro desconocido o repetido. |
| 429 | — | Más de 60 consultas en un minuto desde la misma IP. Espera al minuto siguiente. |
| 503 | `datos-no-disponibles` | La función no ha podido leer la publicación. Vuelve a intentarlo en unos minutos. |

## La ficha de un emplazamiento

La URL de `ficha` es un fichero JSON con las fichas de hasta 128 emplazamientos cercanos entre sí. La de cada uno se busca por su `clave`:

```sh
curl -s https://celda.elies.site/capas/fichas/28/fe49a53fb7c5b79e.json \
  | jq '.fichas[] | select(.clave == "orange-MADR3318B")'
```

Una ficha lleva:

- `direccion`, tal como la publica el registro, y `lugar`, el municipio y la provincia del IGN en que cae el punto.
- `estaciones`: una por compañía, con
  - `bandas`: cada una con la referencia del expediente en el registro, los rangos de frecuencia que publica (`desdeMhz`, `hastaMhz`), la banda en MHz y el año del expediente, que es una cota inferior y no la fecha de alta;
  - `medidasDeExposicion`: las medidas de exposición del ministerio alrededor de la estación base, con `distanciaMetros`, `acimutGrados` (la dirección del punto de medida vista desde la estación, desde el norte y en el sentido de las agujas del reloj) y `microvatiosPorCm2`. Una lista vacía es que el registro no publica ninguna; si falta, Celda aún no ha leído esa ficha del registro;
  - `origenes`: de dónde sale cada dato, con el enlace a la página del registro oficial, la fecha y el `historial` de lo que Celda ha visto cambiar en él;
  - `bandasSinLeer`: `true` si Celda aún no ha leído la ficha del registro y pueden faltar bandas.
- `correcciones`: las de la comunidad que la moderación ha aceptado, si hay alguna. Van al lado de lo que dice el registro y nunca lo sustituyen.

Las fechas de las fichas van en milisegundos desde 1970. Los ficheros de `/capas` se nombran por su contenido y no cambian nunca: se pueden guardar en caché sin fecha de caducidad.

## El conjunto entero

Para descargar todo, se empieza por `https://celda.elies.site/capas/vigente.json`. Dice la versión vigente y el nombre de su resumen nacional. El resumen lista las provincias, cada una con el fichero de su capa, y la capa de una provincia lleva, por columnas, la clave, la posición, las compañías, las bandas y el lote de fichas de cada emplazamiento. El formato está en `packages/dominio/src/provincias.ts` (formato 8). Además de la vigente, siguen publicadas las dos anteriores.

## Lo que dicen estos datos y lo que no

- Son los del registro oficial del Ministerio para la Transformación Digital y de la Función Pública, que declaran las compañías, más las correcciones aceptadas de la comunidad. Celda los lee una vez al mes; cuándo los actualiza el ministerio no lo dice el registro.
- Un emplazamiento no es una antena. Es un sitio, como una azotea o una torre, donde una o varias compañías tienen sus equipos.
- La distancia a un emplazamiento no dice nada de la cobertura ni de la señal en ese punto. Ninguna fuente pública da hacia dónde apuntan las antenas ni con qué potencia emiten.
- Las medidas de exposición del ministerio no tienen fecha, suman todas las frecuencias y todas las fuentes cercanas, y sirven para compararlas con el nivel de referencia más bajo de la norma, 200 µW/cm². No dicen si un sitio es seguro ni cómo funciona un móvil allí, y Celda no calcula la exposición en el punto de la consulta.

## Licencias y crédito

Los datos propios de Celda, como las correcciones aceptadas, son CC0 1.0: se pueden usar sin citar. Los del registro oficial piden, según las condiciones de reutilización del ministerio, citar la fuente con la fecha, no desnaturalizarlos y no sugerir que el ministerio apoya el uso que se les da. El crédito es «Origen de los datos: Ministerio para la Transformación Digital y de la Función Pública (Infoantenas)». Los nombres y códigos de municipios y provincias salen del IGN y del INE, con CC BY 4.0. Cada respuesta de la API lleva estas condiciones en `licencias`, y [LICENCIA-DATOS.md](../LICENCIA-DATOS.md) las explica todas.

## Límites

La API es gratuita y va sobre el plan gratuito del alojamiento de Celda. Cada IP puede hacer 60 consultas por minuto. Si el uso total pasara de lo que cubre ese plan, la API y la web podrían dejar de responder hasta el mes siguiente. Para usos grandes, descarga el conjunto entero una vez en lugar de hacer muchas consultas.
