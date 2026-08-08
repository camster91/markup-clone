export const REVIEW_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'ARCHIVED',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function parseReviewStatus(value: unknown): ReviewStatus | null {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)
    ? (value as ReviewStatus)
    : null;
}

const TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'ARCHIVED'],
  CHANGES_REQUESTED: ['IN_REVIEW', 'APPROVED', 'ARCHIVED'],
  APPROVED: ['CHANGES_REQUESTED', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionReviewStatus(from: ReviewStatus, to: ReviewStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

type Sanitized<T> = { ok: true; value: T } | { ok: false; error: string };

function sanitizeOptionalText(value: unknown, max: number, label: string): Sanitized<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.includes('\0')) return { ok: false, error: `${label} contains invalid characters` };
  if (trimmed.length > max) return { ok: false, error: `${label} must be ≤${max} chars` };
  return { ok: true, value: trimmed };
}

export function sanitizeReviewRoundName(value: unknown): Sanitized<string | null> {
  return sanitizeOptionalText(value, 120, 'name');
}

export function sanitizeSignOffNote(value: unknown): Sanitized<string | null> {
  return sanitizeOptionalText(value, 1000, 'note');
}

type SignOffRow = {
  id: string;
  userId: string | null;
  signerEmail: string;
  note: string | null;
  createdAt: Date;
};

type ReviewRoundRow = {
  id: string;
  number: number;
  name: string | null;
  status: string;
  commentsPaused: boolean;
  createdAt: Date;
  updatedAt: Date;
  signOffs?: SignOffRow[];
  _count?: { pins: number };
};

export function serializeReviewRound(round: ReviewRoundRow, activeReviewRoundId: string | null) {
  return {
    id: round.id,
    number: round.number,
    name: round.name,
    status: round.status,
    commentsPaused: round.commentsPaused,
    isActive: round.id === activeReviewRoundId,
    pinCount: round._count?.pins ?? 0,
    signOffs: (round.signOffs ?? []).map((signOff) => ({
      id: signOff.id,
      userId: signOff.userId,
      signerEmail: signOff.signerEmail,
      note: signOff.note,
      createdAt: signOff.createdAt,
    })),
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
  };
}
