import { indexadorEnWorker, type PuertoIndexador, type RespuestaDeIndice } from "./indexador.ts";

/** Un Worker del navegador como lo necesita el indexador. */
const puertoDe = (worker: Worker): PuertoIndexador => ({
  // El texto de la capa se copia: es una cadena. El `postMessage` de un Worker no lleva origen de
  // destino; la regla lo confunde con el de una ventana.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  enviar: (solicitud) => worker.postMessage(solicitud),
  escuchar: (alResponder, alFallar) => {
    worker.addEventListener("message", (evento: MessageEvent<RespuestaDeIndice>) => {
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

/** El indexador de la web: un Web Worker que se arranca con la primera provincia. */
export const indexadorDelNavegador = indexadorEnWorker(() =>
  puertoDe(
    new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "capas",
    }),
  ),
);
