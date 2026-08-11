'use client';

import { useRef, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

export default function ImageReviewUpload({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (uploading) return;
    if (!file) {
      setError('Choose an image to upload.');
      return;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Choose a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    if (file.size === 0) {
      setError('The selected image is empty.');
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setError('The selected image is larger than the 8 MB limit.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, {
        method: 'POST',
        headers: dashboardHeaders(),
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Image upload failed.');
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium text-gray-800">
          <span className="block">Add an image to this review</span>
          <span className="mt-1 block text-xs font-normal text-gray-500">PNG, JPEG, GIF, or WebP - up to 8 MB</span>
          <input
            ref={inputRef}
            aria-label="Upload image for review"
            className="mt-2 block w-full text-sm text-gray-700"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="min-h-[44px] rounded bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? 'Uploading...' : 'Upload image'}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
