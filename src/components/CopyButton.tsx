'use client';

import { useState } from 'react';

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-gray-700 transition-colors whitespace-nowrap"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
