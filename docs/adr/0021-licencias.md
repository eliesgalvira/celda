# Licencias: CC0 para los datos y las aportaciones, 0BSD para el código y créditos de terceros

Estado: aceptada el 02/10/2026, con las decisiones del usuario del mismo día. Responde a la nota de licencias que dejaron el ADR 0009 y `../arquitectura.md`. `LICENSE` y `LICENCIA-DATOS.md` están en la raíz desde el 25/10/2026, cuando Celda pasó a su propio repositorio. El titular del código es «Los autores de Celda». Revisada el 03/10/2026 con el [ADR 0022](0022-mapa-base-como-google-y-foto-aerea.md): la tabla suma la ortofoto PNOA de la foto aérea. Revisada el 06/10/2026 con el ADR 0017: suma las capitales del Nomenclátor del IGN. Revisada el 20/10/2026 con la retirada del [ADR 0005](0005-simulaciones-puras-interfaz-fija.md): Celda ya no tiene simulaciones, así que lo propio deja de contarlas, también en el texto de las licencias que acompaña a cada publicación.

## Contexto

Celda será abierta del todo, y el usuario pidió «la más abierta» para lo que es suyo. Pero Celda también republica datos de otros, y esos no se pueden relicenciar. Con el buzón (ADR 0020), las aportaciones del público pasan a ser parte de lo que se publica, y hay que decir con qué licencia antes de que alguien envíe la primera.

## Decisión

- **Los datos propios de Celda y todas las aportaciones son CC0 1.0.** Propios son los que crea Celda: las correcciones aceptadas, los agregados de medidas, las corroboraciones y lo que calcula sobre los datos de otros, como el estado, la confianza o las zonas.
- **El código es 0BSD.** Equivale al dominio público y está aprobada por la OSI. CC0 no lo está para código: excluye de forma expresa las patentes.
- **Los datos de terceros conservan sus condiciones y su crédito:**

| Datos | Condiciones | Crédito |
|---|---|---|
| Registro oficial (Infoantenas) | Ley 37/2007 y condiciones generales de reutilización del ministerio: citar la fuente, no desnaturalizar, dar la fecha y no sugerir que el ministerio lo apoya | «Origen de los datos: Ministerio para la Transformación Digital y de la Función Pública (Infoantenas)», con la fecha de consulta (investigación del registro, apartado 3) |
| Límites de provincias y municipios del IGN | CC BY 4.0 | «Obra derivada de …», como piden sus condiciones (ADR 0017) |
| Capitales de municipio del Nomenclátor Geográfico Básico de España del IGN | CC BY 4.0 | «Obra derivada de Nomenclátor Geográfico Básico de España <fecha> CC-BY 4.0 ign.es», con el punto de cada municipio (ADR 0017) |
| Padrón del INE | CC BY 4.0 | «Elaboración propia con datos extraídos del sitio web del INE: www.ine.es», con la fecha |
| Barrios y población de Open Data BCN | CC BY 4.0 | «Ajuntament de Barcelona», con la licencia y la fecha (ADR 0004) |
| Mapa base y búsqueda de direcciones, sobre OpenStreetMap | ODbL | El crédito de OpenStreetMap, con el del servicio (ADR 0013) |
| Mapa base de reserva del IGN (#60) | CC BY 4.0 | «© Sistema Cartográfico Nacional · CC BY 4.0 scne.es», la fórmula de su servicio, solo mientras está puesto; en el móvil se queda a la vista con los demás créditos plegados |
| Ortofoto PNOA del IGN, en la foto aérea | CC BY 4.0 | «PNOA · CC BY 4.0 scne.es», la fórmula de su servicio, mientras la foto está encendida (ADR 0022) |

- **Lo publicado lleva esos créditos** y dice qué parte es CC0 y cuál de quién.
- **La dedicación CC0 se enseña al enviar una aportación**, en el mismo paso y antes de enviarla, no en una página aparte.
- **Los logos de las compañías se usan solo para decir de quién es cada estación base** (04/10/2026). Es un uso nominativo de la marca (art. 37 de la Ley 17/2001 de Marcas, art. 14 del Reglamento (UE) 2017/1001), con el vector oficial de cada una y sin redibujarlo. La ficha y los créditos del mapa dicen «Las marcas y logotipos de las compañías son de sus titulares; Celda no está afiliada a ninguna». Si las condiciones de una compañía piden citar la fuente, se cita donde sale su logo: hoy, DIGI («Logotipo de DIGI: digimobil.es», con enlace). Una compañía cuyas condiciones prohíben enseñar su logo va con su nombre escrito: hoy, Yoigo. De dónde sale cada logo y qué dicen sus condiciones está en `packages/ui/src/marcadores/logos/FUENTES.md`. Los logos no son CC0 ni 0BSD: el código que los dibuja sí, sus trazos no.

## Consecuencias

- Cualquiera puede copiar, cambiar y republicar lo que es de Celda sin pedir nada ni citar.
- Una capa de Celda mezcla datos CC0 con datos del registro, así que quien la reutilice tiene que seguir citando al ministerio por su parte. La capa lo dice.
- Una fuente con «compartir igual», como OpenCelliD con CC BY-SA 4.0, no puede entrar en las capas sin que las capas pasen a esa licencia. Fue una de las razones para descartar OpenCelliD el 07/10/2026 (ADR 0019).
- Una aportación enviada no se puede retirar de la licencia: CC0 es irrevocable. La persona lo lee antes de enviarla.
