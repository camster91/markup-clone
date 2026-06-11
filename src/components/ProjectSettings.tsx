'use client';

import { useState, useRef, useEffect } from 'react';
import CopyButton from './CopyButton';

type ProjectSettingsProps = {
  projectId: string;
  projectName: string;
  onProjectUpdated: () => void;
};

export default function ProjectSettings({ projectId, projectName, onProjectUpdated }: ProjectSettingsProps) {
  const [open, setOpen] = useState(false);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRename = async () => {
    setOpen(false);
    const newName = window.prompt('Enter new project name:', projectName);
    if (!newName || newName === projectName) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://markup.ashbi.ca' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) onProjectUpdated();
  };

  const handleRegenerateKey = async () => {
    setOpen(false);
    if (!window.confirm('Regenerate the API key? The old key will stop working immediately.')) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://markup.ashbi.ca' },
      body: JSON.stringify({ regenerateKey: true }),
    });
    if (res.ok) {
      const data = await res.json();
      setShowNewKey(data.apiKey ?? null);
      onProjectUpdated();
    }
  };

  const handleDelete = async () => {
    setOpen(false);
    const confirmText = `Delete ${projectName}`;
    if (window.prompt(`Type "${confirmText}" to confirm deletion:`) !== confirmText) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'Origin': 'https://markup.ashbi.ca' },
    });
    if (res.ok) onProjectUpdated();
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Settings gear button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        aria-label="Project settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50 py-1">
          <button
            onClick={handleRename}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>

          <button
            onClick={handleRegenerateKey}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Regenerate API Key
          </button>

          <hr className="my-1 border-gray-200" />

          <button
            onClick={handleDelete}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Project
          </button>
        </div>
      )}

      {/* New API key display */}
      {showNewKey && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800 mb-1.5">New API key generated — copy it now:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-2 py-1 rounded border border-gray-200 font-mono text-sm">{showNewKey}</code>
            <CopyButton text={showNewKey} />
          </div>
          <button
            onClick={() => setShowNewKey(null)}
            className="mt-1.5 text-xs text-green-600 hover:text-green-800"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
