'use client';
import { useState } from 'react';

export default function CommentCard({ comment }: { comment: any }) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [localStatus, setLocalStatus] = useState(comment.status);
  const [proposedCode, setProposedCode] = useState(comment.proposedCode);

  const handleDeployAgent = async () => {
    setIsDeploying(true);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: comment.id })
      });
      const data = await res.json();
      if (data.success) {
        setLocalStatus(data.data.status);
        setProposedCode(data.data.proposedCode);
      }
    } catch (err) {
      console.error(err);
    }
    setIsDeploying(false);
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative">
      <div className="absolute top-4 right-4 flex items-center space-x-2">
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${localStatus === 'OPEN' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
          {localStatus}
        </span>
      </div>
      <p className="font-medium text-gray-900 mt-1 mb-2">"{comment.text}"</p>
      <div className="text-xs text-gray-500 space-y-1 font-mono bg-gray-100 p-2 rounded">
        <p>X: {comment.xPercent.toFixed(1)}% | Y: {comment.yPercent.toFixed(1)}%</p>
        <p className="truncate" title={comment.xpath || ''}>DOM: {comment.xpath}</p>
        <p>Screen: {comment.screenSize}</p>
      </div>

      {proposedCode && (
        <div className="mt-3 bg-gray-900 rounded p-3 text-xs font-mono text-green-400 overflow-x-auto">
          <pre>{proposedCode}</pre>
        </div>
      )}

      <div className="mt-4 flex justify-between items-center">
        <span className="text-xs text-gray-400">{new Date(comment.createdAt).toLocaleString()}</span>
        {localStatus === 'OPEN' && (
          <button 
            onClick={handleDeployAgent}
            disabled={isDeploying}
            className="text-sm text-pink-600 font-medium hover:text-pink-700 disabled:opacity-50"
          >
            {isDeploying ? 'Agent Analyzing...' : 'Deploy AI Agent →'}
          </button>
        )}
      </div>
    </div>
  );
}
