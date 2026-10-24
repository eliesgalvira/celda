# Investigación 10 · Distancias de referencia entre el móvil y un emplazamiento

> **Qué usa Celda (24/10/2026).** El plegable «¿A qué distancia de una antena llega bien la señal?» de «Mejorar la señal» (`apps/web/src/mejorar/distancias.ts`) enseña dos gráficas: la tabla A, con la distancia entre emplazamientos por entorno, y la tabla C, con lo que se pierde en interiores. La fila «A 10–15 m de la ventana», de 14 a 22 dB, suma la de junto a la ventana y los unos 6 dB de ir hacia dentro. La respuesta de arriba sale de la frase propuesta 3. Ninguna da una distancia buena, por lo que explica el apartado «Lo que no está bien respaldado».

Investigación del 22/10/2026 para sustituir en «Mejorar la señal» los umbrales a ojo («a 270 m la señal suele llegar con fuerza», «a más de 1 km llega más débil»). Uso solo fuentes primarias o de alta confianza, y la GSMA porque se pidió expresamente. Las citas van en su idioma original y todos los enlaces se comprobaron el 22/10/2026 contra la copia descargada, salvo los de Ofcom, que bloquea las peticiones automáticas.

Ninguna fuente publica una tabla «entorno × banda → distancia» medida en redes reales. Está bien documentado cuánto separan 3GPP y la UIT los emplazamientos en cada entorno típico, en qué orden llegan las bandas y cuánto se pierde al entrar en un edificio. Las tablas siguientes recogen solo eso.

## Resumen para una gráfica

### A. Distancia típica entre emplazamientos por entorno (escenarios de 3GPP y la UIT)

Son rejillas hexagonales de un solo operador que 3GPP y la UIT usan para evaluar 4G y 5G. Las redes españolas reales tienen otra forma y nadie publica su espaciado. En una rejilla así ningún punto queda a más de D/√3 del emplazamiento más cercano, siendo D la distancia entre emplazamientos, y de ahí sale la tercera columna.

| Entorno | Distancia entre emplazamientos | Lo más lejos que se queda alguien | Bandas que asume la fuente | Fuentes |
|---|---|---|---|---|
| Centro urbano denso | 200 m | ≈ 115 m | ~3,5–4 GHz | F1 §6.1.2; F4 «Dense Urban-eMBB»; F3 tabla 7.2-1 nota 1 |
| Ciudad | 500 m (las fuentes admiten de 200 a 750 m) | ≈ 290 m (de 115 a 430 m) | 2 GHz; también 700 MHz y ~4 GHz | F1 §6.1.4; F3 tabla 7.2-1; F4 «Urban Macro–mMTC»; F5 tabla 8-4; F2 tabla 12.1 (750 m) |
| Afueras y pueblos (casas bajas, bloques de pocas plantas) | ≈ 1,3 km (de 1,2 a 1,8 km) | ≈ 750 m (de 700 m a 1 km) | 2 GHz | F5 tablas 8-2 y 8-4, anexo 1 §1.2.1.2; F3 tabla 7.2-5 |
| Campo | 1,7 km | ≈ 1 km | 700–800 MHz; también ~4 GHz con antenas de muchos elementos | F1 §6.1.3; F3 tabla 7.2-3; F4 «Rural-eMBB»; F5 tabla 8-4 |
| Campo muy poco poblado | 5–6 km | ≈ 2,9–3,5 km | 700 MHz (con 2 GHz en F1) | F1 §6.1.3 «ISD 2»; F3 tabla 7.2-3; F4 configuración C (6000 m) |

Los escenarios rurales de 3GPP a ~4 GHz suponen paneles de hasta 256 elementos (F1 tabla 6.1.3-1). Con ellos no se puede decir que 3500 MHz llegue lo mismo que 700 MHz.

### B. Las bandas ordenadas por alcance (de más a menos)

700 → 800 → 900 → 1800 → 2100 → 2600 → 3500 MHz. Todas las fuentes coinciden en el orden (F2, F6, F7, F8, F10). El multiplicador cambia mucho de una fuente a otra, así que la gráfica debería enseñar solo el orden. Estas son las cifras de cada fuente.

