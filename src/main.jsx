import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";
import { prihlasSW } from "./pwa";

/* Service worker (Fáza 6) — vďaka nemu sa appka otvorí aj bez signálu a vedia
   cez neho chodiť upozornenia. Prihlasuje sa až po načítaní stránky, nech to
   nespomaľuje prvé otvorenie. Keď to zlyhá, appka funguje ďalej ako predtým. */
if (typeof window !== "undefined") {
  window.addEventListener("load", () => { prihlasSW(); });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
