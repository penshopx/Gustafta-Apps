import { Component, useEffect, useState, type ReactNode } from "react";
import { isPageLoadError } from "../lib/page-load-error";

function PageRecovery({ loadError }: { loadError: boolean }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  function reload() {
    // Recheck at click time; an offline event may not have rendered yet.
    if (!navigator.onLine || reloading) return;
    setReloading(true);
    window.location.reload();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100" data-testid="page-recovery">
      <section className="mx-auto max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-2xl font-semibold">
          {loadError ? "Halaman belum berhasil dimuat" : "Halaman mengalami kendala"}
        </h1>
        <p className="mt-4">
          {loadError
            ? "Versi aplikasi mungkin telah diperbarui atau koneksi sedang terganggu. Muat ulang untuk mengambil halaman terbaru."
            : "Terjadi kendala saat menampilkan halaman ini. Anda dapat mencoba memuat ulang halaman."}
        </p>
        <p role="status" aria-live="polite" className="mt-4 text-sky-200">
          {online
            ? "Memuat ulang tetap membuka alamat halaman ini."
            : "Anda sedang offline. Sambungkan kembali ke internet sebelum memuat ulang."}
        </p>
        <p className="mt-3 text-sm text-slate-300">
          Perubahan yang belum disimpan dapat hilang saat memuat ulang.
          Halaman tidak akan dimuat ulang secara otomatis.
        </p>
        <button
          type="button"
          onClick={reload}
          disabled={!online || reloading}
          className="mt-6 rounded-lg bg-sky-300 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reloading ? "Memuat ulang…" : "Muat ulang halaman"}
        </button>
        <a href="/" className="mt-5 block text-sky-200 underline">Kembali ke beranda</a>
      </section>
    </main>
  );
}

export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Halaman gagal ditampilkan", error);
  }

  render() {
    return this.state.failed
      ? <PageRecovery loadError={isPageLoadError(this.state.error)} />
      : this.props.children;
  }
}
