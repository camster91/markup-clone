import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("production response headers", () => {
  it("does not disclose the Next.js implementation header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("applies the browser security baseline to every route", async () => {
    const rules = await nextConfig.headers?.();
    const wildcardRule = rules?.find((rule) => rule.source === "/:path*");
    const headers = new Map(
      wildcardRule?.headers.map((header) => [header.key, header.value]),
    );

    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
  });

  it("prevents framing through Content Security Policy", async () => {
    const rules = await nextConfig.headers?.();
    const wildcardRule = rules?.find((rule) => rule.source === "/:path*");
    const csp = wildcardRule?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain("frame-ancestors 'none'");
  });
});