| Comparación | Cifra | Condiciones | Fuente |
|---|---|---|---|
| 900 MHz frente a 2000 MHz | la misma pérdida a ≈ 1,55 veces la distancia (7,2 dB) | ciudad, sin visión directa, fórmula de 3GPP (cálculo propio) | F2 §4.5.2 |
| 700 MHz frente a 3500 MHz | la misma pérdida a ≈ 2,3 veces la distancia (14,0 dB) | ciudad, sin visión directa, antena a 25 m, fórmula UMa de 3GPP (cálculo propio) | F3 tabla 7.4.1-1 |
| 1800 MHz frente a 3500 MHz | la misma pérdida a ≈ 1,4 veces la distancia (5,8 dB) | ídem | F3 tabla 7.4.1-1 |
| 700 MHz frente a 1800 MHz | 2,6 veces más lejos (13,4 dB) | campo abierto, modelo Okumura-Hata | F8 cap. 02 |
| Distancia relativa a 2600 MHz | 2100: 1,2×; 1800: 1,4×; 900: 2,9×; 700: 3,7× | campo abierto, modelo | F8 fig. 2 |
| Población cubierta con los mismos 12 000 emplazamientos, interior poco profundo, la mitad más densa del Reino Unido | 800 MHz 97 %, 1800 MHz 93 %, 2600 MHz 88 % | simulación de Ofcom, LTE 2×10 MHz | F7 §A7.78 |
| Lo mismo en interior profundo (10–15 m dentro) | 800 MHz ≈ 96 %, 1800 MHz ≈ 86 %, 2600 MHz ≈ 78 % | ídem | F7 §A7.80 |

Para 3500 MHz solo hay factores relativos como los de la fórmula UMa. Ninguna fuente fiable le da un alcance en metros.

### C. Lo que se pierde al entrar en un edificio

| Situación | Pérdida típica | Fuente |
|---|---|---|
| Edificio corriente, junto a una ventana o pared exterior | ≈ 8–16 dB | F7 tabla A8.21 («shallow»); F3 modelo de baja pérdida (10–13 dB); F9 mediana tradicional (14–16 dB) |
| Edificio corriente, 10–15 m hacia dentro | unos 6 dB más | F7 §A8.127 (0,6 dB/m); F3 (0,5 dB/m) |
| Edificio con vidrio metalizado y mucho aislamiento | ≈ 18–32 dB | F3 modelo de alta pérdida (18–28 dB); F9 mediana eficiente (≈ 31 dB) |
| Dentro de un coche | ≈ 9 dB | F3 §7.4.3.2; F5 tabla 8-2 |
| Cifra única que usa un regulador para «interior» | 10 dB (Ofcom) | F12 nota 8 |

Diez decibelios menos equivalen a una décima parte de la potencia. El tipo de edificio pesa más que la banda (F9).

## Fuentes

### F1. 3GPP TR 38.913 v19.0.0 (ETSI TR 138 913, 2025-10), §6.1 escenarios de despliegue

URL: https://www.etsi.org/deliver/etsi_tr/138900_138999/138913/19.00.00_60/tr_138913v190000p.pdf

Define los escenarios con los que se evaluó 5G NR. Estas son sus distancias entre emplazamientos (ISD) en rejilla hexagonal.

- §6.1.2, tabla 6.1.2-1 «Attributes for dense urban». En la fila «ISD» pone «Macro layer: 200m», con frecuencia «Around 4GHz + Around 30GHz».
- §6.1.3, tabla 6.1.3-1 «Attributes for rural scenario». En «Carrier Frequency» pone «Around 700MHz or Around 4GHz (for ISD 1)» y «Around 700 MHz and Around 2 GHz combined (for ISD 2)». En «ISD» pone «ISD 1: 1732m» y «ISD 2: 5000m». El texto dice «The rural deployment scenario focuses on larger and continuous coverage.»
- §6.1.4, tabla 6.1.4-1 «Attributes for urban macro». En «Carrier Frequency» pone «Around 2 GHz or Around 4 GHz or Around 30 GHz», en «ISD» pone «500m» y entre los usuarios hay un «80% Indoor in houses».

La nota 1 de cada tabla avisa de que «The options noted here are for evaluation purpose, and do not mandate the deployment of these options or preclude the study of other spectrum options.» Son supuestos de simulación que la industria pactó para comparar tecnologías.

En una rejilla hexagonal con distancia D entre emplazamientos, ningún punto queda a más de D/√3 del emplazamiento más cercano. Con 200 m sale ≈ 115 m, con 500 m ≈ 290 m, con 1732 m ≈ 1000 m y con 5000 m ≈ 2,9 km.

### F2. 3GPP TR 36.942 v19.0.0 (ETSI TR 136 942, 2025-10), §4.4, §4.5, §6.1, §12.1

URL: https://www.etsi.org/deliver/etsi_tr/136900_136999/136942/19.00.00_60/tr_136942v190000p.pdf

Estudia con simulaciones la coexistencia radio de LTE. Sirven estos puntos.

