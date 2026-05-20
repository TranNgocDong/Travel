"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      void caches?.keys?.().then((keys) => Promise.all(keys.filter((key) => key.startsWith("trail-ledger")).map((key) => caches.delete(key))));
      return;
    }

    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works without the service worker; route data is also cached in localStorage.
    });
  }, []);

  return null;
}
