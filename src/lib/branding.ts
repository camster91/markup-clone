export type WorkspaceBrandingInput = {
  name: string;
  brandName?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
  reviewerWelcome?: string | null;
};

const DEFAULT_ACCENT = '#2563eb';
const DARK_TEXT = '#111827';
const LIGHT_TEXT = '#ffffff';

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: number, second: number) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveWorkspaceBranding(input: WorkspaceBrandingInput) {
  const accentColor = /^#[0-9a-f]{6}$/i.test(input.accentColor ?? '')
    ? input.accentColor!.toLowerCase()
    : DEFAULT_ACCENT;
  const accentLuminance = luminance(accentColor);
  const darkLuminance = luminance(DARK_TEXT);
  const accentText = contrast(accentLuminance, darkLuminance) >= contrast(accentLuminance, 1)
    ? DARK_TEXT
    : LIGHT_TEXT;
  const logoUrl = input.logoUrl?.startsWith('https://') && !/\.(?:svg|svgz|xml)(?:[?#]|$)/i.test(input.logoUrl)
    ? input.logoUrl
    : null;
  return {
    displayName: input.brandName?.trim() || input.name,
    logoUrl,
    accentColor,
    accentText,
    welcome: input.reviewerWelcome?.trim()
      || 'Review the latest build and leave clear, contextual feedback.',
  };
}
