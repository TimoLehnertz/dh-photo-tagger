import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { isTauri } from "./lib/platform";

/**
 * On GitHub Pages, a service worker supplies the headers for cross-origin isolation (see
 * public/coi-serviceworker.js). The first visit has to reload once so the page is served through it.
 * Returns true when that reload is under way.
 */
async function isolate(): Promise<boolean> {
  if (!import.meta.env.PROD || isTauri || globalThis.crossOriginIsolated || !window.isSecureContext || !("serviceWorker" in navigator)) return false;
  const KEY = "dhpt:coi-reload";
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-serviceworker.js`);
    // Controlled but still not isolated (browser without support): don't loop.
    if (navigator.serviceWorker.controller || sessionStorage.getItem(KEY)) return false;
    await navigator.serviceWorker.ready;
    sessionStorage.setItem(KEY, "1");
    location.reload();
    return true;
  } catch {
    return false;
  }
}

// Never let isolation hold up the app (service workers blocked, registration hanging…).
const reloading = await Promise.race([isolate(), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
if (!reloading) mount(App, { target: document.getElementById("app")! });
