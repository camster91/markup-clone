export const ISSUE_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const PIN_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type PinStatus = (typeof PIN_STATUSES)[number];

export const MAX_TAGS_PER_PIN = 5;
export const MAX_TAG_NAME_LENGTH = 32;
export const UNASSIGNED_FILTER = 'UNASSIGNED' as const;

export type NormalizedTag = { name: string; key: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/u;

export function normalizeTagNames(value: unknown): Result<NormalizedTag[]> {
  if (!Array.isArray(value)) return { ok: false, error: 'tagNames must be an array' };
  if (value.length > MAX_TAGS_PER_PIN) {
    return { ok: false, error: `tagNames must contain at most ${MAX_TAGS_PER_PIN} tags` };
  }

  const tags: NormalizedTag[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (typeof raw !== 'string') return { ok: false, error: 'tagNames must contain only strings' };
    const name = raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!name) return { ok: false, error: 'tag names cannot be empty' };
    if (name.length > MAX_TAG_NAME_LENGTH) {
      return { ok: false, error: `tag names must be ${MAX_TAG_NAME_LENGTH} characters or fewer` };
    }
    if (CONTROL_CHAR_RE.test(name)) return { ok: false, error: 'tag names contain invalid characters' };

    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ name, key });
  }

  return { ok: true, value: tags };
}

export type IssueMetadataPatch = {
  status?: PinStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
  tags?: NormalizedTag[];
  hasInternalChanges: boolean;
};

export function parseIssueMetadataPatch(value: unknown): Result<IssueMetadataPatch> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'request body must be an object' };
  }

  const body = value as Record<string, unknown>;
  const patch: IssueMetadataPatch = { hasInternalChanges: false };
  let hasSupportedChange = false;

  if (Object.hasOwn(body, 'status')) {
    if (typeof body.status !== 'string' || !(PIN_STATUSES as readonly string[]).includes(body.status)) {
      return { ok: false, error: 'status must be OPEN or RESOLVED' };
    }
    patch.status = body.status as PinStatus;
    hasSupportedChange = true;
  }

  if (Object.hasOwn(body, 'priority')) {
    if (typeof body.priority !== 'string' || !(ISSUE_PRIORITIES as readonly string[]).includes(body.priority)) {
      return { ok: false, error: 'priority is invalid' };
    }
    patch.priority = body.priority as IssuePriority;
    patch.hasInternalChanges = true;
    hasSupportedChange = true;
  }

  if (Object.hasOwn(body, 'assigneeId')) {
    if (body.assigneeId !== null && (typeof body.assigneeId !== 'string' || !UUID_RE.test(body.assigneeId))) {
      return { ok: false, error: 'assigneeId must be a UUID or null' };
    }
    patch.assigneeId = body.assigneeId as string | null;
    patch.hasInternalChanges = true;
    hasSupportedChange = true;
  }

  if (Object.hasOwn(body, 'tagNames')) {
    const tags = normalizeTagNames(body.tagNames);
    if (!tags.ok) return tags;
    patch.tags = tags.value;
    patch.hasInternalChanges = true;
    hasSupportedChange = true;
  }

  return hasSupportedChange
    ? { ok: true, value: patch }
    : { ok: false, error: 'no supported changes supplied' };
}

type FilterablePin = {
  status: string;
  priority?: string;
  assignee?: { id: string } | null;
  tags?: Array<{ id: string }>;
};

export type IssueFilters = {
  status?: string;
  priority?: string;
  assigneeId?: string;
  tagId?: string;
};

export function pinMatchesIssueFilters(pin: FilterablePin, filters: IssueFilters): boolean {
  if (filters.status && pin.status !== filters.status) return false;
  if (filters.priority && (pin.priority ?? 'NONE') !== filters.priority) return false;
  if (filters.assigneeId === UNASSIGNED_FILTER && pin.assignee) return false;
  if (filters.assigneeId && filters.assigneeId !== UNASSIGNED_FILTER && pin.assignee?.id !== filters.assigneeId) {
    return false;
  }
  if (filters.tagId && !(pin.tags ?? []).some((tag) => tag.id === filters.tagId)) return false;
  return true;
}
