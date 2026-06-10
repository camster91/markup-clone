import CopyButton from './CopyButton';

export default function WidgetSnippet({ apiKey }: { apiKey?: string }) {
  const key = apiKey || 'YOUR_KEY_HERE';
  const snippet = `<script src="https://markup.ashbi.ca/widget.js" data-api-key="${key}"></script>`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <code className="text-sm bg-gray-100 px-2 py-1 rounded text-pink-600 whitespace-pre">{snippet}</code>
        <CopyButton text={snippet} />
      </div>
      <p className="text-xs text-gray-500">Snippet includes your dashboard API key. Embed it once per client site.</p>
    </div>
  );
}
