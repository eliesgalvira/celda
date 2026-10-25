# Licencias de los datos

El código de Celda es 0BSD (ver `LICENSE`). Los datos llevan otras condiciones, según de quién son. La decisión está en el [ADR 0021](docs/adr/0021-licencias.md).

## Datos de Celda: CC0 1.0

Lo que añade Celda a los datos de otros es de dominio público, con [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.es): las aportaciones del público y lo que calcula Celda, como el estado y la confianza de cada emplazamiento, los recuentos por zona o cómo queda cada medida de exposición frente a las de su zona. Se puede copiar, cambiar y republicar sin pedir permiso ni citar.

## Datos de otros

Estos datos conservan sus condiciones. Quien los reutilice desde Celda tiene que dar el crédito de la tercera columna.

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

## Logotipos de las compañías

Los logos de `packages/ui/src/marcadores/logos/` no son 0BSD ni CC0. Son marcas de sus titulares y Celda los usa solo para decir de quién es cada estación base. De dónde sale cada uno y qué permiten sus condiciones está en `packages/ui/src/marcadores/logos/FUENTES.md`. Celda no está afiliada a ninguna compañía.

## Código de terceros

`tools/oxlint-plugin-celda/anti-slop/` es de dmmulroy/anti-slop, con licencia MIT (ver su `LICENSE`).

El dibujo del logo de Movistar sale de Mística, de Telefónica, con licencia MIT. Su aviso está en `packages/ui/src/marcadores/logos/LICENSE-mistica`.
