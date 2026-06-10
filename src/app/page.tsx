import CommentCard from '../components/CommentCard';
import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
import CopyButton from '@/components/CopyButton';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const projects = await prisma.project.findMany({
    include: {
      pages: {
        include: {
          comments: {
            orderBy: { createdAt: 'desc' }
          }
        }
      }
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Visual Feedback Dashboard</h1>
            <p className="text-gray-500 mt-2">Manage incoming client feedback pins and agent tasks.</p>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
            <span className="text-sm text-gray-500">Widget Snippet: </span>
            {projects[0]?.apiKey ? (
              <WidgetSnippet apiKey={projects[0].apiKey} />
            ) : (
              <span className="text-xs text-gray-400">Create a project below to get a snippet</span>
            )}
          </div>
        </header>

        <NewProjectForm />

        {projects.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
            <p className="text-gray-500 mt-2">Install the widget snippet on a client site to capture the first pin.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {projects.map(project => (
              <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-900 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                      <p className="text-gray-400 text-sm">{project.domain}</p>
                    </div>
                    {project.githubRepo && (
                      <a href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-white text-sm flex items-center gap-1">
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        {project.githubRepo}
                      </a>
                    )}
                  </div>
                </div>

                {project.apiKey && (
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs">
                    <span className="text-gray-500">API Key:</span>
                    <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
                    <CopyButton text={project.apiKey} />
                  </div>
                )}

                <div className="p-6">
                  {project.pages.map(page => (
                    <div key={page.id} className="mb-8 last:mb-0">
                      <h3 className="text-lg font-medium text-gray-800 mb-4 border-b pb-2">Path: {page.path}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {page.comments.map(comment => (
                          <CommentCard key={comment.id} comment={comment} />
                        ))}
                        {page.comments.length === 0 && (
                          <p className="text-sm text-gray-500 italic">No feedback pins on this page yet.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
