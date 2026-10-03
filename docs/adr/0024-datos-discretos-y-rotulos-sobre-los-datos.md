# Datos discretos: hexágonos más pequeños de lejos, rótulos por población, sin ausencias en el mapa

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 02 y el 03/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign`; su veredicto está en `PROTOTIPO.md` (e0b75de) y cada punto cita el commit que lo probó. Cambia del [ADR 0016](0016-capa-por-provincias-con-resumen-nacional.md) el zoom del resumen nacional (hasta z9 en lugar de z8) y el sitio del hexágono de cada provincia; del [ADR 0017](0017-provincias-y-municipios-con-el-padron-del-ine.md), qué municipios son zona en z9 y z10, y sustituye sus ausencias en el mapa (también las de los #44 y #53). Lo llevan a cabo dos tickets: la agrupación con los choques y el centro visual, y la retirada de las ausencias.

## Contexto

Con toda España en el mapa, los hexágonos de Celda tapaban los nombres de las ciudades: en el móvil a z5,5, los 50 × 56 px de cada hexágono de provincia, y en Cataluña a z8, las agrupaciones. Con el mapa base del ADR 0022 los rótulos de lugar son lo que deja orientarse, así que ese choque pesa más.

## Decisión

### D1 «Datos discretos» (9d47710, gana en 54f3339)

- **Hexágonos más pequeños y algo translúcidos de lejos:** a 0,62 de su tamaño por debajo de z9, a 0,8 en z9 y z10 y a 0,88 en z11 y z12. Los logos no cambian de tamaño. La cinta del nombre va siempre a 0,85.
- **El resumen nacional llega hasta z9**: un hexágono por provincia por debajo de z9, y el detalle de las provincias desde z9.
- **En z9 y z10 solo son zona los municipios grandes**: los de 50.000 habitantes o más en z9 y los de 20.000 o más en z10, con 4 emplazamientos o más (`MINIMO_DE_ZONA`). El resto de emplazamientos va en agrupaciones de 120 px, el doble del radio de siempre. Desde z11, los municipios son zona como dice el ADR 0017 (#53).
- **Los rótulos de lugar van por encima de los datos.** MapLibre coloca los rótulos de ciudad en capas transparentes y Celda los copia en el DOM, encima de los marcadores. Los demás rótulos del mapa base esquivan los marcadores con huecos invisibles en una fuente GeoJSON.

### Choques entre rótulos y hexágonos, por población (944bdf8, ajustado en e0b75de)

Al pararse el mapa, Celda decide qué se dibuja en este orden:

1. Logos, agrupaciones y barrios se colocan primero y no ceden nunca.
2. Hexágonos de zona y rótulos de ciudad, de más a menos habitantes del padrón del INE: el de la provincia, el del municipio o el de la ciudad del rótulo. Un rótulo que no casa con ningún municipio, como uno de fuera de España, cuenta 0. Lo que pisa algo ya colocado no se dibuja y sale al acercar.
3. Las cintas con el nombre de la zona van al final. Ganan a los rótulos con menos habitantes que su zona y nunca esconden un hexágono; si chocan con uno, la zona va compacta, sin cinta. La caja de la cinta se calcula a 0,85, como se dibuja, con 3 px de holgura.

Nada se aparta de su sitio para hacer hueco.

### El hexágono de cada provincia, en su centro visual (e0b75de)

- Va en el polo de inaccesibilidad (polylabel) de la provincia, calculado en Mercator, que es como se ve el mapa: el punto más alejado de sus bordes. El polígono sale de los límites del IGN del repositorio (ADR 0017), simplificados a 300 m para el cálculo, con 200 m de precisión.
- Si la provincia tiene varios polígonos, se usa el más poblado, el que contiene más habitantes del padrón por la etiqueta de sus municipios: Mallorca, Tenerife y Gran Canaria (Fuerteventura es mayor, pero tiene 129.541 habitantes frente a 870.608). En A Coruña, Pontevedra y Cádiz, la península.
- **El rótulo de la capital solo se esconde si se llama como su provincia y la cinta de la provincia se ve**: València, Alacant, Soria, Madrid, Zaragoza, Badajoz, Cáceres, Cádiz, A Coruña, Santa Cruz de Tenerife, Ceuta. Si la provincia va compacta, el rótulo vuelve si no pisa nada. Las demás capitales siguen la regla de la población: Pamplona, Vitoria-Gasteiz, Castelló de la Plana, Oviedo, Palma.

### Sin ausencias en el mapa (54f3339)

Ya no sale la cinta «sin [logo]» en ningún zoom, ni en provincias, ni en municipios, ni en barrios, y el nombre accesible de una zona deja de decir «sin Digi». Celda enseña emplazamientos, no cobertura. Que una compañía no tenga emplazamientos en una zona no quiere decir que no haya servicio: Yoigo es una marca de MasOrange y tiene cobertura en toda España, y Digi usa la red de Movistar en itinerancia donde no tiene emplazamientos propios. Los datos se quedan (`resumirBarrios` en `barrio.ts`, `resumirMunicipios` y `ausentesDeProvincia` en `zona.ts`), pero el mapa no los dibuja. El ejercicio de emplazamientos nunca los usó.

### Sin rótulos de fuera de España por debajo de z9 (944bdf8)

Los rótulos de lugar de Portugal, Francia, Andorra, Marruecos y Argelia salen desde z9. Lo hace un filtro `within` con el contorno de España del IGN simplificado a 400 m (24 KB con gzip). «Gibraltar» no sale en ningún zoom.

## Números

En las seis vistas del móvil (390 × 844: España z5,5, Navarra z7, Valencia z8, Extremadura y Andalucía occidental z7, Canarias z7 y Barcelona z12), antes y con D1, y tras acercar y alejar sobre Navarra (z9,5, 11,5, 8,2, 12,5 y 6,5), con el mapa quieto 20 s: 0 peticiones, 0 `render` de MapLibre y 0 llamadas a fetch, XHR, `requestAnimationFrame`, `setTimeout`, `setInterval` y `postMessage`. La consola no da errores. Las pruebas de la rama (519 de la web, 249 de dominio y 110 de ui) pasan.

## Consecuencias

- **Lo que queda abierto en el prototipo:**
  - En València a z8 la ciudad de València no tiene nombre. Su rótulo se esconde porque se llama como la provincia y la cinta de la provincia se ve, pero el hexágono de la provincia está en su centro visual, a unos 40 km tierra adentro. Arreglo recomendado, pendiente de que el usuario lo confirme: una jerarquía tipográfica en la que los nombres de provincia y de zona son nombres de área, en versalitas espaciadas, los de ciudad siguen como rótulos de población, y el rótulo de la capital no se esconde nunca.
  - En Barcelona a z12 no sale el rótulo «Barcelona»: lo pisan agrupaciones, que no ceden nunca.
  - A z5,5 Valladolid y Murcia van compactas y sin nombre: su cinta pisaría Segovia o Alacant, y su rótulo de ciudad también choca. Álava no se dibuja, porque Bizkaia tiene más habitantes. Todo sale al acercar.
  - Los rótulos que Celda copia en el DOM no esquivan el borde de la pantalla: en Canarias a z7 se lee «Las Palmas de Gran Canar».
- Las zonas fronterizas se ven vacías de lejos: por debajo de z9 no hay nombres al otro lado de la frontera.
- En z9 y z10 cambian los niveles de zona, y la prueba que recorre los zooms del 5 al 18 (`CapaAgrupada.test.tsx`, #53) tiene que seguir pasando: ningún emplazamiento fuera de un hexágono con su número o de un logo, y nada que aparezca al acercar sin salir de lo que se veía. En el prototipo, al entrar o salir de z9 y z10 lo nuevo aparece en su sitio sin deslizarse.
- El punto de etiqueta de cada provincia en el resumen nacional también decide a qué provincia van los emplazamientos sin provincia (ADR 0016). El centro visual no lo sustituye ahí.
- Una zona sin ausencias tiene menos que decir en su cinta, y el umbral de 10 emplazamientos para enseñarlas (`UMBRAL_DE_AUSENCIAS`, ADR 0017) deja de usarse en el mapa.

## Alternativas descartadas

- **D2 «Nombres primero»** (9d47710). Sin hexágonos hasta z12: «Soria · 210» de z5 a z7 y «Medinaceli · 3» de z8 a z11. A z8 el mapa se volvía una lista de nombres con números. Salió del código en 54f3339.
- **El hexágono de la provincia en su capital** (944bdf8). Las ciudades desaparecían bajo su hexágono, y en Badajoz, Cádiz y A Coruña el hexágono caía en el borde de la provincia o en el mar.
- **El centroide geométrico.** En una provincia con islas o con forma cóncava puede caer en el mar o fuera de ella. El polo de inaccesibilidad queda siempre dentro del polígono.
- **Apartar los rótulos para que quepan** (`apartarRotulos`, 9d47710). Se quitó en 944bdf8: nada se mueve de su sitio, así que un nombre o un número está siempre donde está lo que nombra.
- **Mantener las ausencias en provincias y municipios con 10 emplazamientos o más** (ADR 0017). Dicen «sin Yoigo» en sitios donde Yoigo da servicio.
