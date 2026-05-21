"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("TrailLedger route error", error);
  }, [error]);

  async function clearLocalDataAndReload() {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <main className="recovery-page">
      <section className="recovery-card" role="alert">
        <span className="eyebrow">Khoi phuc ung dung</span>
        <h1>Trang khong tai duoc do loi du lieu/phien cu.</h1>
        <p>Hay xoa du lieu cuc bo cua web roi mo lai. Du lieu online trong tai khoan va database khong bi xoa.</p>
        <pre>{error.message || error.digest || "Unknown route error"}</pre>
        <div className="recovery-actions">
          <button type="button" onClick={clearLocalDataAndReload}>
            Xoa du lieu cu va mo lai
          </button>
          <button type="button" className="secondary" onClick={reset}>
            Thu lai
          </button>
        </div>
      </section>
    </main>
  );
}
