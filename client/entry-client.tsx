import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import "./base.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.hydrateRoot(
  rootElement,
  <StrictMode>
    <App />
  </StrictMode>,
);
