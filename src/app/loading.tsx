export default function Loading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-screen bg-gray-50 p-4 sm:p-8"
    >
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="mb-8 h-9 w-64 max-w-full rounded-lg bg-gray-200" />
        <div className="mb-4 h-4 w-96 max-w-full rounded bg-gray-200" />
        <div className="space-y-4" aria-hidden="true">
          <div className="h-32 rounded-xl border border-gray-200 bg-white" />
          <div className="h-32 rounded-xl border border-gray-200 bg-white" />
        </div>
        <span className="sr-only">Loading visual feedback workspace…</span>
      </div>
    </main>
  );
}
