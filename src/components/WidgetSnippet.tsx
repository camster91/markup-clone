'use client';

import { useState } from 'react';

export default function WidgetSnippet() {
  const [copied, setCopied] = useState(false);

  const snippet = '<script src="https://markup.ashbi.ca/widget.js"></script>';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2">
      <code className="text-sm bg-gray-100 px-2 py-1 rounded text-pink-600">
        &lt;script src=&quot;https://markup.ashbi.ca/widget.js&quot;&gt;&lt;/script&gt;
      </code>
      <button
        onClick={handleCopy}
        className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-gray-700 transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}