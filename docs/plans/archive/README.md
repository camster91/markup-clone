# archive/ — superseded plans (DO NOT BUILD FROM THESE)

This directory holds **plans that have been superseded** by later
work in the repo. Files here are kept for historical reference only.

## ⚠️ Warning to agents

**Do not open any plan in this directory and start implementing it.**
The features, file paths, and assumptions in these plans are stale.
Opening one will produce a PR that conflicts with the current code,
or that re-implements something that has already shipped.

Before writing code:

1. Read `README.md` in the parent `docs/plans/` directory.
2. Read the **active** plans (`docs/refactor/2026-06-15-refactor-plan.md`,
   `docs/refactor/2026-06-17-p1-audit.md`, `docs/qa/production-grade-assessment.md`).
3. Cross-reference with `git log --oneline | head -30` to see what
   features have actually landed.
4. If a current plan doesn't exist for the work you're about to do,
   **write one** before starting — see `docs/plans/README.md`.

## What's currently archived

(This section will list files as they're moved here. At the time of
this README's creation, no plans had been moved into `archive/` —
the FFH `CONSOLIDATION-PLAN.md` at the repo root was scheduled for
deletion rather than archive because it is unrelated to this repo.)

## How a plan gets archived

When a plan is fully superseded (all P0/P1 items merged, or the
approach was abandoned), move it here with `git mv` and add a one-line
note here explaining what replaced it. The plan's own contents stay
intact; the directory move is the signal.

Do not edit plans in place once they're archived. If you find an
archived plan that needs a correction, add a `_corrections.md` file
next to it rather than modifying the original.