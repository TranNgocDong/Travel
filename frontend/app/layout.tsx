import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "leaflet/dist/leaflet.css";
import "./globals.css";

import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "TrailLedger",
  description: "Mobile-first travel expense planner",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const localCacheResetScript =
    process.env.NODE_ENV === "production"
      ? null
      : `
        (function () {
          var resetKey = "trail-ledger-dev-cache-reset-v4";
          if (location.hostname !== "localhost" || sessionStorage.getItem(resetKey)) {
            return;
          }
          sessionStorage.setItem(resetKey, "1");
          Promise.all([
            "serviceWorker" in navigator
              ? navigator.serviceWorker.getRegistrations().then(function (registrations) {
                  return Promise.all(registrations.map(function (registration) {
                    return registration.unregister();
                  }));
                })
              : Promise.resolve(),
            "caches" in window
              ? caches.keys().then(function (keys) {
                  return Promise.all(keys.filter(function (key) {
                    return key.indexOf("trail-ledger") === 0;
                  }).map(function (key) {
                    return caches.delete(key);
                  }));
                })
              : Promise.resolve()
          ]).finally(function () {
            location.reload();
          });
        })();
      `;

  return (
    <html lang="vi">
      <head>
        {localCacheResetScript && (
          <Script id="trail-ledger-dev-cache-reset" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: localCacheResetScript }} />
        )}
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
