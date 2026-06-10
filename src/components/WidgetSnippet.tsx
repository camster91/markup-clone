'use client';

import { useState } from 'react';

export default function WidgetSnippet() {
  const [copied, setCopied] = useState(false);

  const snippet = '<script src="https://markup.ashbi.ca/widget.js" data-api-key="YOUR_KEY_HERE"></script>';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <code className="text-sm bg-gray-100 px-2 py-1 rounded text-pink-600">
          <script src="https://markup.ashbi.ca/widget.js" data-api-key="YOUR_KEY_HERE"></script>
        </code>
        <button
          onClick={handleCopy}
          className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-gray-700 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-gray-500">Set the data-api-key attribute to your project API key (see project settings).</p>
    </div>
  );
}