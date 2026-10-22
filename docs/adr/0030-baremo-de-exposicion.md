# Baremo de exposición: cada medida del ministerio frente a las de su zona, teniendo en cuenta la distancia

Estado: aceptada el 22/10/2026 con el #86, que la implementa. Decide cómo enseña la ficha las medidas de exposición del ministerio, que el [ADR 0016](0016-capa-por-provincias-con-resumen-nacional.md) dejó en los lotes desde el #73 sin enseñarlas. Las normas y lo que se sabe de las medidas salen de la investigación 09 (`docs/investigacion/reclamaciones-y-exposicion.md`, #79). El glosario gana el nivel de referencia y el baremo de exposición.

## Contexto

Cada estación base de la ficha lleva las medidas de exposición que publica su ficha del registro oficial: la distancia del punto de medida a la estación, en metros, la dirección del punto vista desde la estación y el valor en µW/cm² (`EstacionDeFicha.medidasDeExposicion`). Sin la clave, Celda aún no ha leído su ficha desde el #73. Con la lista vacía, el registro no publica ninguna.

La investigación 09 deja claras cuatro cosas. Las medidas son casi seguro de banda ancha: cada valor suma todo lo que llega a ese punto, de todas las compañías, la radio y la televisión, y por eso la norma lo compara con el nivel de referencia más bajo, 200 µW/cm², el de 10 a 400 MHz, donde está la radio FM (apartados 2.2 y 2.5). Las dos compañías de un emplazamiento compartido no se suman, porque cada valor ya las lleva. El registro no dice si una medida es una comprobación de una Jefatura de Inspección o una certificación de la compañía, ni cuándo se hizo (apartado 2.6). Y nada de eso dice cómo funciona un móvil allí.

Las medidas de la versión del 20/10/2026 son estas:

- 35.717 emplazamientos con 61.259 estaciones base. 60.091 tienen medidas, 1.168 tienen la lista vacía y ninguna está sin leer.
- 273.982 medidas por estación base y 244.227 por emplazamiento: dos estaciones base del mismo emplazamiento publican a menudo la misma medida, con la misma distancia, el mismo acimut y el mismo valor, y es una sola. 17.375 emplazamientos tienen medidas de más de una compañía; en 2.825 todas publican las mismas, y en 3.497, parte.
- Los valores van de 0 a 49,93 µW/cm², con la mediana en 0,178 y el percentil 95 en 2,40. Hay 169 medidas de 0. Ninguna llega a 50: 134 quedan entre 45 y 49,93, y Celda no recorta nada al leerlas. No se sabe por qué; el extremo alto no se toma como exacto.
- El 99 % de las medidas está a 100 m o menos de su estación, el entorno de 100 m de la Orden CTE/23/2002. La mediana es 47 m. 48 medidas están a menos de 1 m, casi todas con el acimut a 0.

Las medidas bajan con la distancia, y no se puede comparar una tomada en la misma azotea con una de la calle de enfrente. Medianas por tramos de distancia, en toda España: 1,06 µW/cm² de 1 a 5 m, 0,55 de 5 a 10, 0,24 de 10 a 20, 0,19 de 30 a 40 y 0,14 de 80 a 110. Cerca de la antena también se separan más unas de otras: la mitad central de los valores, en decibelios, ocupa unos 15 dB a menos de 10 m y unos 8 dB a más de 20.

## Decisión

### Qué enseña la ficha

