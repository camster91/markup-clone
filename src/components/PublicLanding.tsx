import Link from 'next/link';
import AuthGate from './AuthGate';

type PublicLandingProps = {
  returnTo: string | null;
  destinationLabel: string | null;
};

const capabilities = [
  {
    eyebrow: 'Review any build',
    title: 'Website, image, and PDF feedback',
    description: 'Pin comments directly to a live page or uploaded creative. Everyone discusses the same visual context.',
  },
  {
    eyebrow: 'Ship with context',
    title: 'Developer-ready handoff',
    description: 'Capture viewport, browser, selector, route, and console context alongside the request.',
  },
  {
    eyebrow: 'Keep clients moving',
    title: 'Rounds, sharing, and sign-off',
    description: 'Give clients a focused review link while your team keeps ownership, status, and delivery history.',
  },
];

export default function PublicLanding({ returnTo, destinationLabel }: PublicLandingProps) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07120f] text-white">
      <div className="relative isolate">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] bg-[radial-gradient(circle_at_18%_16%,rgba(52,211,153,0.17),transparent_30%),radial-gradient(circle_at_84%_8%,rgba(56,189,248,0.14),transparent_32%)]" />

        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8" aria-label="Public navigation">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-200" aria-hidden="true">V</span>
            <span>Visual Feedback</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/demo" className="hidden text-sm text-slate-300 transition hover:text-white sm:inline">Explore demo</Link>
            <a href="#sign-in" className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:border-white/35 hover:bg-white/5">Sign in</a>
          </div>
        </nav>

        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-28 lg:pt-20">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
              Built for web teams and client delivery
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
              Turn website feedback into developer-ready work.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Collect precise visual comments, keep client reviews organized, and hand every fix to your team with the context they need.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/demo" className="inline-flex min-h-12 items-center justify-center rounded-full bg-emerald-300 px-6 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200">
                Explore the review demo
              </Link>
              <a href="https://www.ashbi.ca/contact/" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-6 py-3 font-semibold text-white transition hover:border-white/40 hover:bg-white/5">
                Request agency access
              </a>
            </div>
            <p className="mt-4 text-sm text-slate-400">No data is created in the public demo.</p>
          </div>

          <div className="relative mx-auto w-full max-w-xl" aria-label="Product workflow preview">
            <div className="absolute -inset-8 -z-10 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#101c18] shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <span className="size-2 rounded-full bg-emerald-300" />
                  Northstar launch review
                </div>
                <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">3 open</span>
              </div>
              <div className="grid min-h-[25rem] grid-cols-[minmax(0,1fr)_9.75rem] sm:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="relative overflow-hidden bg-[#ecf4ee] p-5 text-emerald-950 sm:p-7">
                  <div className="flex items-center justify-between border-b border-emerald-950/10 pb-4 text-xs font-semibold">
                    <span>NORTHSTAR STUDIO</span><span className="text-emerald-800/60">Work · About · Contact</span>
                  </div>
                  <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Strategy to launch</p>
                  <div className="mt-3 max-w-sm text-3xl font-semibold leading-tight sm:text-4xl">Digital work that earns attention.</div>
                  <div className="mt-7 h-10 w-32 rounded-full bg-emerald-900" />
                  <div className="absolute left-[70%] top-[29%] grid size-10 place-items-center rounded-full border-4 border-white bg-rose-500 text-sm font-bold text-white shadow-lg">1</div>
                  <div className="absolute bottom-[25%] left-[32%] grid size-10 place-items-center rounded-full border-4 border-white bg-sky-500 text-sm font-bold text-white shadow-lg">2</div>
                </div>
                <div className="border-l border-white/10 bg-[#0c1714] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Selected pin</p>
                  <p className="mt-3 text-sm font-semibold text-white">Hero heading wraps early</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Can we keep “earns attention” together on tablet?</p>
                  <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-[11px] text-slate-400">
                    <div className="flex justify-between gap-2"><span>Viewport</span><span className="text-slate-200">1024 × 768</span></div>
                    <div className="flex justify-between gap-2"><span>Route</span><span className="text-slate-200">/work</span></div>
                    <div className="flex justify-between gap-2"><span>Status</span><span className="text-amber-200">Open</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="border-y border-white/10 bg-white/[0.035]" aria-labelledby="capabilities-heading">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">One review system</p>
          <h2 id="capabilities-heading" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">From client note to shipped fix, without losing the thread.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {capabilities.map((capability, index) => (
              <article key={capability.title} className="rounded-3xl border border-white/10 bg-[#0d1916] p-6">
                <div className="mb-8 flex size-10 items-center justify-center rounded-full bg-emerald-300/10 text-sm font-semibold text-emerald-200">0{index + 1}</div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">{capability.eyebrow}</p>
                <h3 className="mt-3 text-xl font-semibold">{capability.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{capability.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="sign-in" className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div className="lg:pt-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Existing workspace</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Pick up where your team left off.</h2>
          <p className="mt-4 max-w-lg leading-7 text-slate-400">Sign in to manage client sites, review rounds, uploads, handoff context, and shared feedback.</p>
          {destinationLabel ? (
            <div role="status" className="mt-6 rounded-2xl border border-sky-300/20 bg-sky-300/10 p-4 text-sm text-sky-100">
              Sign in to continue to {destinationLabel}. We will return you there automatically.
            </div>
          ) : null}
        </div>
        <div className="rounded-[1.75rem] border border-white/10 bg-white p-2 text-slate-950 shadow-2xl shadow-black/30 [&_form]:mb-0 [&_form]:border-0 [&_form]:shadow-none">
          <AuthGate returnTo={returnTo} />
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-8 text-sm text-slate-400 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span>Visual Feedback · Built for practical client delivery.</span>
          <div className="flex gap-5">
            <Link href="/demo" className="hover:text-white">Product demo</Link>
            <a href="https://www.ashbi.ca/contact/" className="hover:text-white">Support &amp; privacy questions</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
