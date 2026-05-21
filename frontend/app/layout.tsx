import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrailLedger",
  description: "Mobile-first travel expense planner",
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
  const cacheResetScript =
    process.env.NODE_ENV === "production"
      ? `
        (function () {
          try {
            var resetKey = "trail-ledger-cache-reset-v7";
            var hadOldCache = false;

            if (sessionStorage.getItem(resetKey)) {
              return;
            }

            Promise.all([
              "serviceWorker" in navigator
                ? navigator.serviceWorker.getRegistrations().then(function (registrations) {
                    hadOldCache = hadOldCache || registrations.length > 0;
                    return Promise.all(registrations.map(function (registration) {
                      return registration.unregister();
                    }));
                  })
                : Promise.resolve(),
              "caches" in window
                ? caches.keys().then(function (keys) {
                    var trailLedgerCaches = keys.filter(function (key) {
                      return key.indexOf("trail-ledger") === 0;
                    });

                    hadOldCache = hadOldCache || trailLedgerCaches.length > 0;
                    return Promise.all(trailLedgerCaches.map(function (key) {
                      return caches.delete(key);
                    }));
                  })
                : Promise.resolve()
            ]).finally(function () {
              sessionStorage.setItem(resetKey, "1");

              if (hadOldCache) {
                var separator = location.search ? "&" : "?";
                location.replace(location.pathname + location.search + separator + "cache-reset=1");
              }
            });
          } catch (error) {
            // If browser storage is blocked, keep loading the page as a normal website.
          }
        })();
      `
      : `
        (function () {
          var resetKey = "trail-ledger-dev-cache-reset-v6";
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
        <Script id="trail-ledger-cache-reset" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: cacheResetScript }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