- **Una sección «Medidas de exposición»** tras la de las bandas, con una tabla por compañía: la distancia, la dirección del punto de medida vista desde la antena, en ocho direcciones (`nombreRumbo`), y el valor en µW/cm². Con el baremo de su provincia, cada medida lleva además la típica de su zona a esa distancia y «Más alta que», cuántas de cada 100 medidas de la zona quedan por debajo.
- **Una frase con la más alta del emplazamiento** frente a 200 µW/cm²: «La medida más alta es de 2,15 µW/cm², el 1,1 % de 200 µW/cm²». Con el baremo sigue «Teniendo en cuenta la distancia a la antena, es más alta que 95 de cada 100 medidas de la provincia de Barcelona y unas 11 veces la típica». Las veces solo se dicen desde 2, que es lo menos que permite la frase.
- **Por qué 200.** «Cada medida suma todo lo que llega a ese punto, de todas las compañías y también de la radio y la televisión, y por eso la norma la compara con 200 µW/cm², su nivel de referencia más bajo». En un emplazamiento con medidas de más de una compañía sigue «Por lo mismo, las de dos compañías no se suman». El nivel de referencia se subraya y lleva su explicación en el glosario.
- **Quién y para qué.** «Son comprobaciones de las Jefaturas de Inspección o certificaciones de las compañías, y el ministerio no dice cuál es cada una ni cuándo se hizo. Sirven para comprobar que se cumple el límite legal y no dicen nada de cómo funciona un móvil allí».
- **Una estación base sin medidas** lo dice como las bandas, con la misma función (`faltaDe` en `apps/web/src/ficha/textos.ts`): «Celda aún no ha leído sus medidas de exposición en el registro oficial» sin la clave, «El registro oficial no publica sus medidas de exposición» con la lista vacía, y lo mismo que con las bandas si el registro no tiene su ficha o la estación base no está en el registro. La sección sale siempre: en un emplazamiento sin ninguna medida, con esas frases y sin tablas, porque saber que el registro no publica ninguna también es un dato.
- **Una zona con medidas de pocos emplazamientos** lo dice en una frase: «Celda no las compara con las de su zona porque en Ceuta hay medidas de pocos emplazamientos». Sin baremo, porque no ha llegado o porque esa versión no lo tiene, las medidas se ven igual y sin comparar, sin ninguna frase.

### El modelo

Cada medida es un punto con `x = log10(distancia en m)` e `y = 10 · log10(µW/cm²)`, en dB respecto a 1 µW/cm² (`puntoDeMedida` en `packages/dominio/src/baremo.ts`). Con las medidas de cada provincia:

1. **Lo típico a cada distancia** es la recta de mínimas desviaciones absolutas de `y` sobre `x`: la que hace mínima la suma de las distancias en vertical a los puntos. Deja la mitad de las medidas por encima y la mitad por debajo, así que es una mediana que cambia con la distancia, y unas pocas medidas extremas o de 0 no la mueven. Una caída en potencia de la distancia es lo más sencillo que sigue a los datos sin cortes. En las provincias de Barcelona y Madrid, la mediana de lo que se aparta de la recta cada tramo de distancia queda a menos de 0,9 dB de 5 a 100 m, donde están el 98 % y el 97 % de sus medidas. Se aparta más en los extremos, con pocas medidas: −1,4 dB en las 212 de Barcelona de 2 a 5 m y −4,2 dB en sus 35 a menos de 2 m.
2. **Cuánto se apartan de lo típico** es otra recta igual, sobre `log10` de la distancia de cada punto a la primera: lo que se aparta la mitad de las medidas a cada distancia, que nunca da negativo. En la provincia de Barcelona son 5,6 dB a 1 m y 3,9 dB a 100 m.
3. **La desviación** de una medida es lo que se aparta de lo típico a su distancia, en unidades de lo que se aparta allí la mitad (`desviacionDe`).
4. **Cada zona** guarda las desviaciones de los percentiles 1 a 99 de sus medidas, por rango más próximo. Una medida es más alta que tantas de cada 100 como cortes de su zona quedan por debajo de su desviación (`compararMedida`). La típica de la zona a su distancia es lo típico de la provincia más su separación por la mediana de las desviaciones de la zona: en un municipio por encima de su provincia, lo típico allí sale más alto.

Las rectas se calculan con el método de descenso de Wesolowsky (1981): la mejor recta por un punto tiene la mediana ponderada de las pendientes hacia los demás; si pasa por otro punto con menos suma, se repite desde él, y si no, es la mejor, porque la suma es convexa. Con cada provincia converge en 3 a 12 pasos. Una prueba la compara con la mejor de todas las rectas por dos puntos en 200 conjuntos al azar.

