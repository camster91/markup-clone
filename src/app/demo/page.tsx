import Link from 'next/link';
import DemoReview from '@/components/DemoReview';

export const metadata = {
  title: 'Review demo · Visual Feedback',
  description: 'Explore a read-only visual feedback workflow for agency and web development teams.',
};

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8" aria-label="Demo navigation">
        <Link href="/" className="font-semibold tracking-tight">← Visual Feedback</Link>
        <a href="https://www.ashbi.ca/contact/" className="rounded-full bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Request access</a>
      </nav>
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        <div className="mb-10 max-w-3xl">
          <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">Interactive · no account required</div>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">See the feedback loop before joining it.</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">Select a pin to inspect the client comment and the developer context captured with it. This sample never writes to the live service.</p>
        </div>
        <DemoReview />
        <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-3xl bg-emerald-950 p-6 text-white sm:flex-row sm:items-center sm:p-8">
          <div><h2 className="text-xl font-semibold">Ready to review a real project?</h2><p className="mt-1 text-sm text-emerald-100/70">Request an agency workspace or sign in to an existing one.</p></div>
          <div className="flex flex-wrap gap-3"><a href="https://www.ashbi.ca/contact/" className="rounded-full bg-emerald-300 px-5 py-2.5 text-sm font-semibold text-emerald-950">Request access</a><Link href="/#sign-in" className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold">Sign in</Link></div>
        </div>
      </section>
    </main>
  );
}
