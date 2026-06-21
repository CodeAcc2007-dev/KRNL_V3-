
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(<App />);

// Register Service Worker on window load.
// PROD only: in dev the stale-while-revalidate cache masks code changes
// (you'd see old code until a second reload). Also proactively unregister any
// SW left over from a previous dev session so it stops serving stale assets.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
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
  } else {
    // Dev: tear down any existing SW + caches so changes show on first reload.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}
  