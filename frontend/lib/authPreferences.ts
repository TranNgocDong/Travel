const autoEnterAppKey = "trail-ledger-auto-enter-app";

export function shouldAutoEnterApp(): boolean {
  // This preference is intentionally separate from Firebase persistence.
  // Firebase decides whether a session exists; this flag decides whether the UI may skip the landing/login screen.
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(autoEnterAppKey) === "true";
}

export function setAutoEnterApp(enabled: boolean): void {
  // The value is local to the current browser/device and does not affect the user's online account.
  if (typeof window === "undefined") {
    return;
  }

  if (enabled) {
    window.localStorage.setItem(autoEnterAppKey, "true");
    return;
  }

  window.localStorage.removeItem(autoEnterAppKey);
}

export function clearAutoEnterApp(): void {
  setAutoEnterApp(false);
}
