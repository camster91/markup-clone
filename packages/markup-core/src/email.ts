// @markup/core/email
//
// Mailgun HTTP-API send helpers. The package owns these so callers
// outside the app (CLI tools, scripts) can fire the same notifications
// without re-implementing the request shape.
//
// No Prisma / Next / React dep — we just need `fetch` (Node 20+ ships
// it) and `parseHost` from the sibling `./origin` module for the
// dashboard link.

import { parseHost } from './origin';

export async function sendSubscriberEmails(params: {
  projectName: string;
  path: string;
  commentText: string;
  subscriberEmails: string[];
}) {
  const { projectName, path, commentText, subscriberEmails } = params;

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const fromEmail = `feedback@${domain}`;

  if (!apiKey || !domain || subscriberEmails.length === 0) return;

  const dashboardOrigin = parseHost(process.env.DASHBOARD_HOST).origin;
  const subject = `[${projectName}] New feedback on ${path}`;
  const body = `
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: auto;">
  <h2>New Feedback</h2>
  <p><strong>Project:</strong> ${escapeHtml(projectName)}</p>
  <p><strong>Page:</strong> ${escapeHtml(path)}</p>
  <p><strong>Comment:</strong> ${escapeHtml(commentText)}</p>
  <p>
    <a href="${dashboardOrigin}">View in Dashboard</a>
  </p>
</body>
</html>
  `.trim();

  for (const to of subscriberEmails) {
    try {
      const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          from: fromEmail,
          to,
          subject,
          html: body,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[email] Mailgun error for ${to}: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error(`[email] Failed to send to ${to}:`, err);
    }
  }
}

/**
 * Send a @-mention notification to a single user.
 *
 * Mirrors `sendSubscriberEmails` (same Mailgun HTTP API, same fire-and-
 * forget contract) but the link is the pin's screenshot URL with a
 * `#comment-<id>` fragment so the recipient lands on the screenshot view
 * scrolled to the new comment.
 */
export async function sendMentionEmail(params: {
  to: string;
  author: string;
  projectName: string;
  commentText: string;
  pinUrl: string;
}) {
  const { to, author, projectName, commentText, pinUrl } = params;

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const fromEmail = `feedback@${domain}`;

  if (!apiKey || !domain) return;

  const subject = `[${projectName}] ${author} mentioned you in a comment`;
  const body = `
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: auto;">
  <h2>You were mentioned</h2>
  <p><strong>${escapeHtml(author)}</strong> mentioned you in a comment on <strong>${escapeHtml(projectName)}</strong>:</p>
  <blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555;">
    ${escapeHtml(commentText)}
  </blockquote>
  <p>
    <a href="${pinUrl}">View the comment</a>
  </p>
</body>
</html>
  `.trim();

  try {
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        from: fromEmail,
        to,
        subject,
        html: body,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Mailgun mention error for ${to}: ${res.status} ${text}`);
    }
  } catch (err) {
    console.error(`[email] Failed to send mention to ${to}:`, err);
  }
}

/** Send one branded project event to a deduplicated member recipient list. */
export async function sendProjectNotificationEmails(params: {
  recipients: string[];
  brand: { displayName: string; accentColor: string; accentText: string };
  projectName: string;
  title: string;
  message: string;
  actionUrl: string;
}) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!apiKey || !domain) return;

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const rawEmail of params.recipients) {
    const email = rawEmail.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
  }
  if (recipients.length === 0) return;

  const displayName = params.brand.displayName.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || 'Visual Feedback';
  const title = params.title.replace(/[\r\n]+/g, ' ').trim().slice(0, 160) || 'Project update';
  const projectName = params.projectName.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'Project';
  const accentColor = /^#[0-9a-f]{6}$/i.test(params.brand.accentColor) ? params.brand.accentColor : '#2563eb';
  const accentText = /^#[0-9a-f]{6}$/i.test(params.brand.accentText) ? params.brand.accentText : '#ffffff';
  const subject = `[${displayName}] ${title} — ${projectName}`;
  const html = `
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: auto; color: #111827;">
  <div style="border-top: 6px solid ${accentColor}; padding: 24px;">
    <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px;">${escapeHtml(displayName)}</p>
    <h2 style="margin: 0 0 8px;">${escapeHtml(title)}</h2>
    <p style="margin: 0 0 20px;"><strong>${escapeHtml(projectName)}</strong></p>
    <p style="line-height: 1.6;">${escapeHtml(params.message)}</p>
    <p style="margin-top: 24px;">
      <a href="${escapeHtml(params.actionUrl)}" style="display: inline-block; background-color: ${accentColor}; color: ${accentText}; padding: 10px 16px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open project review</a>
    </p>
  </div>
</body>
</html>
  `.trim();

  for (const to of recipients) {
    try {
      const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          from: `feedback@${domain}`,
          to,
          subject,
          html,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.error(`[email] Project notification error for ${to}: ${response.status} ${body}`);
      }
    } catch (error) {
      console.error(`[email] Failed to send project notification to ${to}:`, error);
    }
  }
}

function escapeHtml(s: string): string {
  // Order matters: replace `&` first so the `&` in entities like `&lt;`
  // gets re-encoded to `&amp;lt;`. Otherwise the resulting HTML decodes
  // back to the original `<` in some clients and we get email XSS.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