- §6.1, tabla 6.1 «Summary of simulation scenarios». A «2000 MHz» en «Urban Area» le da «Cell Range 500 m», y a «900 MHz» en «Rural Area» le da «2000 m». En §12.1.1, tabla 12.1, a «2000 MHz» en «Urban Area» le da «ISD 750 m» y «Cell Range 500 m».
- §7.1.3.4 compara «cell ranges of 500m, 2000m and 5000m in urban and rural area environment».
- §4.5.2 da el modelo urbano de macrocélula, válido «in urban and suburban areas outside the high rise core»: «L = 40·(1 − 4·10⁻³·Dhb)·log10(R) − 18·log10(Dhb) + 21·log10(f) + 80dB». Con la antena 15 m sobre los tejados queda «L = 120,9 + 37,6log10 (R)» a 900 MHz y «L = 128,1 + 37,6log10 (R)» a 2000 MHz, con R en km.
- §4.5.2 añade que «After L is calculated, log-normally distributed shadowing (LogF) with standard deviation of 10dB should be added». La nota 1 dice «This model is valid for NLOS case only and describes worse case propagation» y la nota 3 «This model is designed mainly for distance from few hundred meters to kilometres. This model is not very accurate for short distances.»
- §4.5.3 da el modelo rural (Hata) a 900 MHz con antena a 45 m: «L = 95,5 + 34,1log10 (R)».

Las dos cuentas siguientes salen de esas fórmulas y no aparecen en el documento.

- Pasar de 900 a 2000 MHz añade 7,2 dB de pérdida en ciudad. Con la pendiente de 37,6 dB por década, a 900 MHz se llega a la misma pérdida a unas 1,55 veces la distancia que a 2000 MHz (10^(7,2/37,6)).
- Una desviación de 10 dB por sombras equivale a multiplicar o dividir la distancia por unos 1,8 (10^(10/37,6)). Dos puntos a la misma distancia del mismo emplazamiento pueden recibir señales muy distintas.

### F3. 3GPP TR 38.901 v19.5.0 (ETSI TR 138 901, 2026-09), §6.2, §7.2, §7.3, §7.4.3

URL: https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/19.05.00_60/tr_138901v190500p.pdf

Es el modelo de canal de 3GPP para 0,5 a 100 GHz y el documento más reciente de esta lista (septiembre de 2026).

**Distancias entre emplazamientos** (§6.2 y §7.2).

- §6.2 (2), UMa (macro urbana): «the BSs are mounted above rooftop levels of surrounding buildings. Example: [Tx height:25 m, … ISD: 200 m, 500 m]». La tabla 7.2-1 da «Hexagonal grid, 19 macro sites, 3 sectors per site (ISD = 500 m, see note 1)», con «NOTE 1: UMa scenarios with ISDs between 200-500m can be used for evaluations.» y un «Indoor UT ratio 80%».
- §6.2 (1), UMi (microcélula urbana, antenas por debajo de los tejados): «ISD: 200 m». La tabla 7.2-1 da «BS antenna height 10 m».
- §6.2 (8), SMa (macro suburbana): «In suburban macro-cells base stations are located above the surrounding environment to allow wide area coverage … Example: [Tx height: 35 m, … ISD: 1299 m, 1732 m]». La nota 2 de la tabla 7.2-5 dice «SMa scenarios with ISDs between 1200-1800m can be used for evaluations.» Los edificios son de «Up to two floors for residential buildings, up to five floors for commercial buildings». El propio documento aclara que «SMa scenarios were identified at a later stage as part of Study on channel modelling enhancements for 7-24GHz for NR», así que la banda de 2 GHz para lo suburbano de la tabla A sale de F5.
- Tabla 7.2-3, RMa (macro rural): «Carrier Frequency Up to 7 GHz», «BS height 35 m», «Layout Hexagonal grid, 19 Macro sites, 3 sectors per site, ISD = 1732 m or 5000 m», «50% indoor and 50% in car».

**Pérdida con la distancia** (§7.4.1, tabla 7.4.1-1 «Pathloss models», «fc is in GHz and d is in meters»). Para UMa sin visión directa, con antena a 25 m, da «PL'UMa-NLOS = 13.54 + 39.08 log10(d3D) + 20 log10(fc) − 0.6(hUT − 1.5)», con «σSF = 6» dB y validez «10 ≤ d2D ≤ 5km». De ahí salen dos cuentas propias. Pasar de 700 a 3500 MHz añade 14,0 dB, y a 700 MHz se llega a la misma pérdida a unas 2,3 veces la distancia (10^(14,0/39,08)). Pasar de 1800 a 3500 MHz añade 5,8 dB, unas 1,4 veces la distancia.

**Pérdida al entrar en un edificio** (§7.4.3.1, tablas 7.4.3-1 y 7.4.3-2). Cada material pierde, con f en GHz, «Standard multi-pane glass L_glass = 2 + 0.2f», «IRR glass L_IRRglass = 25.4 + 0.11f» y «Concrete L_concrete = 5 + 4f» (23 cm). La pared exterior se modela así.

