import CopyButton from './CopyButton';

export default function WidgetSnippet({ apiKey, dashboardHost }: { apiKey: string; dashboardHost: string }) {
  const scriptUrl = `${dashboardHost}/widget.js`;
  const snippet = `<script src="${scriptUrl}" data-api-key="${apiKey}" data-project-key="${apiKey}"></script>`;
  return (
    <div className="flex items-center gap-2">
      <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-800 truncate max-w-md" title={snippet}>
        {snippet}
      </code>
      <CopyButton text={snippet} />
    </div>
  );
}
