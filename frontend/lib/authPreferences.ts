const autoEnterAppKey = "trail-ledger-auto-enter-app";

export function shouldAutoEnterApp(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(autoEnterAppKey) === "true";
}

export function setAutoEnterApp(enabled: boolean): void {
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