- «Low-loss model»: PLtw = 5 − 10·log10(0.3·10^(−L_glass/10) + 0.7·10^(−L_concrete/10)), σ = 4,4 dB.
- «High-loss model»: PLtw = 5 − 10·log10(0.7·10^(−L_IRRglass/10) + 0.3·10^(−L_concrete/10)), σ = 6,5 dB.
- Dentro del edificio se añade «PLin = 0.5 d2D-in», es decir 0,5 dB por cada metro hacia el interior.
- El documento no fija qué edificios son de cada tipo: «The composition of low and high loss is a simulation parameter … dependent on the use of metal-coated glass in buildings … the use of such high-loss glass currently appears to be more predominant in commercial buildings than in residential buildings in some regions of the world». En campo solo vale el de baja pérdida: «Only the low-loss model is applicable to RMa.»

Calculé con esas fórmulas la pérdida de la pared para las bandas que se usan en España.

| Banda | Pared, modelo de baja pérdida | Pared, modelo de alta pérdida (vidrio metalizado) |
|---|---|---|
| 700 MHz | 10,2 dB | 17,9 dB |
| 800 MHz | 10,4 dB | 18,2 dB |
| 900 MHz | 10,6 dB | 18,6 dB |
| 1800 MHz | 11,6 dB | 22,0 dB |
| 2100 MHz | 11,9 dB | 23,1 dB |
| 2600 MHz | 12,3 dB | 24,8 dB |
| 3500 MHz | 12,7 dB | 27,5 dB |

Con paredes y ventanas corrientes la pérdida crece poco con la banda, unos 2,5 dB de 700 a 3500 MHz. Con vidrio metalizado de baja emisividad sube mucho más y a 3500 MHz es casi 10 dB peor que a 700 MHz.

Dentro de un coche la pérdida media es de unos 9 dB (§7.4.3.2, «μ = 9, and σP = 5»).

**Dirección de las antenas** (§7.3, tabla 7.3-1, «Radiation power pattern of a single antenna element»). El corte horizontal es A(φ) = −min(12·(φ/φ3dB)², Amax) «with φ3dB = 65°, Amax = 30 dB». Un panel sectorial pierde así unos 10 dB a 60° de su eje (12·(60/65)² ≈ 10,2 dB, cálculo propio) y hasta 30 dB por detrás. Los escenarios ponen «3 sectors per site» para cubrir los 360°.

### F4. Informe ITU-R M.2412-0 (10/2017), «Guidelines for evaluation of radio interface technologies for IMT-2020», §8.2 a §8.4

URL: https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-M.2412-2017-PDF-E.pdf

Define los entornos de prueba con los que la UIT evaluó el 5G. Según §8.3, «base stations (BSs) / sites are placed in a regular grid, following hexagonal layout … 19 sites, each of 3 TRxPs (cells)». Las distancias de §8.4 son estas.

- «Dense Urban-eMBB: An urban environment with high user density and traffic loads», con «Inter-site distance … Macro layer: 200 m» a 4 GHz.
- «Rural-eMBB: A rural environment with larger and continuous wide area coverage». La configuración A va a «700 MHz … 1732 m», la B a «4 GHz … 1732 m» y la C (LMLC, «Low mobility large cell») a «700 MHz … 6000 m». La antena está a 35 m y los edificios son «100% low loss».
- «Urban Macro–mMTC», a «700 MHz», con «Inter-site distance 500 m» en la configuración A y «1732 m» en la B. La antena está a 25 m y los edificios son «20% high loss, 80% low loss building type».

§8.3 avisa de que «No specific topographical details are taken into account». Son rejillas ideales para comparar tecnologías.

### F5. Informe ITU-R M.2135-1 (12/2009), «Guidelines for evaluation of radio interface technologies for IMT-Advanced», §8.4, tablas 8-2 y 8-4, anexo 1 §1.2.1.2

URL: https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-M.2135-1-2009-PDF-E.pdf

Es el informe equivalente para 4G. La tabla 8-4 da como «Inter-site distance» «Urban micro-cell 200 m», «Urban macro-cell 500 m», «Rural macro-cell 1 732 m» y «Suburban macro-cell 1 299 m». La tabla 8-2, «Carrier frequency (CF) for evaluation (representative of IMT bands)», pone «2.5 GHz» en la micro urbana, «2 GHz» en la macro urbana, «800 MHz» en la macro rural y «Same as urban macro-cell» en la suburbana. La misma tabla fija «Outdoor to indoor building penetration loss … 20 dB» en la suburbana y «Outdoor to in-car penetration loss … 9 dB (LN, σ = 5 dB)».

El anexo 1 (§1.2.1.2) describe así lo suburbano: «Buildings are typically low residential detached houses with one or two floors, or blocks of flats with a few floors. Occasional open areas such as parks or playgrounds between the houses make the environment rather open.»

