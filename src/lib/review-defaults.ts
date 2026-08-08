export const DEFAULT_REVIEW_ROUND_TEMPLATE = 'Review round {n}';

export type ReviewDefaults = {
  reviewRoundNameTemplate: string;
  reviewRoundCommentsPaused: boolean;
};

type Parsed = { ok: true; value: ReviewDefaults } | { ok: false; error: string };

export function parseReviewDefaults(value: unknown): Parsed {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Review defaults are required' };
  const row = value as Record<string, unknown>;
  if (typeof row.reviewRoundNameTemplate !== 'string') return { ok: false, error: 'Review round template must be a string' };
  const template = row.reviewRoundNameTemplate.trim();
  if (template.length < 3 || template.length > 120) return { ok: false, error: 'Review round template must be 3 to 120 characters' };
  if (!template.includes('{n}')) return { ok: false, error: 'Review round template must include {n}' };
  if (/\p{Cc}/u.test(template)) return { ok: false, error: 'Review round template contains invalid characters' };
  if (typeof row.reviewRoundCommentsPaused !== 'boolean') return { ok: false, error: 'Pause default must be true or false' };
  return {
    ok: true,
    value: {
      reviewRoundNameTemplate: template,
      reviewRoundCommentsPaused: row.reviewRoundCommentsPaused,
    },
  };
}

export function expandReviewRoundTemplate(template: string, number: number): string {
  return template.replaceAll('{n}', String(number));
}
