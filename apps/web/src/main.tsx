import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { loadKit } from "./game/models";

// Start fetching the vehicle and driver models straight away, so they are ready before the first race.
loadKit();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
