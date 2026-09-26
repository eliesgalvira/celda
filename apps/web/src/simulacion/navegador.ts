import type { Respuesta } from "@celda/sim/protocolo";
import { type PuertoWorker, simuladorEnWorker } from "@celda/sim/simulador";

/** Un Worker del navegador como lo necesita el simulador. */
const puertoDe = (worker: Worker): PuertoWorker => ({
  // Sin transferir la malla: quien la pide la puede volver a usar. El `postMessage` de un Worker
  // no lleva origen de destino; la regla lo confunde con el de una ventana.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  enviar: (solicitud) => worker.postMessage(solicitud),
  escuchar: (alResponder, alFallar) => {
    worker.addEventListener("message", (evento: MessageEvent<Respuesta>) => {
      alResponder(evento.data);
    });
    worker.addEventListener("error", (evento) => {
      evento.preventDefault();
      alFallar(evento.message);
    });
    worker.addEventListener("messageerror", () => {
      alFallar("no se ha podido leer su respuesta");
    });
  },
  terminar: () => worker.terminate(),
});

/** El simulador de la web: un Web Worker que se arranca con la primera simulación. */
export const simuladorDelNavegador = simuladorEnWorker(() =>
  puertoDe(
    new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "simulaciones",
    }),
  ),
);