**Una recta por provincia.** Un municipio tiene pocas medidas para sacar su propia caída con la distancia: las 137 de Gavà dan una pendiente de −0,7 dB por década, y +0,8 por mínimos cuadrados, frente a −2,4 con las 19.595 de la provincia de Barcelona. Tampoco vale una sola para España, porque las pendientes van de −10,5 a −1,1 dB por década según la provincia, con la mediana en −3,9. La provincia da la forma, y cada zona, su nivel y su reparto.

**La separación hace falta.** Con lo típico y sin la separación, las medidas cercanas a la antena, que se separan más, quedan arriba o abajo del todo más veces de las que deberían. Con las medidas del 20/10/2026, cada una frente a su provincia, de cada 100 en un tramo de distancia deberían quedar 5 por encima del percentil 95 y 5 por debajo del 5:

| Distancia | Medidas | Sin la separación, ≥ 95 | Sin la separación, < 5 | Con la separación, ≥ 95 | Con la separación, < 5 |
|---|---|---|---|---|---|
| Menos de 5 m | 3.349 | 15,2 % | 11,2 % | 6,7 % | 5,0 % |
| De 5 a 10 m | 8.538 | 16,8 % | 8,9 % | 8,2 % | 5,0 % |
| De 10 a 20 m | 22.705 | 7,4 % | 7,8 % | 5,8 % | 5,5 % |
| De 20 a 40 m | 62.392 | 4,0 % | 5,5 % | 3,8 % | 5,1 % |
| 40 m o más | 147.243 | 4,1 % | 4,0 % | 5,1 % | 4,9 % |

Los tramos de la tabla solo sirven para comprobarlo: el baremo no tiene ninguno. Queda algo de más por arriba de 5 a 10 m, un 8,2 %, porque la separación cae con la distancia más deprisa cerca de la antena que lo que da una recta.

### La zona

La zona de un emplazamiento es su municipio si tiene medidas de al menos 97 emplazamientos; si no, su provincia, con el mismo mínimo; y si tampoco, no se compara. Nunca toda España.

**Por qué 97 emplazamientos.** La frase da una proporción, «más alta que 95 de cada 100». Con `n` observaciones independientes, el intervalo del 95 % de una proporción `p` mide ±1,96 · √(p(1−p)/n), y es más ancho en la mitad, p = 0,5. Para que quede dentro de ±10 puntos hacen falta 1,96² · 0,25 / 0,1² = 96,04, es decir, 97. En los extremos, donde la frase importa más, el margen baja: en p = 0,95 son ±4,3 puntos. Las medidas de un mismo emplazamiento se parecen mucho entre sí: la correlación dentro del emplazamiento de lo que se aparta cada una de lo típico es 0,47, con 7,46 medidas por emplazamiento de media, un efecto de diseño de 4,0. Por eso la cuenta va por emplazamientos, como si cada uno fuera una sola observación.

Con las medidas del 20/10/2026 son zona 32 municipios, que reúnen 55.546 de las 244.227 medidas, el 23 %: entre ellos Madrid, con 1.998 emplazamientos, Barcelona, con 988, València, con 512, Sevilla, con 459, Zaragoza, con 434, y Málaga, con 414. Lo son también 50 provincias. Ceuta, con 35 emplazamientos con medidas, y Melilla, con 28, no se comparan.

**Ejemplo.** El emplazamiento compartido de C/ Sant Lluís 52, en Gavà (Orange CATR1012D y Vodafone 140636). Gavà tiene medidas de 19 emplazamientos, así que la zona es la provincia de Barcelona, con 19.595 medidas de 2.865 emplazamientos. Las dos más altas de Orange, 2,15 µW/cm² a 55 m y 1,86 µW/cm² a 100 m, son más altas que 95 de cada 100, unas 11 veces la típica a su distancia, 0,20 y 0,175 µW/cm². Las de Vodafone, 0,46 µW/cm² a 69 m y 0,45 µW/cm² a 100 m, son más altas que 73 y que 75 de cada 100. Con un solo tramo fijo de 40 m en adelante darían 96, 95, 73 y 73.