Para Celda importa que las cifras de 4G y 5G coinciden (200 m, 500 m, 1299 m, 1732 m) y que la UIT asocia la macro rural a 800 MHz y la urbana a 2 GHz.

### F6. CNMC, «Manual del modelo ascendente de costes incrementales a largo plazo (bottom-up LRIC) para redes móviles», Axon Partners Group, 3/6/2016, §4.2.4 y §7.2

URL: https://www.cnmc.es/sites/default/files/editor_contenidos/Telecomunicaciones/Modelos%20de%20coste/20160603%20-%20Axon%20Consulting%20-%20Documento%20Metodol%C3%B3gico%20Modelo%20BULRIC.PDF

Es el modelo de costes que usa la CNMC para una red móvil eficiente en España. Los radios de celda son entradas de la hoja de cálculo («Máximo Radio de Celda GSM 900 … km … 2A INP NW») y el manual no publica sus valores. Sirve para tres afirmaciones cualitativas.

- §4.2.4: «Por lo general, el radio de cobertura de una estación móvil en zonas montañosas es sensiblemente inferior al que tiene en zonas llanas.»
- §7.2: «En general, el número de emplazamientos será inferior en GSM 900 MHz que en GSM 1800 MHz.»
- §7.2.9: «Para compensar la limitación técnica que impide llegar a los valores máximos de transmisión en el dimensionado de la red de acceso radio debido tanto a los edificios y la necesidad de proveer de cobertura en interiores como a la orografía del terreno se utiliza un factor de corrección para cada geotipo.»

### F7. Ofcom, «Assessment of future mobile competition and award of 800 MHz and 2.6 GHz. Annexes 7-12», Statement, 24/7/2012, anexo 7 (§A7.75–A7.97) y anexo 8 (§A8.114–A8.128)

URL de la página de la subasta, que enlaza el anexo como «Annexes 7-12» de la declaración del 24/7/2012: https://www.ofcom.org.uk/spectrum/spectrum-awards/award-800mhz-2.6ghz. El servidor de Ofcom devuelve 403 a las peticiones automáticas y no pude comprobar el enlace directo al PDF.

Ofcom simuló redes LTE de 2×10 MHz con el mismo número de emplazamientos en cada banda («12,000 sites nationally») y una carga del 85 %. §A8.127 define los dos tipos de interior: «We associate “shallow” with depths of 0 to 5 metres inside a building (e.g., within a room with an external wall and perhaps a window). Whereas we associate “deep” with depths of 10 to 15 metres inside a building (e.g., deep inside a large house).» El «0-50% area» es la zona más densa, donde vive la mitad de la población.

- §A7.78, zona 0-50 %, interior poco profundo: «for networks operating at higher frequencies coverage is less than for those operating at lower frequencies (800 MHz = 97%, 1800 MHz = 93%, 2600 MHz = 88%).»
- §A7.80, zona 0-50 %, interior profundo: «for 800 MHz coverage is still in the high 90s at about 96%, whereas for 1800 MHz it has dropped to about 86% and for 2600 MHz to about 78%.»
- §A7.82, zona 50-80 %, interior poco profundo: «for 800 MHz coverage is approximately 95%, whereas for 1800 MHz it has dropped to approximately 83% and for 2600 MHz to approximately 76%.»
- §A7.94–A7.96 dan más emplazamientos a las bandas altas (12 000 en 800 MHz frente a 18 000 en 1800 y 2600 MHz), y aun así «Whilst coverage of the 1800 MHz and 2600 MHz networks are improved, 800 MHz still offers better coverage in all cases.»
- §A7.92 prueba a bajar la carga de la red: «though coverage of the 1800 MHz and 2600 MHz networks are improved, the improvement is relatively small (2 to 3%).» §A7.93 añade que «in a more lightly loaded network there is less interference and hence SINR and consequently throughput is better.»

La tabla A8.21, «Adopted values of mean BPL», da estas pérdidas al entrar en edificios, en dB.

| Banda | «Minvar», poco profundo | «Minvar», profundo | «Maxvar», poco profundo | «Maxvar», profundo |
|---|---|---|---|---|
| 800 MHz | 8,4 | 14,4 | 10,5 | 16,5 |
| 900 MHz | 8,4 | 14,4 | 11,0 | 17,0 |
| 1800 MHz | 8,4 | 14,4 | 13,7 | 19,7 |
| 2100 MHz | 8,4 | 14,4 | 14,3 | 20,3 |
| 2600 MHz | 8,4 | 14,4 | 15,1 | 21,1 |

