import "@celda/ui/tema.css";

import { render } from "@solidjs/web";

import { App } from "./App.tsx";

const raiz = document.getElementById("raiz");
if (raiz !== null) {
  render(() => <App />, raiz);
}
