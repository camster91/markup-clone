export type MarkupEventName = 'ready' | 'modechange' | 'submitted' | 'error';

export type MarkupEventDetailMap = {
  ready: { ready: true; projectId: string };
  modechange: { feedbackMode: boolean };
  submitted: { pinId: string | null; projectId: string };
  error: { message: string; code?: string };
};

export type MarkupState = { ready: boolean; feedbackMode: boolean };

export type MarkupSDKOptions = {
  host: string;
  projectId: string;
  apiKey: string;
  authorName?: string;
  loadTimeoutMs?: number;
};

type WidgetGlobal = {
  startFeedback(): void;
  stopFeedback(): void;
  destroy(): void;
  getState(): MarkupState;
};

declare global {
  interface Window { MarkupWidget?: WidgetGlobal }
}

function normalizedHost(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('host must be a valid URL'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('host must use https outside localhost');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('host must be an origin without credentials, path, query, or fragment');
  }
  return url.origin;
}

function validateOptions(options: MarkupSDKOptions) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.projectId)) {
    throw new Error('projectId must be a UUID');
  }
  if (!/^mk_[A-Za-z0-9_-]{16,128}$/.test(options.apiKey)) throw new Error('apiKey has an invalid shape');
  if (options.authorName !== undefined && (!options.authorName.trim() || options.authorName.length > 120)) {
    throw new Error('authorName must be 1 to 120 characters');
  }
}

export class MarkupSDK {
  readonly host: string;
  readonly projectId: string;
  private readonly apiKey: string;
  private readonly authorName?: string;
  private readonly loadTimeoutMs: number;
  private script: HTMLScriptElement | null = null;
  private mountPromise: Promise<MarkupState> | null = null;

  constructor(options: MarkupSDKOptions) {
    validateOptions(options);
    this.host = normalizedHost(options.host);
    this.projectId = options.projectId;
    this.apiKey = options.apiKey;
    this.authorName = options.authorName?.trim();
    this.loadTimeoutMs = options.loadTimeoutMs ?? 15_000;
  }

  mount(): Promise<MarkupState> {
    if (this.mountPromise) return this.mountPromise;
    this.mountPromise = new Promise((resolve, reject) => {
      let timeout = 0;
      const cleanup = () => {
        document.removeEventListener('markup:ready', onReady as EventListener);
        if (timeout) window.clearTimeout(timeout);
      };
      const onReady = (event: Event) => {
        const detail = (event as CustomEvent<MarkupEventDetailMap['ready']>).detail;
        if (detail?.projectId !== this.projectId) return;
        cleanup();
        resolve(this.getState());
      };
      document.addEventListener('markup:ready', onReady as EventListener);
      const script = document.createElement('script');
      script.src = `${this.host}/widget.js`;
      script.async = true;
      script.dataset.apiKey = this.apiKey;
      script.dataset.projectId = this.projectId;
      if (this.authorName) script.dataset.author = this.authorName;
      script.addEventListener('error', () => {
        cleanup();
        this.mountPromise = null;
        reject(new Error('Failed to load the feedback widget'));
      }, { once: true });
      this.script = script;
      document.head.appendChild(script);
      timeout = window.setTimeout(() => {
        cleanup();
        this.mountPromise = null;
        reject(new Error('Timed out waiting for the feedback widget'));
      }, this.loadTimeoutMs);
    });
    return this.mountPromise;
  }

  startFeedback(): void { this.widget().startFeedback(); }
  stopFeedback(): void { this.widget().stopFeedback(); }
  getState(): MarkupState { return window.MarkupWidget?.getState() ?? { ready: false, feedbackMode: false }; }

  on<K extends MarkupEventName>(name: K, listener: (detail: MarkupEventDetailMap[K]) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<MarkupEventDetailMap[K]>).detail);
    document.addEventListener(`markup:${name}`, handler);
    return () => document.removeEventListener(`markup:${name}`, handler);
  }

  destroy(): void {
    window.MarkupWidget?.destroy();
    this.script?.remove();
    this.script = null;
    this.mountPromise = null;
  }

  private widget(): WidgetGlobal {
    if (!window.MarkupWidget) throw new Error('Feedback widget is not mounted');
    return window.MarkupWidget;
  }
}

export default MarkupSDK;
