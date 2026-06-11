'use client';

import { useState } from 'react';
import type { FeedbackComment } from '@/lib/types';

type Pin = { id: string; xPercent: number; yPercent: number; status: string; elementXPath?: string | null; elementHTML?: string | null; createdAt: string; comments: FeedbackComment[] };

export default function PinThread({
  pin,
  onClose,
  onStatusChange,
  onCommentAdded,
}: {
  pin: Pin;
  onClose: () => void;
  onStatusChange: (pinId: string, status: 'OPEN' | 'RESOLVED') => Promise<void>;
  onCommentAdded: (pinId: string, comment: FeedbackComment) => void;
}) {
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [author, setAuthor] = useState('Reviewer');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/pins/${pin.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: reply, author, authorRole: 'reviewer' }),
    });
    if (res.ok) {
      const data = await res.json();
      onCommentAdded(pin.id, data.data);
      setReply('');
    }
    setSubmitting(false);
  };

  const toggleStatus = () => {
    const next = pin.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    onStatusChange(pin.id, next);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${pin.status === 'OPEN' ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className="text-xs font-medium text-gray-500">
            {pin.status === 'OPEN' ? 'Open' : 'Resolved'}
          </span>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="space-y-3 mb-4">
        {pin.comments.map((c) => (
          <div
            key={c.id}
            className={`p-2 rounded text-sm ${
              c.authorRole === 'client'
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-blue-50 border border-blue-200'
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-medium text-gray-700">{c.author}</span>
              <span className="ml-1">({c.authorRole})</span>
              <span className="ml-2">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-gray-800 whitespace-pre-wrap">{c.text}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          placeholder="Reply..."
          className="w-full border border-gray-300 rounded p-2 text-sm resize-none"
          rows={2}
        />
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Your name"
            className="border border-gray-300 rounded px-2 py-1 text-xs w-24"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={toggleStatus}
              className={`text-xs px-2 py-1 rounded ${
                pin.status === 'OPEN'
                  ? 'bg-green-100 text-green-800 hover:bg-green-200'
                  : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
              }`}
            >
              {pin.status === 'OPEN' ? 'Mark resolved' : 'Reopen'}
            </button>
            <button
              type="submit"
              disabled={submitting || !reply.trim()}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Reply'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
