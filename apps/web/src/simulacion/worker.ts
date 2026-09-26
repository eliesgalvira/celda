/**
 * El Web Worker de las simulaciones: atiende cada solicitud con el registro de `@celda/sim` y
 * devuelve el resultado sin copiar sus arrays. No sabe qué simulaciones hay; una nueva solo se
 * añade al registro.
 */
import { atender, type Solicitud, transferibles } from "@celda/sim/protocolo";
import { SIMULACIONES } from "@celda/sim/registro";

self.addEventListener("message", (evento: MessageEvent<Solicitud>) => {
  const respuesta = atender(SIMULACIONES, evento.data);
  self.postMessage(respuesta, {
    transfer: respuesta.tipo === "resultado" ? transferibles(respuesta.resultado) : [],
  });
});
