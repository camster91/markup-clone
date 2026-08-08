# @ashbi/markup-sdk

Typed browser lifecycle for the Ashbi Visual Feedback website widget. Version 1.0.0
is built in this repository but is **not yet published** to npm.

```ts
import { MarkupSDK } from '@ashbi/markup-sdk';
const feedback = new MarkupSDK({ host: 'https://markup.example', projectId: 'PROJECT_UUID', apiKey: 'mk_BROWSER_WIDGET_KEY' });
await feedback.mount();
feedback.startFeedback();
const off = feedback.on('submitted', ({ pinId }) => console.log(pinId));
off();
feedback.destroy();
```

Supported methods are `mount()`, `startFeedback()`, `stopFeedback()`, `getState()`,
`on()`, and `destroy()`. Events are `ready`, `modechange`, `submitted`, and `error`.
Mounting is idempotent. `destroy()` removes UI, listeners, and the injected script.

The SDK key is browser-visible and submission-only. Never use a developer API token here.

## Content Security Policy

```text
Content-Security-Policy: script-src 'self' https://markup.example; connect-src 'self' https://markup.example; img-src 'self' data: blob: https://markup.example
```

Self-hosting requires the exact widget asset and a compatible same-origin API.
