# FFH Plugin Consolidation Plan
**Date:** 2026-06-12  
**Author:** Cameron Ashley / Ashbi Design  
**Status:** DRAFT — pending Cam sign-off

## Current state

### /wp-content/mu-plugins/ (39 files, ~688K)
Mostly one-off patches accumulated since May 6. Many are:
- Style/scoring patches that belong in `ffh-design-system`
- Query/sort/filter patches that belong in `ffh-core-functionality-final`
- Shortcodes that belong in `ffh-core-functionality-final`
- 6 Elementor template JSON snapshots (should be in /private/ffh/ or git, not mu-plugins)
- 2 `.bak-2026…` files
- 1 `.disabled` file (superseded by active version)
- 2 non-FFH files: `aios-firewall-loader.php`, `hostinger-auto-updates.php`, `hostinger-preview-domain.php`, `elementor-safe-mode.php` (third-party/host)

### /wp-content/plugins/ffh-* (7 plugins, 3.1M)
- `ffh-ai-acf-connector` — keep as-is
- `ffh-ai-generator` — keep as-is
- `ffh-core-functionality-final` — keep + absorb: importer, mu-plugin business logic
- `ffh-design-system` — keep + absorb: mu-plugin design patches
- `ffh-importer` — fold into core
- `ffh-performance` — keep as-is
- `ffh-seeder` — drop (one-shot seeder, not runtime)

### Theme
- `hello-elementor` (active) + 3 wp defaults

## Target state

### /wp-content/mu-plugins/ (target: 3 files, all third-party)
- `aios-firewall-loader.php` (host, leave alone)
- `hostinger-auto-updates.php` (host, leave alone)
- `hostinger-preview-domain.php` (host, leave alone)
- Optionally: `elementor-safe-mode.php` (our safety net, keep until P1/P2 closed)

### /wp-content/plugins/ffh-* (target: 5 plugins)

| Plugin | Absorbs | Files added |
|---|---|---|
| **ffh-core-functionality-final** | mu-plugin business logic: nearby-hotels, related, filter bars (hotel/gear/editorial), house-rules, score-display, score-box, age-ratings, editorial-related-hotels, exclude-demo-editorials, gear-related-fallback, hotel-gallery, maps, ski-map, dest-top, affiliate-shortcode, no-autoplay, redirects, design-overrides (logic portion) | `includes/` directory layout |
| **ffh-design-system** | mu-plugin design/CSS: design-overrides (CSS portion), score-box styling, score-bar styling, gold token enforcement, H2 rule cleanup, hero size cap, mobile breakpoints | `assets/css/` consolidation |
| **ffh-performance** | (no change) | — |
| **ffh-ai-generator** | (no change) | — |
| **ffh-ai-acf-connector** | (no change) | — |

### /private/ffh-2026-06-12/elementor-snapshots/
6 template JSONs move out of mu-plugins.

### /private/ffh-2026-06-12/_bak-2026-06-12/
Old .bak and .disabled files archived (NOT deleted; recoverable for 14 days, then sweep).

## Migration order (one file at a time, with snapshot per step)

1. **Audit pass**: read every mu-plugin to confirm its scope & dependencies. Update this plan with what each file actually does.
2. **Template JSONs**: move 6 JSONs out of mu-plugins first (they're not PHP, can't accidentally be loaded).
3. **Design system consolidation**: move CSS-bearing mu-plugins into `ffh-design-system/assets/css/`. Re-enqueue in the plugin's main file. Verify in browser.
4. **Core consolidation**: move business-logic mu-plugins into `ffh-core-functionality-final/includes/<module>/`. Wire autoload. Verify each via the URL it powers.
5. **Importer fold**: move `ffh-importer` into `ffh-core-functionality-final/includes/importer/`. Verify with one import round-trip.
6. **Cleanup**: rename superseded mu-plugins to `*.migrated-20260612`, leave on disk for 14 days. After 14 days, sweep.
7. **Readme pass**: write README.md for each of the 3 surviving plugins + the new module structure.
8. **In-wp-admin polish**: confirm Plugins page shows them with version + description. Optional: add an "FFH" dashboard widget.

