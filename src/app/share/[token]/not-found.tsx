// Custom 404 for the /share/[token] segment.
//
// Next.js's notFound() throws a NEXT_HTTP_ERROR_FALLBACK;404 — the
// nearest not-found.tsx in the route hierarchy renders the UI and
// the response carries a 404 status. We render a more useful page
// than the framework's default 404: this is a share link view, so
// "not found" most likely means the link has been revoked (token
// rotated) or was mistyped. A pointer back to the dashboard
// homepage gives the viewer a sensible next step.

import Link from 'next/link';

export default function ShareNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="text-5xl mb-3" aria-hidden="true">🔗</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Share link not found</h1>
        <p className="text-gray-500 text-sm mb-6">
          This share link may have been revoked, expired, or never existed.
          If you reached this page from a saved link, ask the person who
          shared it to send you a new one.
        </p>
        <Link
          href="/"
          className="inline-block text-sm bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-800"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
