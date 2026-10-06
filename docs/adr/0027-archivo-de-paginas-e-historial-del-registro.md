# Archivo privado de las páginas del registro e historial de cada registro

Estado: aceptada el 06/10/2026, con el diseño acordado con el usuario el mismo día. Va por fases. La fase 1, el archivo de páginas, la fase 2, el historial de cada registro, y la fase 3, la parada ante un cambio masivo, están hechas. Lo que se decidió al hacer cada una va en «Cómo quedó». El 07/10/2026 el usuario confirmó que el archivo se queda en el mismo cubo por ahora y que el punto de partida lleva la fecha más antigua que la base guarda de cada registro.

## Contexto

La ingesta guarda solo lo último que dice el registro oficial de cada estación base. `trasListado` y `trasFicha` (`packages/ingesta/src/guardado.ts`) sustituyen la observación de `observaciones` al cambiar el listado o la ficha, y la fusión borra los emplazamientos que ya no salen. El registro no fecha nada y quita sin avisar las bandas que se dan de baja, así que lo que se sustituye se pierde para siempre: Celda no puede decir desde cuándo emite una banda ni cuándo dejó de emitir.

Tampoco se guardan las páginas que se leen. Cada ficha son unos 9 KB de HTML, unos 2,2 KB comprimida, y hay unas 69.600. Si cambia la lectura de la ficha, como al sacar las medidas de exposición (#73), hay que volver a pedirlas todas: unas diez noches al ritmo de una cada 3 s.

El 06/10/2026 empezó en la máquina de la ingesta esa relectura de toda España (`VERSION_DE_LECTURA = 2`). Si el archivo llega en uno o dos días, esa misma pasada guarda casi todas las fichas de España sin pedir nada de más al ministerio. Las condiciones de reutilización del ministerio permiten copiar; el archivo es privado y no se publica.

La noche conserva catorce copias enteras de la base en el disco y otras catorce, comprimidas, en `copias/` del cubo privado de R2 (ADR 0018). Unos 150 MB de páginas dentro de la base se multiplicarían por 28.

## Decisión

### Fase 1: el archivo de páginas

- **Se archiva cada página tal como llega.** El extractor del registro guarda los bytes de cada respuesta con HTTP 200, del listado y de las fichas, en ISO-8859-1 y sin decodificar, antes de leerla. Con ellos va lo que sacó la lectura de entonces: leída, sin ficha en el registro («Código de emplazamiento no válido»), ilegible o ajena (una página que no es del geoportal, como la de un cortafuegos). Las ilegibles y las ajenas también se guardan, porque son justo las que necesita un arreglo de la lectura. Una respuesta con otro estado no trae nada del registro y no se guarda. Tampoco `robots.txt` ni la pasada por los cuadros de borde, que es una orden aparte.
- **Los listados también.** Cuestan poco: unos 27 bytes por registro comprimidos, unos 2 MB por una pasada entera de España, y un cuadro que no cambia no ocupa nada más. Guardan además los registros que Celda descarta, como los de titulares que no reconoce.
- **Un fichero aparte, por contenido.** El archivo es su propio fichero SQLite, `archivo.sqlite` al lado de la base, con su propia conexión y su propio esquema por versiones. Cada contenido distinto se guarda una vez, comprimido con gzip, con su SHA-256 como nombre. Cada lectura es una fila que apunta a su página (la URL) y a su contenido, con su hora. Nada se actualiza ni se borra.
- **Las lecturas se guardan todas, también las que no cambian.** Ocupan unos 45 bytes cada una, unos 40 MB al año con la relectura de 30 días. Como el registro no fecha nada, son lo único que acota entre qué dos noches cambió una página.
- **Copia incremental.** Al acabar la noche, después de la copia de la base, sale del archivo un paquete con las filas nuevas desde el anterior. Es otro fichero SQLite con las mismas tablas, `archivo-<fecha>.sqlite`, en la carpeta `archivo` de la de copias. Después se suben a `archivo/` del mismo cubo de R2 los paquetes que aún no están allí. Ningún paquete se borra. Con todos se rehace el archivo entero (`restaurar-archivo`). Si algo falla, lo dice el diario, la noche acaba bien y lo que falta va en el paquete o la subida siguientes.
- **El archivo nunca para la ingesta.** Si no se puede abrir o escribir, el diario lo dice y la noche sigue sin archivar. Perder las páginas de una noche es mejor que perder la noche, que tampoco las tendría.
- **Nunca se publica.** El build de Vercel solo copia el `vigente.json`, el resumen y los manifiestos de las versiones, y los ficheros que listan esos manifiestos (ADR 0018). Ahora además falla, sin escribir `vigente.json`, si un manifiesto lista algo de `copias/` o de `archivo/`. La retención de la publicación solo borra nombres con el sello de una versión y lo que listan sus manifiestos. La clave de solo lectura del build puede leer `archivo/`, como ya lee `copias/`, porque R2 da permisos por cubo. La base que hay en `copias/` tiene más que el archivo, así que esto no abre nada nuevo.
- **Se relee sin red.** `lecturaDeFicha` (`packages/ingesta/src/registro-oficial/normalizar.ts`) lee una ficha como el extractor, y la usan los dos. `releer-archivo` pasa la lectura de hoy por la última lectura archivada de cada ficha y dice cuántas se leen, cuántas no y por qué. Con `--aplicar` lleva a la base las que hacen falta.

### Fase 2: el historial de cada registro

Las ideas vienen de una aplicación con eventos que hizo el usuario. Tiene un registro de hechos al que solo se añade, con un número de orden global, una versión por flujo con índice único y un identificador determinista único, para que un reintento no duplique nada. Las cargas viejas se guardan con su JSON de entonces y se leen con adaptadores que fallan ante una forma ambigua en lugar de adivinar. Los ficheros en bruto se guardan aparte por su huella, y el registro de hechos solo la cita.

- **Hechos de registros, no de emplazamientos.** Cada hecho es de un registro del ministerio, por su clave (la razón social y el código). La clave de un emplazamiento cambia cuando la fusión junta o separa, así que la historia de un emplazamiento se saca al publicar de la de sus registros.
- **Lo que escribió el registro, antes de limpiarlo.** Cada hecho guarda los campos de la fuente tal como llegan: el elemento del listado antes de `repararTexto` y `municipioDeDireccion`, y las filas de la ficha como texto. Un cambio se detecta comparando esos campos. Así un cambio en la limpieza no marca como cambiados los 69.600 registros ni mueve sus fechas. La limpieza se hace al leer.
- **Un hecho de ficha cita su página.** Lleva la huella de la página de la que sale, que está en el archivo de la fase 1.
- **La tabla `observaciones` se queda.** Guarda también la cola de fichas (lecturas, fallos, esperas) y la noche la necesita. Se escribe en la misma transacción que los hechos. Una prueba, y si sale barato una orden como `comprobar`, comprueba que repetir los hechos da los campos publicados de la tabla.
- **Escribir dos veces no duplica.** El identificador de cada hecho sale de la clave, la ejecución y el tipo, con un índice único: una noche retomada o repetida tras un corte no escribe nada dos veces.
- **Un punto de partida que se distingue.** Cada registro que ya está en la base recibe un hecho «conocido antes», con la fecha más antigua que la base guarda de él. La base no guarda la ejecución que trajo cada registro, y una fecha posterior a la verdadera sigue siendo cierta en «en el registro antes del <fecha>». La web lo dice así y nunca como fecha de puesta en servicio, que no es pública.
- **Se publica en los lotes de fichas.** La historia de cada estación base va en la ficha con una clave opcional, sin cambiar el formato, como `sinFichaEnRegistro` y `medidasDeExposicion` (ADR 0016). La web no cambia en esta fase.

### Fase 3: parar ante un cambio masivo

Comparar lo que escribe el registro no protege de que cambie cómo lo escribe. Si la razón social «ORANGE ESPAGNE» cambiase, la expresión que reconoce a cada compañía (`normalizar.ts`) dejaría de reconocer unas 19.000 estaciones, y dos barridos las retirarían. Cuando el registro cambia de golpe mucho más de lo normal, la noche se para sin guardar el cuadro, sin contar ausencias y sin publicar, y espera a que alguien lo mire.

## Cómo quedó (fase 1)

**Dónde está.** `ArchivoDePaginas` (`packages/ingesta/src/archivo.ts`) es una referencia del contexto que por defecto no guarda nada; el extractor la llama con cada página (`packages/ingesta/src/registro-oficial/extractor.ts`). La nocturna pone la suya con `archivoNocturno` (`apps/nocturna/src/archivo.ts`), que también da `ArchivoNocturno`: el resumen, los paquetes, la restauración y el recorrido de las fichas archivadas. Las tablas son `contenidos` (huella, bytes y gzip), `paginas` (tipo, URL y clave de la estación base de una ficha), `lecturas` (página, contenido, hora y resultado) y `paquetes`.

**La configuración.** `CELDA_INGESTA_ARCHIVO`, por defecto `datos/archivo.sqlite`. El módulo de NixOS lo pone en `/var/lib/<directorioDeEstado>/archivo.sqlite`, y los paquetes van a `<copias.directorio>/archivo/`. En R2, `archivo/` del cubo de `credenciales.r2`, con la misma clave. No hace falta ninguna opción ni credencial nueva.

**Los paquetes.** Cada uno se escribe con otro nombre y se renombra al acabar, así que uno con su nombre está siempre entero. El archivo lo apunta después: si la noche se corta entre medias, el paquete siguiente repite esas filas, y al restaurar se ignoran las que ya están, porque cada fila conserva su número. Un paquete lleva la versión del esquema del archivo, y `restaurar-archivo` rechaza uno de otra versión. La subida compara los nombres de la carpeta con los de `archivo/` en R2 y sube los que faltan, del más viejo al más nuevo.

**Releer.** `releer-archivo` toma la última lectura de cada ficha, de 500 en 500, y la lee con `lecturaDeFicha`. Con `--aplicar` guarda cada ficha leída como si se acabara de leer a la hora de su lectura archivada (`BaseNocturna.aplicarFichaReleida`), salvo si:

- la observación ya no está, o está retirada;
- la observación ha cambiado, o se ha leído su ficha, después de esa lectura, porque entonces la página ya no es lo último que dice el registro;
- su ficha ya se leyó con la versión de la lectura de hoy y no está fallando.

Para un arreglo de la lectura basta con subir `VERSION_DE_LECTURA`, desplegar y lanzar `releer-archivo --aplicar` con la noche parada. Lo que no esté en el archivo, o haya cambiado después, se relee en las noches siguientes como siempre. La fusión y la publicación de lo aplicado las hace la noche siguiente.

**Lo que ocupa.** Con las muestras del registro, una ficha comprimida son unos 2,2 KB, así que las de España son unos 150 MB, más unos 30 MB de URL y claves. Durante la relectura de diez noches, cada paquete son unos 20 MB. Después crece con lo que cambia: unos 40 MB al año de lecturas, los listados que cambian (como mucho unos 100 MB al año si cambiasen todos los cuadros cada semana) y las fichas que cambian. Va una vez en el disco de la base, otra en la carpeta de copias y otra en R2.

## Cómo quedó (fase 2)

**La tabla.** `hechos`, en la versión 8 del esquema de la base: `secuencia` (el orden global), `id` (único: tipo, fecha de la ejecución, fuente y clave), `fuente` y `clave`, `version` (única por registro), `tipo`, `fecha` (la de la ejecución que lo ve, como la de las observaciones) y `datos`, el JSON del hecho con su `forma`. La versión 8 escribe en SQL el punto de partida, un hecho `conocido-antes` por observación con la observación entera, fechado con la menor de la fecha de la observación, la de su ficha, la del último listado que la trajo y la de su marca de sin ficha. Sobre la copia de la base del 30/09/2026 (69.612 registros) la base pasa de 97 a 170 MB.

**Los tipos.** Se escriben con `packages/ingesta/src/hecho.ts` y se leen con `hechos.ts`: `conocido-antes`, `alta`, `listado`, `vuelta`, `ficha`, `sin-ficha` y `retirada`. `listado`, `vuelta` y `ficha` llevan `cambia`: si cambia lo que Celda enseña, y con ello la fecha de la observación. Un hecho con `cambia` a `false` es lo que escribe el registro cuando cambia sin que cambie lo limpio, o la primera vez que Celda lo guarda. `antes` es la última vez que Celda vio lo anterior: el último listado del registro, su última ficha o, en un alta, la última vez que se pidió su cuadro. Sin `antes`, un alta es de un cuadro que se pedía por primera vez. Cada ficha leída lleva `pagina`, el SHA-256 de su página en el archivo, con el `Crypto` de Effect.

**Lo crudo y lo limpio.** El extractor da en cada registro lo que escribió el registro (`crudo`: `id`, `Gis_ID`, `Dirección` y coordenadas) y en cada ficha sus tablas como texto (`cruda`). La observación los guarda. `trasListado` y `trasFicha` (`packages/ingesta/src/guardado.ts`) comparan eso: si el registro escribe lo mismo no hay hecho ni cambia la fecha, aunque la limpieza dé otra cosa. `alDia` vuelve a sacar de lo crudo la compañía, el código, la dirección, el municipio, la URL, las bandas y las medidas cada vez que la fusión lee una observación, así que un arreglo de la limpieza llega en la noche siguiente sin mover ninguna fecha. Lo que se guardó antes del historial no tiene crudo: el primer listado y la primera ficha que lo traen lo guardan con un hecho que no cambia nada, salvo si lo limpio también es distinto.

**La primera ficha de un alta** no cambia la fecha de la observación, que es la del alta, aunque se lea unas noches después: lo que dice ya lo decía el registro cuando apareció.

**Leer los hechos.** `leerHecho` lee cada tipo con su forma sin aceptar claves de más: un hecho que no encaja en su forma, de una forma desconocida o con un listado que lleva a la vez el crudo y el registro falla y no se lee a medias. `repetirHechos` repite el historial de un registro con la limpieza de hoy, y `comprobar-historial` lo compara con lo que publica la tabla de observaciones de cada registro. Sobre la copia del 30/09/2026, con su punto de partida, no hay ninguno distinto.

**En la ficha.** Cada origen del registro oficial lleva `historial`, una lista de `{ tipo, fecha, antes? }` (`HechoDeFicha` en `packages/dominio/src/ficha.ts`) con los tipos `en-el-registro-antes`, `alta`, `cambio-de-listado`, `cambio-de-ficha`, `sin-ficha`, `retirada` y `vuelta`. Los hechos con `cambia` a `false` no se publican. La clave es opcional y el formato no cambia (ADR 0016). `desdeDelOrigen` dice cómo enseñar la fecha del origen: «en el registro antes del <fecha>» si lo último que dice viene del punto de partida o de un alta sin `antes`, y «desde el <fecha>» si no, con `antes` como cota si la hay. La historia de un emplazamiento sale de la de los orígenes de sus estaciones. Con la copia del 30/09/2026, los lotes de fichas pasan de 42 a 46 MB.

## Cómo quedó (fase 3)

**Dónde.** Al guardar cada cuadro (`aplicarCuadro`) se cuentan sus altas, sus cambios y sus vigentes que el listado ya no trae; al cerrar el barrido de una zona (`cerrarBarrido`), sus ausencias. Si pasan del límite (`esCambioMasivo` en `packages/ingesta/src/barrido.ts`: más de 50 y más del 20 % de las vigentes, por defecto), la transacción se deshace y falla con `CambioMasivo`, que cuenta los registros del listado de titulares desconocidos. Un cuadro sin vigentes nunca para. Los cambios de la limpieza no cuentan, porque no son cambios del registro (fase 2).

**Qué se para.** La noche no cierra ningún barrido, no lee fichas, no fusiona, no publica y no lanza el build de Vercel. La ejecución queda fallida con el motivo, el diario lo dice con un error y `Noche.publicacion` es `detenida`. Las copias de la base y del archivo se hacen. Los barridos de otras zonas que acabaron siguen en curso y se cierran la noche que se retomen. La noche siguiente vuelve a pararse mientras el registro siga igual.

**Cuando el cambio es de verdad**, se sube el límite una noche (`CELDA_REGISTRO_CAMBIO_MASIVO_POR_CIENTO`, `registroOficial.cambioMasivo.porCiento` en el módulo de NixOS) y se vuelve a bajar.

**Lo que no cubre.** Un cambio repartido por muchos cuadros, cada uno por debajo del límite, se guarda cuadro a cuadro antes de saberse. Si son ausencias, las para el cierre de la zona; si son cambios o altas, se guardan, con sus hechos, y la noche publica. Un límite por toda la noche necesitaría guardar los cuadros sin confirmar hasta el final.

## Consecuencias

- Un arreglo de la lectura de la ficha se lleva a todas las fichas archivadas en minutos y sin peticiones al ministerio.
- El disco de la máquina guarda el archivo dos veces, en el directorio de estado y en los paquetes de la carpeta de copias. Con 422 GB libres no pesa.
- R2 crece con el archivo y no se recorta solo. Con los 10 GB gratuitos queda lejos durante años, y la alerta de facturación del ADR 0018 avisa si no.
- La orden `capas` del build lista el cubo entero, como antes; los paquetes son uno por noche, así que no la alargan.
- Restaurar el archivo pide bajar todos los paquetes de `archivo/`, o tomarlos de la carpeta de copias, y lanzar `restaurar-archivo`.

## Alternativas descartadas

- **Reconstruir el estado desde los hechos en memoria cada noche**, con event sourcing completo. La noche tiene 512 MB de montón y `observaciones` lleva además la cola de fichas. Los hechos se escriben junto a la tabla, y una prueba comprueba que dicen lo mismo.
- **Las páginas dentro de la base.** Irían en las catorce copias del disco y las catorce de R2, unos 4 GB más, y el `VACUUM INTO` de cada noche las copiaría enteras.
- **Un objeto de R2 por contenido.** Serían más de 70.000 objetos, y la publicación y el build de Vercel listan el cubo entero en cada pasada. Restaurar pediría otras tantas descargas. Un paquete por noche deja un objeto nuevo al día.
- **Otro cubo privado, con su propia clave**, para que la clave de solo lectura del build no lo vea. Pedía credenciales y opciones nuevas antes de que la relectura de España avanzara, y esa clave ya ve la base entera en `copias/`. Se puede mover más adelante.
- **Comprimir con zstd y un diccionario común**, que dejaría cada ficha en una fracción, porque todas comparten la plantilla. gzip se abre con cualquier herramienta, y 150 MB no lo justifican.
- **Guardar solo las lecturas que cambian.** El archivo sería algo más pequeño, pero se perdería la última vez que se vio una página igual, y con ella cuándo cambió.
