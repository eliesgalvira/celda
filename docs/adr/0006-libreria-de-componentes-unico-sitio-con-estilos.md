# La librería de componentes es el único sitio con estilos, y lo impone el lint

Estado: aceptada el 24/09/2026. Revisada el 08/10/2026 con el #75: la web activa el tema oscuro cuando el sistema lo está.

El diseño todavía va a cambiar, y cada cambio debe hacerse en un sitio y no pantalla a pantalla. `packages/ui` contiene los componentes, al estilo shadcn con `cva`, y los tokens del tema Hexágono en variables CSS OKLCH. El estilo del mapa sale de los mismos tokens. Las piezas del prototipo, como el botón hexagonal, la etiqueta de estado, la hoja inferior y los marcadores, son componentes con variantes.

En Moli esto era una convención. En Celda lo comprueba una regla de oxlint que prohíbe `class` y `style` a medida y los colores sueltos fuera de `packages/ui`. Si una pantalla necesita algo nuevo, se añade una variante o un componente a la librería.

## Consecuencias

Los tokens tienen nombres semánticos para que un tema oscuro sea posible. Desde el #75, la web sigue el tema del sistema con los mismos tokens y otros valores; cómo se elige y cómo cambia el mapa está en `docs/patterns/ui.md`, «Tema claro y oscuro».