Ofcom usa dos perfiles porque sus fuentes discrepan (tabla A8.19). COST 231 y Qualcomm dan una pérdida que crece con la frecuencia (6,6 y 8,8 dB por década), Okumoto da «a frequency-independent external wall loss of 10dB», y las medidas de Tar y Cser a 2100 MHz dan «12.7, 3.9, 8.2, and 8.6dB … for four types of building characterised as "downtown", "housing estate", "suburbs", and "village"». La profundidad se modela con «a distance dependence factor of α = 0.6dB/m, this implies a 6dB difference in BPL between our defined shallow and deep scenarios» (§A8.127).

Es la comparación entre bandas más limpia que encontré, porque un regulador la hizo con los mismos emplazamientos en todas las bandas. Sus cifras miden la población cubierta con LTE en el Reino Unido de 2012 y no se pueden pasar a metros.

### F8. GSMA y Coleago Consulting, «Vision 2030: Low-Band Spectrum for 5G», junio de 2022, cap. 02 (fig. 2) y cap. 03 (tabla de alcance rural)

URL: https://www.gsma.com/spectrum/wp-content/uploads/2022/06/5G-Low-Band-Spectrum.pdf

Hay que tener en cuenta quién lo firma. La GSMA es la patronal de los operadores y el informe pide que se les asigne más espectro bajo. Las cifras salen de un modelo de propagación (Okumura-Hata).

- Cap. 02: «For example, using 700 MHz instead of 1800 MHz produces a path loss gain of 13.4 dB, thus creating better indoor and wide-area coverage.» «In an open environment, 700 MHz, for example, reaches 2.6 times further than 1800 MHz.»
- La fig. 2, «Coverage comparison by band», da la distancia relativa a 2600 MHz: «2100 MHz 1.2x distance», «1800 MHz 1.4x distance», «900 MHz 2.9x distance», «700 MHz 3.7x distance».
- Nota 2: «Theoretically, over four times the number of sites are needed to cover the same area with 1800 MHz. However, the real-world figure is lower. The precise figure depends on local propagation conditions, the amount of spectrum available in 700 MHz versus 1800 MHz, MIMO configurations in each band and the distribution of demand over the area covered by a site.»
- La tabla de alcance rural, con 700, 800 y 900 MHz (2×10 MHz cada una) y 20 Mbit/s en el borde, da «Single-user cell range 27.0 km» y «Typical cell range 9.0 km». La nota 5 dice «rural near line of sight, 50m 40W base station and using the Okumura-Hata propagation model» y la nota 6 «The typical cell range is how operators design their network, taking into account non-line of sight, terrain and cell loading.»

La fig. 2 da a 900 MHz unas 2 veces el alcance de 1800 MHz (2,9/1,4) en campo abierto, mientras que la fórmula urbana de F2 da unas 1,55 veces entre 900 y 2000 MHz. La ventaja de las bandas bajas en distancia depende mucho del entorno, y por eso la gráfica debería enseñar el orden de las bandas sin multiplicadores.

### F9. Recomendación ITU-R P.2109-2 (08/2023), «Prediction of building entry loss», §2, §2.1, §3 y tabla 1

URL: https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.2109-2-202308-I!!PDF-E.pdf

Es el modelo estadístico de la UIT para la pérdida al entrar en un edificio, construido sobre medidas reales: «The model is based on the measurement data collated in Report ITU-R P.2346 in the range 80 MHz to 73 GHz.»

- §2.1: «buildings fall into two distinct populations: where modern, thermally-efficient building methods are used (metallised glass, foil-backed panels) building entry loss is generally significantly higher than for ‘traditional’ buildings without such materials.» «No assumption should be made on the year of construction, type (single or multi-floors), heritage or building method.» «Typically, the presence of metallised glass windows, insulated cavity walls, thick reinforced concrete and metal foil back cladding is a good indication of a thermally-efficient building.»
- §3: «Building entry loss will vary depending on building type, location within the building and movement in the building.» Las fórmulas (1) a (10) usan los coeficientes de la tabla 1 («Traditional 12.64 3.72 0.96 9.6 2.0 9.1 −3.0 4.5 −2.0»; «Thermally-efficient 28.19 −3.00 8.48 13.5 3.8 27.8 −2.9 9.4 −2.1»).
- §3: «In any sharing studies, the entire distribution should always be considered.»

Calculé estos valores con esas fórmulas, con incidencia horizontal.

