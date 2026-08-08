'use client';

import { useState, type FormEvent } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

type Branding = {
  brandName: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  reviewerWelcome: string | null;
};

type Props = {
  workspaceId: string;
  initialBranding: Branding;
};

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

export default function WorkspaceBrandingForm({ workspaceId, initialBranding }: Props) {
  const [brandName, setBrandName] = useState(initialBranding.brandName ?? '');
  const [logoUrl, setLogoUrl] = useState(initialBranding.logoUrl ?? '');
  const [accentColor, setAccentColor] = useState(initialBranding.accentColor ?? '#2563eb');
  const [reviewerWelcome, setReviewerWelcome] = useState(initialBranding.reviewerWelcome ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const previewAccent = /^#[0-9a-f]{6}$/i.test(accentColor.trim()) ? accentColor.trim() : '#2563eb';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({
        brandName: optional(brandName),
        logoUrl: optional(logoUrl),
        accentColor: optional(accentColor),
        reviewerWelcome: optional(reviewerWelcome),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(body?.error || 'Could not save branding');
      setSaving(false);
      return;
    }
    setMessage('Branding saved');
    setSaving(false);
  }

  return (
    <section aria-labelledby="workspace-branding-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <form onSubmit={save} className="space-y-4">
          <div>
            <h2 id="workspace-branding-heading" className="text-lg font-semibold text-gray-950">Client review branding</h2>
            <p className="mt-1 text-sm text-gray-600">A restrained identity for invitations and client-facing reviews.</p>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Reviewer-facing brand name
            <input aria-label="Reviewer-facing brand name" maxLength={120} value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="Your agency name" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-950" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Logo URL
            <input aria-label="Logo URL" type="url" maxLength={2048} value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://cdn.example.com/logo.png" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-950" />
            <span className="mt-1 block text-xs text-gray-500">HTTPS raster images only. Leave blank to use the brand initial.</span>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Brand accent color
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-lg border border-gray-300" style={{ backgroundColor: previewAccent }} />
              <input aria-label="Brand accent color" maxLength={7} pattern="#[0-9A-Fa-f]{6}" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-gray-950" />
            </div>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Reviewer welcome message
            <textarea aria-label="Reviewer welcome message" maxLength={280} rows={3} value={reviewerWelcome} onChange={(event) => setReviewerWelcome(event.target.value)} placeholder="Review the latest build and leave feedback directly on the page." className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-gray-950" />
            <span className="mt-1 block text-xs text-gray-500">{reviewerWelcome.length}/280</span>
          </label>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save branding'}</button>
          {message ? <p role="status" className="text-sm text-gray-700">{message}</p> : null}
        </form>

        <div aria-label="Client review branding preview" className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <div className="h-2" style={{ backgroundColor: previewAccent }} />
          <div className="p-5">
            {logoUrl.startsWith('https://') ? (
              // eslint-disable-next-line @next/next/no-img-element -- operator-supplied remote logo has no fixed host allowlist
              <img src={logoUrl} alt="" className="mb-4 h-10 max-w-full object-contain object-left" />
            ) : (
              <div aria-hidden="true" className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg font-bold text-white" style={{ backgroundColor: previewAccent }}>
                {(brandName.trim() || 'A').slice(0, 1).toUpperCase()}
              </div>
            )}
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Review portal</p>
            <p className="mt-1 text-xl font-semibold text-gray-950">{brandName.trim() || 'Your agency'}</p>
            <p className="mt-3 text-sm leading-6 text-gray-600">{reviewerWelcome.trim() || 'Review the latest build and leave clear, contextual feedback.'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
