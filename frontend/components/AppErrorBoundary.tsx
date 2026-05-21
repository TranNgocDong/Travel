"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("TrailLedger recovered from a UI crash", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return <RecoveryScreen error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

function RecoveryScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
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
        <h1>Trang dang gap du lieu cu khong tuong thich.</h1>
        <p>
          Web van dang chay, nhung trinh duyet dang giu mot phan du lieu cu. Xoa du lieu cuc bo se khong xoa tai
          khoan hay database online.
        </p>
        <pre>{error.message || "Unknown client error"}</pre>
        <div className="recovery-actions">
          <button type="button" onClick={clearLocalDataAndReload}>
            Xoa du lieu cu va mo lai
          </button>
          <button type="button" className="secondary" onClick={onRetry}>
            Thu lai
          </button>
        </div>
      </section>
    </main>
  );
}