### Las constantes

Todas están en `packages/dominio/src/baremo.ts` y `packages/publicacion/src/baremo.ts`:

- **1 m de distancia mínima** (`DISTANCIA_MINIMA_METROS`). El logaritmo de 0 no existe, y el registro da las distancias en metros: una medida a menos de 1 m cuenta como tomada a 1 m. Son 48.
- **0,00001 µW/cm² de valor mínimo** (`VALOR_MINIMO`), la última cifra que publica el registro, para tomar el logaritmo de una medida de 0. Las rectas y los percentiles solo dependen del orden de las medidas, así que el resultado es el mismo con cualquier valor por debajo del menor publicado, 0,00003. Una medida de 0 queda siempre la más baja.
- **0,01 dB de separación mínima** (`SEPARACION_MINIMA_DB`), para el logaritmo de lo que se aparta una medida que cae justo en la recta. Por lo mismo, no cambia el resultado mientras quede muy por debajo de la separación, que es de unos dB.
- **97 emplazamientos** (`EMPLAZAMIENTOS_MINIMOS`), por la cuenta de arriba.
- **99 cortes** (`CORTES`), los percentiles 1 a 99, porque la frase dice «de cada 100».
- **Dos decimales** en los números del fichero. 0,01 dB es la décima parte del paso con que se publican los valores, 0,01 V/m, que en 1 V/m son unos 0,09 dB. Las rectas se redondean antes de calcular las desviaciones, así que la web, que las lee redondeadas, da las mismas.
- **El formato del baremo** (`FORMATO_DEL_BAREMO`, 1), abajo.

### Dónde se calcula

Lo calcula el montaje de las capas (`montarCapas`), en el build de Vercel y en `apps/web/scripts/sitio.sh`, con `montarBaremos` de `packages/publicacion/src/baremo.ts`. Tras copiar y comprobar los ficheros de R2, lee los lotes de fichas de la versión vigente, que ya están en `dist/capas`, y escribe un fichero por provincia con medidas, `baremos/<formato>/<sello de la versión>/<provincia>.json` (`ficheroDeBaremo`), antes de `vigente.json`. Es lo único de `/capas` que no sale tal cual de R2.

- **Por qué en el montaje.** Ya lee todos los lotes de la versión, así que no hace falta otra lectura ni otro fichero en R2, y la ingesta y el formato de la capa no cambian. Cambiar el cálculo no pide otra ejecución de la ingesta ni otra publicación.
- **Solo la vigente.** Las anteriores que se montan pueden tener lotes de otro formato, que este cálculo no lee. Una pestaña abierta con un `vigente.json` viejo pide el baremo de su versión, recibe un 404 y enseña las medidas sin comparar.
- **Cuánto ocupa.** Con la versión del 20/10/2026, 52 ficheros, 58 KB en total y 27 KB con gzip. El mayor, el de Madrid, 2 KB, 0,8 KB con gzip. Leer los 306 lotes cuesta unos 1,8 s y calcular los 52 baremos, 1,3 s.
- **La web** pide el baremo de la provincia al abrir una ficha con medidas, una vez por visita (`FichasPublicadas.baremo`). Mientras no llega, la ficha enseña las medidas sin comparar y no espera a nada (`loadingValue` en `apps/web/src/ficha/Exposicion.tsx`). Un 404 se guarda como que no hay baremo; un fallo de la red no se guarda, y la próxima ficha que se abra lo vuelve a pedir.
- **Mismo resultado.** Los mismos lotes dan los mismos bytes, en cualquier orden. Una prueba lo comprueba barajando las medidas.

### El despliegue (#78)

