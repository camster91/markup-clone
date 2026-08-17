'use client';

import { useState } from 'react';

const pins = [
  {
    id: 1,
    title: 'Keep the heading together',
    comment: 'Can we keep “earns attention” on one line at tablet widths?',
    author: 'Maya · Client',
    status: 'Open',
    color: 'bg-rose-500',
    position: 'left-[69%] top-[28%]',
    context: ['1024 × 768', '/work', 'h1.hero-title'],
  },
  {
    id: 2,
    title: 'Button needs a clearer action',
    comment: 'Change this to “View our work” and link to the project grid.',
    author: 'Jordan · Strategist',
    status: 'In progress',
    color: 'bg-sky-500',
    position: 'left-[29%] top-[58%]',
    context: ['1440 × 900', '/', 'a.hero-cta'],
  },
  {
    id: 3,
    title: 'Mobile spacing approved',
    comment: 'This spacing feels much better now. Ready to sign off.',
    author: 'Maya · Client',
    status: 'Resolved',
    color: 'bg-emerald-500',
    position: 'bottom-[12%] right-[14%]',
    context: ['375 × 812', '/', 'section.client-logos'],
  },
];

export default function DemoReview() {
  const [selectedId, setSelectedId] = useState(1);
  const selected = pins.find((pin) => pin.id === selectedId) ?? pins[0];

  return (
    <div className="grid overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section className="relative min-h-[34rem] overflow-hidden bg-[#edf4ef] p-6 text-emerald-950 sm:p-10" aria-label="Example website with feedback pins">
        <div className="flex items-center justify-between border-b border-emerald-950/10 pb-5 text-xs font-semibold">
          <span>ACME STUDIO</span>
          <span className="hidden text-emerald-900/55 sm:block">Work &nbsp; About &nbsp; Contact</span>
        </div>
        <div className="mt-14 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Strategy · design · development</p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">Digital work that earns attention.</h2>
          <p className="mt-5 max-w-lg text-sm leading-6 text-emerald-950/65 sm:text-base">We help ambitious teams turn clear strategy into fast, thoughtful digital experiences.</p>
          <div className="mt-8 inline-flex rounded-full bg-emerald-950 px-5 py-3 text-sm font-semibold text-white">Start a project</div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 grid grid-cols-3 gap-px bg-emerald-950/10">
          {['Northstar', 'Fieldwork', 'Relay'].map((name) => <div key={name} className="bg-white/35 px-4 py-5 text-center text-xs font-semibold text-emerald-950/55">{name}</div>)}
        </div>
        {pins.map((pin) => (
          <button
            key={pin.id}
            type="button"
            aria-label={`Open feedback pin ${pin.id}: ${pin.title}`}
            aria-pressed={selectedId === pin.id}
            onClick={() => setSelectedId(pin.id)}
            className={`absolute ${pin.position} ${pin.color} grid size-11 place-items-center rounded-full border-4 border-white text-sm font-bold text-white shadow-lg transition hover:scale-110 focus-visible:scale-110 ${selectedId === pin.id ? 'ring-4 ring-slate-900/20' : ''}`}
          >
            {pin.id}
          </button>
        ))}
      </section>

      <aside className="border-t border-slate-200 bg-white p-6 lg:border-l lg:border-t-0" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Feedback #{selected.id}</p>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${selected.status === 'Resolved' ? 'bg-emerald-100 text-emerald-800' : selected.status === 'In progress' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>{selected.status}</span>
        </div>
        <h3 className="mt-5 text-xl font-semibold text-slate-950">{selected.title}</h3>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm leading-6 text-slate-700">{selected.comment}</p>
          <p className="mt-3 text-xs font-medium text-slate-500">{selected.author}</p>
        </div>
        <dl className="mt-6 space-y-3 border-t border-slate-200 pt-5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-slate-500">Viewport</dt><dd className="font-medium text-slate-800">{selected.context[0]}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-slate-500">Route</dt><dd className="font-mono text-xs text-slate-800">{selected.context[1]}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-slate-500">Selector</dt><dd className="max-w-40 truncate font-mono text-xs text-slate-800">{selected.context[2]}</dd></div>
        </dl>
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          Read-only demo. In a workspace, your team can reply, assign status, attach files, and move feedback through a review round.
        </div>
      </aside>
    </div>
  );
}