## Snapshot policy

- Pre-step snapshot: `cp -R` the touched file to `~/ffh-backups/2026-06-12-consolidation/pre-step-NN/`
- Per-step verification: live URL hit (curl), per-feature browser check
- No `rm -rf`. Renames only, recoverable for 14 days.

## Decisions still needed from Cam

1. Confirm the hostinger auto-update / preview / firewall / elementor-safe-mode files stay in mu-plugins (they're not ours).
2. `ffh-seeder` — drop, or keep on disk in `/private/ffh-2026-06-12/_archive/`?
3. README scope — write all three during this pass, or one at a time?
4. Should the new module structure include unit tests, or stay shipping-grade only?

## Risk register

- **Elementor template 3872 bindings**: the mu-plugins likely manipulate Elementor-rendered output via `the_content` / `wp_footer`. After consolidation the bindings need to fire from `plugins_loaded` rather than mu-plugin boot. Order of operations matters.
- **CSS specificity**: the design-overrides mu-plugin has 20K of CSS, much of it `!important` overrides. Folding into design-system requires preserving override chain or visual regressions will surface.
- **Plugin load order**: `ffh-core-functionality-final` currently loads before `ffh-design-system` (alphabetical). If design CSS depends on a class added by core, that breaks. Need to verify in the consolidation order.


## T1 — Audit table (mu-plugins → destination plugin)

| File | Lines | Functions / hooks | Destination |
|---|---|---|---|
| aios-firewall-loader.php | n/a | third-party host loader | KEEP in mu-plugins (host) |
| elementor-safe-mode.php | 110 | safety net | KEEP until P1/P2 closed |
| ffh-affiliate-shortcode.php | 105 | `[ffh_booking_button]`, `[ffh_amazon_button]`, footer CSS | **core** includes/affiliate |
| ffh-age-ratings.php | 45 | `[ffh_age_ratings]` + the_content inject | **core** includes/age-ratings |
| ffh-analytics.php | 178 | GA4 + Consent Mode v2, wp_head/footer, JS banner | KEEP in mu-plugins (no WP-plugin equivalent exists, single-concern, host-friendly) |
| ffh-design-overrides.php | 463 | wp_footer JS `ffhFixScoreRing` (CSS portion 20K) | **design** assets/css + small JS hook to **core** |
| ffh-dest-top.php | 17 | elementor/loop_taxonomy/args filter | **core** includes/destinations |
| ffh-editorial-filter-bar.php | 115 | wp_footer markup, pre_get_posts query edit | **core** includes/filter-bars (editorial) |
| ffh-editorial-related-hotels.php | 49 | elementor/query/ffh_related_hotels | **core** includes/editorial |
| ffh-exclude-demo-editorials.php | 69 | pre_get_posts | **core** includes/editorials |
| ffh-gear-filter-bar.php | 149 | wp_footer markup, pre_get_posts | **core** includes/filter-bars (gear) |
| ffh-gear-related-fallback.php | 58 | pre_get_posts | **core** includes/gear |
| ffh-hotel-gallery.php | 65 | `[ffh_hotel_gallery]` | **core** includes/hotel |
| ffh-hotel-score-bars.php | 60 | `[ffh_hotel_score_bars]` | **core** includes/score-bars |
| ffh-house-rules.php | 37 | `[ffh_house_rules]`, `[ffh_house_rules_body]` | **core** includes/house-rules |
| ffh-layout.php | 40 | the_content filter, wp_head inline CSS | **core** includes/layout |
| ffh-maps.php | 141 | leaflet enqueue, directory map, `[ffh_static_map]` | **core** includes/maps |
| ffh-no-autoplay.php | 40 | wp_footer JS to disable swipers | **core** includes/media |
| ffh-rating-dynamic.php | 72 | elementor/widget/render_content filter + wp_footer JS | **core** includes/rating |
| ffh-redirects.php | 26 | template_redirect | **core** includes/redirects |
| ffh-score-box.php | 73 | wp_footer JS scaleSubScoreBars (the broken one) | **core** includes/score-bars (replace with new logic) |
| ffh-score-box.php.disabled | n/a | superseded by active | T3 archive |
| ffh-score-display.php | 16 | acf/format_value filter | **core** includes/score |
| ffh-seo-config.php | 62 | admin_init hooks (Rank Math gate, etc.) | **core** includes/seo |
| ffh-ski-map.php | 77 | `[ffh_ski_map]`, `[ffh_map]` | **core** includes/maps (merge with ffh-maps.php) |
| ffh-strip-duplicate-h1.php | 26 | the_content filter | **core** includes/seo |
| ffh-template-{330,3872,578,711,765}-p0X.json | n/a | 6 elementor template snapshots | T2 move to /private/ |
| hostinger-auto-updates.php | n/a | host | KEEP |
| hostinger-preview-domain.php | n/a | host | KEEP |
| seo-debug.php | 17 | debug helper | T3 archive (one-shot) |
| ffh-dest-top.php (595B) | 17 | already counted | — |
| ffh-analytics.php.bak-20260607-121858 | 15K | old version | T3 archive |
| ffh-design-overrides.php.bak-20260612-072218 | 26K | old version | T3 archive |

## T1 — Audit table (plugins/ffh-*)

| Plugin | Version | Role | Action |
|---|---|---|---|
| ffh-ai-acf-connector | 1.0.0 | REST API bridge for AI tools | KEEP |
| ffh-ai-generator | 2.0.0 | AI content generation meta box | KEEP |
| ffh-core-functionality-final | 1.0.0 | CPT/tax/ACF + .5K of helper code | KEEP + absorb |
| ffh-design-system | 1.2.0 | Global CSS + Lora font | KEEP + absorb |
| ffh-importer | 2.5.2 | JSON importer + REST + data/ | T6 fold into core |
| ffh-performance | 1.0.1 | CWV optimizer | KEEP |
| ffh-seeder | n/a | one-shot seeder | drop, archive to /private/ |

## T1 — Audit table (plugins/ffh-core-functionality-final .bak files)

| File | Size | Date | Action |
|---|---|---|---|
| ffh-core-functionality.php | 327K | Jun 11 02:02 | KEEP (canonical) |
| ffh-core-functionality.php-2 | 249K | May 7 05:42 | T3 archive |
| ffh-core-functionality.php.bak | 248K | May 7 02:21 | T3 archive |
| ffh-core-functionality.php.bak-1781143356 | 327K | Jun 11 02:02 | T3 archive (timestamp, 1 second after canonical — likely a backup race) |
| ffh-core-functionality.php.bak-20260521 | 284K | May 21 12:17 | T3 archive |
| ffh-core-functionality.php.bak-nodata-20260521 | 284K | May 21 12:31 | T3 archive |
| ffh-core-functionality.php.bak.amenity-fix.1778073806 | 248K | May 6 13:23 | T3 archive |
| ffh-core-functionality-bkp.php | (old header) | — | T3 archive |
| elementor-1911-2026-04-20.json | n/a | Apr 20 | T2 move to /private/ (deprecated Elementor template) |

## T1 — Decision log

1. **ffh-analytics.php** stays in mu-plugins. It's a single self-contained concern, runs in `wp_head` + `wp_footer`, no other plugin needs to interact with it. Folding it into a multi-module plugin would force the consent mode + GA4 to load through core's lifecycle, which is wrong. KEEP.

2. **ffh-seeder** has no Plugin header. It's been run once. Drop from /plugins/ and archive to /private/.

3. **ffh-template-3872-p0X.json** is three iterations of the same Elementor template (p01, p02, p03). The canonical live one is p03. Move all three to /private/ and document the chain.

4. **ffh-design-overrides.php** (463 lines) is mostly CSS injected via wp_footer inline. Pure CSS belongs in ffh-design-system/assets/css/. The small JS score-ring fix is core logic — extract it into ffh-core-functionality-final/includes/score-bars/score-bars.js and enqueue from there.