La señal de los datos compara el `vigente.json` y los manifiestos que montaría un build nuevo con los que sirve producción. El baremo no hace falta compararlo: sale de los lotes que lista el manifiesto de la vigente y del cálculo. Si cambian los lotes, cambia el manifiesto. Si cambia el cálculo, sube `FORMATO_DEL_BAREMO`, que va en el nombre con que la web pide los baremos, así que cambia lo construido y la señal de la web lanza el despliegue. Para que nadie lo olvide, una prueba de `packages/publicacion/src/baremo.test.ts` apunta la huella del baremo de una provincia sintética para cada formato, y falla si el cálculo cambia sin subirlo. Por lo mismo, la caché inmutable de `/capas` le sirve: un nombre con su formato y su versión tiene siempre el mismo contenido.

### Si no se puede calcular

Si falta un lote de la vigente o no se entiende, el build falla, como cuando falta un fichero de R2, y Vercel sigue sirviendo el despliegue anterior entero. Un lote que no se entiende tampoco lo leería la web. Montar sin baremo sería peor: la señal de los datos no lo vería, y la comparación se quedaría sin salir hasta la siguiente versión de los datos, un mes después, sin que nadie se enterase. Con el build fallido, el flujo de despliegue lo intenta otra vez al día siguiente y su registro dice por qué falla.

### Lo que Celda no dice

- Nunca dice que una medida o una antena sea segura o peligrosa. Dice cuánto es frente a 200 µW/cm² y cómo queda entre las medidas publicadas de su zona.
- Nunca dice ni da a entender que una medida alta sea más cobertura o más señal. Cada medida suma todo lo que llega a ese punto, de cualquier compañía, la radio y la televisión, y se tomó para comprobar el límite legal.
- La comparación es con las medidas que publica el registro, y no con la exposición en cualquier punto de la zona. Las elige quien mide, en los puntos de más exposición entre los sitios donde suele haber gente, y sin fecha.
- Las cifras son de una versión de los datos: con otra, el baremo cambia.

## Consecuencias

- `/capas` deja de ser una copia exacta de R2: lleva además `baremos/`. La prueba de `apps/nocturna/src/vercel.test.ts` y la de la máquina virtual comprueban que todo lo demás sigue igual byte a byte que R2 y que el baremo de la vigente está y no está en R2.
- Cambiar el cálculo pide subir `FORMATO_DEL_BAREMO` y apuntar la huella nueva en su prueba.
- Una pestaña abierta antes de un despliegue con datos nuevos enseña las medidas sin comparar hasta que se recarga.
- La mayoría de las fichas se comparan con su provincia: solo 32 municipios tienen medidas de bastantes emplazamientos.

## Alternativas descartadas

- **Tramos fijos de distancia**, como de 40 a 110 m. Cada borde es una elección, una medida a 39 m y otra a 41 m quedarían en tramos distintos, y cada tramo necesita su propio mínimo de medidas. Las medidas a menos de 10 m no llegan a 100 en 22 provincias.
- **Una recta por municipio**, por lo que se ha visto con Gavà. **Una sola recta para España**, por lo que cambian las pendientes de una provincia a otra.
- **Mínimos cuadrados.** La recta saldría de la media de los logaritmos, y una medida de 0, que cuenta como −50 dB, la movería tanto más cuanto menos medidas haya. La de mínimas desviaciones solo mira el orden.
- **Comparar con las medidas más cercanas en distancia**, sin recta. En un municipio con pocas más medidas que el mínimo, serían casi todas las suyas, y la distancia apenas contaría.
- **Contar medidas en lugar de emplazamientos.** Con 97 medidas serían zona 391 municipios, pero las medidas de un emplazamiento se mueven juntas. Con el efecto de diseño medido, unas 391 medidas, serían 69. Contar emplazamientos es más sencillo, no depende de una correlación medida en una fecha y se queda del lado prudente.
- **Calcularlo en la ingesta y guardarlo en R2.** Entraría en los manifiestos y en la señal de los datos, pero cambiar el cálculo pediría otra publicación de toda España.
