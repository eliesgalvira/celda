# El mapa se lee de capas estáticas versionadas, con marca de agua por vista

Estado: aceptada el 24/09/2026.

El mapa necesita todos los emplazamientos a cualquier zoom. Servir eso en vivo gastaría el plan gratuito del backend y obligaría a limitar las lecturas una a una. En su lugar, una instantánea de los emplazamientos se convierte en capas PMTiles, con los puntos, sus compañías y su estado, y las agrupaciones por barrio. Las capas se publican en una CDN con su versión, por ejemplo `sitios@2026-09-24T03:00Z`. La CDN absorbe el volumen, así que el mapa carga rápido y el backend no recibe esas lecturas. El backend en vivo sirve solo lo detallado: la ficha de un emplazamiento y el estado de la ingesta.

La capa y la ficha pueden tener versiones distintas. Cada vista conoce la versión de su dato. Si la ficha es más reciente que la capa, la ficha lo dice («actualizado después del mapa») y el marcador no se corrige a medias. Es la marca de agua por vista.

El mapa base es OpenFreeMap con el estilo del tema, servido desde sus servidores.

## Consecuencias

- El mapa puede ir por detrás de la ficha hasta la siguiente capa. Se acepta porque la interfaz lo muestra.
- Dónde se alojan las capas lo fija la decisión 10 de `docs/arquitectura.md`, pendiente de su exploración.
