/**
 * @-mention parsing for comment text.
 *
 * A mention is the literal form `@<email>`, e.g. `@alice@example.com`. The
 * email is matched against a permissive RFC 5322-ish pattern: alphanumerics
 * + dot / underscore / hyphen / plus in the local part, dots + hyphens in
 * the domain part, and a 2+ character TLD. We intentionally allow
 * `+` (subaddressing) and `.` in the local part — both are common — but
 * reject everything else (no quoted local parts, no IP-literal domains).
 *
 * Matching is case-insensitive on the email: `@Alice@Example.COM` and
 * `@alice@example.com` are the same mention. The returned list is
 * lowercased and deduplicated.
 *
 * Use of this helper in the comment route is fire-and-forget — the route
 * calls it for its side effect of looking up mentioned Users and emailing
 * them, but the parsing is pure and safe to call from anywhere (the
 * PinThread component uses the same regex to highlight rendered mentions).
 */

// Local part: alphanumerics, dot, underscore, hyphen, plus. 1+ chars.
// Domain: alphanumerics, dot, hyphen. TLD: 2+ letters.
// The capture group is the email (without the leading '@').
export const MENTION_RE = /@([A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Extract a unique, lowercased list of mentioned emails from a comment.
 *
 *   parseMentions('hi @Alice@Example.com, ping @bob@example.com')
 *     → ['alice@example.com', 'bob@example.com']
 *
 *   parseMentions('no mentions here')
 *     → []
 *
 *   parseMentions('@alice@EXAMPLE.com @Alice@example.com')
 *     → ['alice@example.com']   // dedupes case-insensitively
 */
export function parseMentions(text: string): string[] {
  if (typeof text !== 'string') return [];
  if (!text) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  // Reset lastIndex defensively in case a caller ever reuses a global
  // regex; the per-call regex literal is fresh so this is belt-and-braces.
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const email = m[1].toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
    // Avoid infinite loop on zero-length matches (the regex can't
    // produce one given the +/2+ quantifiers, but the guard is cheap).
    if (m.index === MENTION_RE.lastIndex) MENTION_RE.lastIndex++;
  }
  return out;
}
