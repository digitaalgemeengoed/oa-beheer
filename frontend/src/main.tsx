import { createRoot } from "react-dom/client";
import "@utrecht/component-library-css/dist/index.css";
import "@nl-design-system-unstable/haarlem-design-tokens/dist/index.css";
import "./stijl.css";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(<App />);
