/**
 * Send email notifications to project subscribers via Mailgun HTTP API.
 * Fire-and-forget — errors are logged but never propagate.
 */
import { parseHost } from '@/lib/origin';

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
 *
 *   sendMentionEmail({
 *     to: 'alice@example.com',
 *     author: 'Bob',
 *     projectName: 'Acme',
 *     commentText: '@alice see this',
 *     pinUrl: 'https://markup.ashbi.ca/api/screenshots/<id>/image#comment-c1',
 *   })
 *
 * No-op (silently) if MAILGUN_API_KEY / MAILGUN_DOMAIN are missing — same
 * defensive gate as the subscriber path.
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
