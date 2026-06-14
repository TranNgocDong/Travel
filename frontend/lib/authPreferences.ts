const autoEnterAppKey = "trail-ledger-auto-enter-app";

/**
 * Returns whether this browser is allowed to skip the landing/login screen.
 * This is a UX preference only; Firebase still decides whether a valid session exists.
 */
export function shouldAutoEnterApp(): boolean {
  // This preference is intentionally separate from Firebase persistence.
  // Firebase decides whether a session exists; this flag decides whether the UI may skip the landing/login screen.
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(autoEnterAppKey) === "true";
}

/**
 * Saves or clears the "auto enter app" preference for this device.
 * It does not store auth tokens and it does not affect other devices.
 */
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

/**
 * Clears auto-enter mode, usually after logout or a failed restored session.
 */
export function clearAutoEnterApp(): void {
  setAutoEnterApp(false);
}
