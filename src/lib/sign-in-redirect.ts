const WORKSPACE_PATH = /^\/workspaces(?:\/[A-Za-z0-9_-]+(?:\/teams\/[A-Za-z0-9_-]+)?)?$/;

export function safeReturnPath(value: string | string[] | undefined): string | null {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || path.length > 512 || path.includes('\\') || path.includes('\0')) return null;
  if (path === '/archive' || WORKSPACE_PATH.test(path)) return path;
  return null;
}
export function signInRedirect(returnTo: string): string {
  const safePath = safeReturnPath(returnTo);
  return safePath ? `/?next=${encodeURIComponent(safePath)}#sign-in` : '/#sign-in';
}

export function returnDestinationLabel(returnTo: string | null): string | null {
  if (returnTo === '/archive') return 'archived sites';
  if (returnTo?.startsWith('/workspaces')) return 'agency workspaces';
  return null;
}
