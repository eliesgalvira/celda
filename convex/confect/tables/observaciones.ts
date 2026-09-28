import { ObservacionGuardada } from "@celda/ingesta/guardado";
import { Table } from "@confect/core";

/**
 * Lo último que dice cada fuente de cada estación base (`ObservacionGuardada`). `fecha` cambia
 * solo cuando cambia lo que dice la fuente, así que una ejecución sin cambios no escribe nada.
 */
export default Table.make(() => ObservacionGuardada)
  .index("por_clave", ["fuente", "clave"])
  .index("por_ficha", ["fuente", "fichaLeidaEn"]);