| Banda | Tradicional, mediana | Tradicional, 10 %–90 % | Eficiente, mediana | Eficiente, 10 %–90 % |
|---|---|---|---|---|
| 700 MHz | 14,1 dB | 5,7–24,6 dB | 31,6 dB | 17,4–46,7 dB |
| 800 MHz | 14,2 dB | 5,7–24,9 dB | 31,3 dB | 17,3–46,6 dB |
| 900 MHz | 14,2 dB | 5,7–25,1 dB | 31,2 dB | 17,1–46,5 dB |
| 1800 MHz | 14,8 dB | 5,8–26,8 dB | 30,6 dB | 16,7–47,1 dB |
| 2100 MHz | 15,0 dB | 5,8–27,2 dB | 30,5 dB | 16,6–47,5 dB |
| 2600 MHz | 15,3 dB | 5,8–27,8 dB | 30,6 dB | 16,6–48,1 dB |
| 3500 MHz | 15,7 dB | 5,9–28,7 dB | 30,9 dB | 16,6–49,3 dB |

Por debajo de 4 GHz el tipo de edificio pesa mucho más que la banda. Entre un edificio tradicional y uno con vidrio metalizado hay unos 16 dB de mediana, y entre 700 y 3500 MHz menos de 2 dB. Dentro de un mismo tipo de edificio la pérdida varía unos 20 dB entre los sitios buenos y los malos.

Esto choca en parte con el modelo de alta pérdida de F3, que empeora con la banda, y con el perfil «Maxvar» de F7. Las fuentes coinciden en que entrar en un edificio cuesta del orden de 10 a 30 dB y en que las ventanas metalizadas lo empeoran mucho. Discrepan en cuánto influye la banda.

### F10. CNMC, «Informe sobre las actuaciones necesarias para la liberación del segundo dividendo digital en condiciones óptimas», INF/DTSA/169/17, 17/5/2018, §II y §III.3

URL: https://www.cnmc.es/sites/default/files/2069446.pdf

El regulador español solo da aquí afirmaciones cualitativas.

- Sobre 700 MHz: «El hecho de estar situada por debajo de 1 GHz le confiere excelentes características de propagación: la mayor cobertura en exteriores se traduce en menor necesidad de emplazamientos, y la alta penetración en interiores permite ofrecer servicios de calidad en los núcleos urbanos.»
- La banda de 800 MHz es «muy atractiva para las comunicaciones móviles de cuarta generación (LTE) por sus mejores propiedades de propagación y penetración en el interior de edificios con respecto a otras bandas utilizadas en comunicaciones móviles».
- §III.3: «Las bandas situadas por debajo de 1GHz, por sus características de propagación, son especialmente indicadas para cubrir entornos rurales o de baja densidad de población, además de ofrecer una mejor penetración de la señal y por tanto, cobertura en los interiores de los edificios.»

### F11. Ministerio para la Transformación Digital (SETELECO), «Metodología. Informe de Cobertura de Banda Ancha en España en el año 2025», 2026

URL: https://conectemos.digital.gob.es/content/dam/seteleco-portal-connect/resources/pdf/icba2025/Metodolog%C3%ADa_Informe_Cobertura-BA-2025.pdf

No da distancias. Explica qué llama «cobertura» el Ministerio en sus mapas oficiales, que un usuario puede consultar junto a Celda.

- Redes móviles: «La resolución mínima empleada para los ficheros ráster es de 50 x 50 metros y Los cálculos de cobertura se basarán en una probabilidad de 95 % del tiempo y de las ubicaciones. En el caso de redes móviles, se empleará una carga nominal de la celda del 60 %.»
- 4G: «Presencia, entendida como la zona donde: a. Frecuencias < 1 GHz RSRP >= -115 dBm; b. Frecuencias > 1 GHz RSRP >= -117 dBm».
- 5G: «SS-RSRP >= -115 dBm frecuencia < 1 GHz; SS-RSRP >= -117 dBm frecuencia entre 1 GHz y 3 GHz; SS-RSRP >= -112 dBm frecuencia > 3 GHz».
- Para el acceso fijo inalámbrico, que es otro servicio distinto del móvil: «En los casos sin antena receptora en exterior, se solicitó establecer un mínimo de 15dB de pérdidas frente a la cobertura outdoor disponible en cada ubicación.»

Los mapas oficiales salen de predicciones de los operadores y se definen por umbrales de señal. Los 15 dB que pide el Ministerio para el interior en el acceso fijo encajan con los 10 a 30 dB de F3, F7 y F9.

### F12. Ofcom, «Connected Nations 2025. Methodology Annex», 19/11/2025, tabla 1 y §59–61

URL de la página que enlaza el anexo: https://www.ofcom.org.uk/phones-and-broadband/coverage-and-speeds/connected-nations-20252. Como con F7, no pude comprobar el enlace directo al PDF.

- Nota 8 de la tabla 1: «Ofcom determines indoor coverage by applying an average building entry loss of 10dB across buildings. We acknowledge this approach provides only a simplified view of indoor coverage and that the real experience depends heavily on the types of building material and insulation in a specific building.»
- Tabla 1, 4G: «RSRP -105dBm» en exterior y «-95dBm» en «Indoor and in-car».
- §61: «Noting that the MNOs supply predictions to Ofcom based on a 50% confidence level across a pixel … we have then accounted for the overall effectiveness of the MNOs' 5G predictions (prediction error statistics) and local level variability, as well factoring in the differences between handset performance. The consequential combined standard deviation across these effects, which we have taken to be in the region of 12dB …»

