// Custom 404 for the /projects/[id] segment.
//
// Renders when the [id] route's server component calls
// notFound() — i.e. the project id is missing from the DB or
// the user followed a stale link to a deleted project. The
// response carries a 404 status (per Next.js's not-found
// file convention; see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md).
//
// We render a more useful page than the framework default: the
// most likely reason a user lands here is that they bookmarked
// a project page and the project has since been deleted. A
// pointer back to the dashboard home (and a hint about the
// "All projects" link in the per-project header) gives them a
// sensible next step. We deliberately do NOT distinguish
// "bad id" from "deleted" — both look the same to the user,
// which is the right shape for a dashboard-internal route.

import Link from 'next/link';

export default function ProjectNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="text-5xl mb-3" aria-hidden="true">📁</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Project not found</h1>
        <p className="text-gray-500 text-sm mb-6">
          This project may have been deleted, or the link may be
          out of date. Go back to the dashboard to see the current
          list of projects.
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
