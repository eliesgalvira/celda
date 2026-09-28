/**
 * El Web Worker de las capas de provincia: lee cada capa, la indexa con supercluster y devuelve
 * los índices sin copiar sus búferes (ADR 0016).
 */
import { atenderIndice, type SolicitudDeIndice } from "./indexador.ts";

self.addEventListener("message", (evento: MessageEvent<SolicitudDeIndice>) => {
  const { respuesta, transferibles } = atenderIndice(evento.data);
  self.postMessage(respuesta, { transfer: [...transferibles] });
});
