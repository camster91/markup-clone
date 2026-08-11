'use client';

import { useRef, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const PDF_TYPE = 'application/pdf';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PDF_UPLOAD_BYTES = 16 * 1024 * 1024;

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
    if (!IMAGE_TYPES.has(file.type) && file.type !== PDF_TYPE) {
      setError('Choose a PNG, JPEG, GIF, or WebP image, or a PDF file.');
      return;
    }
    if (file.size === 0) {
      setError('The selected image is empty.');
      return;
    }
    const maxBytes = file.type === PDF_TYPE ? MAX_PDF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;
    if (file.size > maxBytes) {
      setError(file.type === PDF_TYPE ? 'The selected PDF is larger than the 16 MB limit.' : 'The selected image is larger than the 8 MB limit.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const resource = file.type === PDF_TYPE ? 'documents' : 'images';
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${resource}`, {
        method: 'POST',
        headers: dashboardHeaders(),
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Review upload failed.');
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Review upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium text-gray-800">
          <span className="block">Add an image or PDF to this review</span>
          <span className="mt-1 block text-xs font-normal text-gray-500">Images: PNG, JPEG, GIF, WebP (8 MB). PDFs: up to 16 MB and 50 pages.</span>
          <input
            ref={inputRef}
            aria-label="Upload file for review"
            className="mt-2 block w-full text-sm text-gray-700"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
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
          {uploading ? 'Uploading...' : 'Upload for review'}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
