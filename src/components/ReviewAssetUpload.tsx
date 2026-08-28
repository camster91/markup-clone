'use client';

import { useRef, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const PDF_TYPE = 'application/pdf';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

export default function ReviewAssetUpload({
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
      setError('Choose an image or PDF to upload.');
      return;
    }
    const isImage = IMAGE_TYPES.has(file.type);
    const isPdf = file.type === PDF_TYPE;
    if (!isImage && !isPdf) {
      setError('Choose a PNG, JPEG, GIF, WebP, or PDF file.');
      return;
    }
    if (file.size === 0) {
      setError('The selected file is empty.');
      return;
    }
    if (file.size > (isPdf ? MAX_PDF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES)) {
      setError(isPdf ? 'The selected PDF is larger than the 20 MB limit.' : 'The selected image is larger than the 8 MB limit.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const endpoint = isPdf ? 'documents' : 'images';
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${endpoint}`, {
        method: 'POST',
        headers: dashboardHeaders(),
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : `${isPdf ? 'PDF' : 'Image'} upload failed.`);
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const isPdf = file?.type === PDF_TYPE;
  return (
    <form onSubmit={submit} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium text-gray-800">
          <span className="block">Add an image or PDF to this review</span>
          <span className="mt-1 block text-xs font-normal text-gray-500">
            Images up to 8 MB; PDFs up to 20 MB and 50 pages. Each PDF page becomes a reviewable image.
          </span>
          <input
            ref={inputRef}
            aria-label="Upload image or PDF for review"
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
          {uploading ? (isPdf ? 'Rendering PDF...' : 'Uploading...') : 'Upload for review'}
        </button>
      </div>
      {uploading && isPdf ? <p role="status" className="mt-3 text-sm text-blue-800">Rendering pages in order. Keep this review open until the upload finishes.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
