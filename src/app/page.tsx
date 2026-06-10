import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
import DashboardProjects from '@/components/DashboardProjects';
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
        <header className="mb-8 flex justify-between items-center relative">
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

        <DashboardProjects />
      </div>
    </div>
  );
}