Aquí un regulador reconoce por escrito que su cifra de interior es una simplificación y que el error de las predicciones ronda los 12 dB. Es otro motivo para no prometer nada en una dirección concreta.

## Lo que no está bien respaldado y no conviene mostrar

1. **Un umbral único de «buena señal hasta X m».** Ninguna fuente lo da. 3GPP añade a sus fórmulas una variación por sombras de 10 dB de desviación típica (F2 §4.5.2), que equivale a multiplicar o dividir la distancia por 1,8. Ofcom cifra el error conjunto de las predicciones de los operadores en unos 12 dB (F12 §61). Los antiguos «270 m» y «1 km» se parecen por casualidad a lo más lejos que queda alguien en las rejillas de ciudad (≈ 290 m) y de campo (≈ 1 km) de la tabla A. Esas cifras describen cómo se reparten los emplazamientos en una rejilla ideal y nada dicen de la calidad de la señal.
2. **Una tabla de metros por banda y entorno.** No hay fuente que la publique. Los multiplicadores entre bandas cambian con el entorno (900 frente a ~2000 MHz da 1,55 veces en ciudad según F2 y unas 2 veces en campo abierto según F8), así que cualquier casilla en metros sería una cuenta propia.
3. **El alcance de 3500 MHz en metros.** Las fuentes ponen esta banda en escenarios de 200 y 500 m entre emplazamientos (F1, F4) y en campo a 1732 m con paneles de hasta 256 elementos. La fórmula UMa de F3 da factores relativos frente a las otras bandas y ninguna fuente da un alcance en metros.
4. **Distancias reales entre emplazamientos en España.** No encontré ninguna fuente pública. El modelo de costes de la CNMC usa radios de celda por geotipo y no los publica (F6). Hay estudios académicos sueltos de Londres, Italia o Croacia que no se pueden trasladar. Celda podría medir con sus propios datos la distancia real al emplazamiento más cercano por tipo de municipio. Sería trabajo nuevo, que no he hecho, y seguiría sin decir nada de la señal.
5. **Una cifra de pérdida en interior que dependa de la banda.** Las fuentes discrepan. P.2109 casi no varía con la banda (F9), y el modelo de alta pérdida de 3GPP y el perfil «Maxvar» de Ofcom sí varían (F3, F7). Se puede decir que entrar en un edificio cuesta mucho y que los cristales metalizados lo empeoran.
6. **Los «9 km» rurales de la GSMA.** Es una cifra de diseño de una patronal que quiere más espectro bajo, calculada para un mástil de 50 m y terreno casi despejado (F8). Como mucho sirve para decir «varios kilómetros» en campo abierto.
7. **El efecto de la carga en metros.** Ofcom lo simuló y vio que bajar la carga mejora poco la cobertura (2–3 %) y bastante la velocidad (F7 §A7.92–A7.93). Nadie lo traduce a distancias.
8. **El efecto del relieve en cifras.** Solo hay frases cualitativas (F6 §4.2.4).
9. **Traducir los mapas oficiales a distancias.** Los mapas del Ministerio son predicciones de los operadores con umbrales de señal, un 95 % de probabilidad y un 60 % de carga (F11). Celda no debe convertirlos en metros.

## Frases propuestas

Ninguna promete señal en una dirección concreta. Se pueden usar por separado.

1. «En las ciudades, los emplazamientos de un mismo operador suelen estar a unos cientos de metros unos de otros. En las afueras y los pueblos esa distancia sube a uno o dos kilómetros, y en el campo puede pasar de cinco.»
   Fuentes: tabla A (F1, F3, F4, F5).

2. «Las bandas bajas, de 700 a 900 MHz, llegan más lejos que las de 1800, 2100 y 2600 MHz, y la de 3500 MHz es la que menos alcanza. La diferencia se nota todavía más dentro de los edificios.»
   Fuentes: tabla B (F2, F3, F7, F8, F10). La segunda frase se apoya en F7 §A7.80.

3. «La distancia solo da una idea. Los edificios que haya en medio, las cuestas, hacia dónde miran las antenas y cuánta gente use la red a la vez cambian mucho la señal, y dos sitios a la misma distancia pueden recibirla muy distinta. Al entrar en un edificio se pierde buena parte de la señal, sobre todo si tiene cristales metalizados. Para saber qué llega a un sitio concreto hay que medirlo allí.»
   Fuentes: F2 §4.5.2, F3 §7.3 y §7.4.3, F6, F7, F9, F12.
