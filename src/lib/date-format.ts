const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/**
 * Format server-rendered timestamps with an explicit locale and timezone.
 * This keeps the initial HTML identical when the browser hydrates in a
 * different locale or timezone.
 */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return DATE_TIME_FORMATTER.format(date);
}
