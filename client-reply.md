Hi Alexander,

One more follow-up after the round.

**Audit pass complete.** I delegated a full-surface review of the consolidated plugins and shipped 9 fixes off the back of it. The full DB snapshot is at `~/ffh-private/_archive-2026-06-12/pre-audit-2026-06-12/ffh-pre-audit-full.sql` (23.5MB) and the code surface is mirrored in `wp-content-pre-audit/` (plugins + mu-plugins + themes + acf-json + .htaccess).

**What's now hardened:**

- **Image path-traversal sink closed.** The WebP rewrite filter now strictly anchors to the uploads basedir (no ABSPATH fallback, no preg_replace re-anchoring) and rejects any path containing `..`. Same hardening on the `wp_calculate_image_srcset` filter so Elementor's srcset emits WebP too.
- **Editorial scannable load-order bug.** `strip-duplicate-h1` was running at priority 5 and removing the H1 before the scannable module at priority 15 tried to inject after it — so the scannable block was rendering at the top of editorials, not under the title. Moved scannable to priority 4 and switched the anchor to `<h2>` (more robust against the title/intro layout).
- **Importer T13 guard half-implemented.** The previous fix only guarded the default safe-mapping path. The specialist branches (`amenity_slugs`, `geo`, `rating`, etc.) could still blank existing meta on empty input. Now all paths skip when the value is null, empty, or an empty array.
- **Hotels-nearby tax_query set scoped.** The destination-scoping was firing on any `pre_get_posts` that hit the hotel filter — now it only runs on a singular hotel page (so we know which post to scope FROM) and only when the existing tax_query is actually empty (explicit `is_array && !empty` check).
- **One-shot hero-size regen tool.** Tools → Regenerate Hero Sizes. Walks up to 200 existing images and generates the 2048px `ffh-hero` intermediate size (the previous version only registered the size for new uploads). Run once after enabling the module, then leave the page.
- **hero-size loader wiring bug caught.** When I added the hero-size module earlier, a shell-quoting issue in the `sed` left the loader entries unquoted. PHP would still parse, but the foreach lookup would never find the files — so the image size was never registering. Now both lines have single quotes and the module loads.

**No further client-blocker items in the audit.** The remaining findings are all long-term maintainability: 195 `!important` declarations in `design-overrides.css` (Pin notes are in place for each), one `i18n` wrapper on a magic string, one docblock that oversold what the code does. None of these are blocking the client round.

Best,
Cameron
