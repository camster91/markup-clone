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
          screenshots: {
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: {
                orderBy: { createdAt: 'asc' },
                include: {
                  comments: {
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const dashboardHost = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Visual Feedback</h1>
            <p className="text-gray-500 mt-2">Review client feedback pins on captured page screenshots.</p>
          </div>
          {projects[0]?.apiKey ? (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-500 mb-1">Widget snippet (latest project):</div>
              <WidgetSnippet apiKey={projects[0].apiKey} dashboardHost={`https://${dashboardHost}`} />
            </div>
          ) : (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-400">
              Create a project below to get a widget snippet
            </div>
          )}
        </header>

        <NewProjectForm />

        <DashboardProjects />
      </div>
    </div>
  );
}
