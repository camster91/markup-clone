import CommentCard from '../components/CommentCard';
import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
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
            <WidgetSnippet />
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
                  <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                  <p className="text-gray-400 text-sm">{project.domain}</p>
                </div>
                
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