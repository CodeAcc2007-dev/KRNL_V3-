
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(<App />);

// Register Service Worker on window load
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("ServiceWorker registered successfully with scope: ", reg.scope);
      })
      .catch((err) => {
        console.error("ServiceWorker registration failed: ", err);
      });
  });
}
  