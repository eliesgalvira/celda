# Reglas de pruebas de Landmines

Copia de [interfere-inc/landmines](https://github.com/interfere-inc/landmines/tree/92084b12872103b0f9245c0325ab571df00a574b), versión 0.1.0, commit `92084b12872103b0f9245c0325ab571df00a574b`. Conserva la licencia MIT en `LICENSE`.

Solo se copian `no-fixed-sleep`, `no-flake-masking`, `no-unsignaled-poll` y su lista de excepciones. Se registran como `landmines-testing` y se activan por separado en `vite.config.ts`. Siguen el criterio de la copia de anti-slop del ADR 0001: fuentes revisables, reglas elegidas y versiones controladas. El paquete completo añadiría Babel, un resolvedor y Zod para reglas que no se usan aquí. Landmines pide Oxlint >=1.81; `vp lint` usa 1.85.0.

Cambios locales:

- `lib/allowlist.ts` valida con Effect Schema, que ya usa el plugin, en vez de añadir Zod. Se conserva la comparación exacta por fichero: una infracción más falla y una menos obliga a bajar la excepción.
- `no-fixed-sleep` reconoce ayudantes locales de flecha que devuelven directamente una espera, `TestClock.withLive(Effect.sleep(...))` e `it.live`/`it.scopedLive`. Las esperas con el reloj virtual de Effect siguen permitidas.
- `no-fixed-sleep` reconoce los modificadores de las pruebas `live` y no omite un fichero por contener `vi.useFakeTimers()`. Una espera directa también se rechaza con reloj falso: se programa la promesa, se avanza el reloj y después se espera su resultado. Así una prueba con reloj falso no oculta esperas reales de otras.
- `no-flake-masking` inspecciona también `testTimeout` y `hookTimeout` del objeto `test` de `defineConfig`, como el de `vp`.
- Los mensajes de excepciones remiten a `vite.config.ts`, donde se configuran en Celda.

No se copia `no-test-doubles`: no detecta infracciones actuales y añade una política de sustitución de dependencias que prescribe MSW para la red, mientras Celda permite capas y funciones de prueba. Se mantiene esa decisión del repo sin añadir las otras prohibiciones de la regla. Tampoco se copia `strict-msw`, porque el repo no usa MSW. `anti-slop/no-module-mocking` sigue activo. No se copian los plugins de estilo, estructura o tipos ni la configuración `recommended`.

Las excepciones de esperas reales coordinan reloj virtual con disco o Web Crypto. Cambiarlas requiere exponer señales de avance de esas operaciones. Los plazos heredados restantes cubren ingestas, publicaciones, construcción de la web y recorridos de datos completos. Se conserva su comportamiento para que esta adopción no rediseñe esas pruebas. Cada excepción vive junto a la regla en `vite.config.ts` y debe bajar en cuanto se retire la infracción.

Las pruebas de integración de `../reglas/landmines-testing.test.ts` ejecutan Oxlint con casos válidos, infracciones y recuentos que suben o bajan.
