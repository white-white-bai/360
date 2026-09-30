# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## What this is

Two things in one repo:

1. **A teaching platform** (`platform/`) — TypeScript on Node ≥22.6, run directly with type-stripping (no bundler, no framework, no runtime deps; dev deps are `typescript` and `@types/node`). The web entry is one static page (`platform/src/ui/index.html`) served by one `node:http` server (`platform/src/ui/serve.ts`). Knowledge assets live as plain markdown: `domains/` (signed, teachable Domains), `domains-draft/` (unsigned drafts, gitignored), `library/` (product-wide Personas and Styles), `professions/` (the industry catalogue, ADR 0012).
2. **A collection of agent skills** (`.commandcode/skills/`) — Matt Pocock-style engineering skills. ADR 0001 settled that this is an asset library for expert roles, not part of the delivery vehicle.

Working here means reading, writing, or maintaining both. There is no build, lint, or test tooling at the repo root; everything runs from `platform/`.

## Platform commands (run in `platform/`)

- `npm run board` — the web entry (http server + single-page UI)
- `npm run validate` — check every knowledge asset against the rules in `src/validate/rules.ts`; exits non-zero on errors, zero on warnings
- `npm test` — `node --test` over `platform/test/`
- `npm run typecheck` — `tsc --noEmit`
- `npm run build-domain -- "<topic>"` / `npm run review-domain -- <id>` — build a Domain on demand from fetched sources, then sign it (ADR 0010)
- `npm run enter` / `npm run classroom` — terminal entry points

## Layout

- `platform/src/` — kernel, sessions, builder, validator, providers, web UI
- `domains/<id>/` — `meta.md`, `corpus.md`, `misconceptions.md`, `glossary.md`, `checks.md`, plus `sources.json` and `sources/` (gitignored) for built Domains
- `professions/professions.md` — categories and Professions with tier (A/B/C) and risk (ordinary/high); status is computed from signatures, never stored
- `library/personas/`, `library/styles/` — the shared axes
- `docs/adr/` — architecture decisions; `CONTEXT.md` is the glossary the code's vocabulary must follow
- `.commandcode/skills/<skill-name>/` — one directory per skill:
  - `SKILL.md` — the skill definition. YAML frontmatter keys: `name` (kebab-case, matches dir name), `description` (when the model may invoke it), optional `disable-model-invocation: true` (user-invoked slash command only) and `argument-hint`.
  - `agents/openai.yaml` — a short interface block (`display_name`, `short_description`) consumed by agent tooling; not referenced from SKILL.md prose.
  - Supporting docs referenced by relative link from the skill's process (e.g. `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`, `tests.md`, `HTML-REPORT.md`, `scripts/hitl-loop.template.sh`).
- `.commandcode/taste/` — the user's stated preferences (`taste.md`, `workflow/taste.md`). Read before doing work for the user; they encode communication style, matching/classification rules, and editing habits. Don't duplicate them into docs.

## Skill catalog

| Skill | Model-invoked | What it does |
|---|---|---|
| `setup-matt-pocock-skills` | no | One-time repo configuration: issue tracker, triage labels, domain doc layout. Run before first use of the other engineering skills. |
| `code-review` | yes | Two-axis review of a diff (Standards + Spec) via parallel sub-agents; reports them side by side. |
| `codebase-design` | yes | Shared vocabulary for designing deep modules; also used by other skills. |
| `domain-modeling` | yes | Build/sharpen the domain model: `CONTEXT.md` glossary + ADRs, created lazily. |
| `diagnosing-bugs` | yes | Diagnosis loop for hard bugs and performance regressions. |
| `grilling` | yes | Relentless interview that stress-tests a plan/decision/idea. |
| `tdd` | yes | Red-green-refactor workflow and integration-test guidance. |
| `grill-me` | no | User-invoked wrapper over `grilling` for a plan or design. |
| `grill-with-docs` | no | `grilling` that also writes ADRs/glossary along the way (pulls in `domain-modeling`). |
| `handoff` | no | Compacts the conversation into a handoff doc for another agent. |
| `improve-codebase-architecture` | no | Scans for deepening opportunities, presents an HTML report, then grills through the chosen one. |
| `teach` | no | Teaches the user a skill/concept within the workspace. |
| `triage` | no | Moves issues/PRs through a state machine of triage roles; writes agent-ready briefs. |
| `office-hours` | yes | Interrogates a product idea with forcing questions, then writes a design doc. `modes.md` holds the startup/builder question sets. |
| `plan-ceo-review` | yes | Founder-mode review of a plan: premise challenge, scope posture, eleven review sections. `review-sections.md` holds the sections. |
| `plan-eng-review` | yes | Engineering review of a plan or diff: architecture, code quality, tests, performance, then task synthesis. |
| `review` | yes | Pre-landing structural review of a diff, then fix-first. `checklist.md` and `specialists.md` hold the categories and lenses. |
| `investigate` | yes | Root-cause debugging loop with the Iron Law; delegates feedback-loop technique to `diagnosing-bugs`. |
| `document-generate` | yes | Writes Diataxis docs from scratch. `doc-templates.md` holds the four quadrant templates. |

The six skills from `office-hours` down were ported from [garrytan/gstack](https://github.com/garrytan/gstack) (MIT) and rewritten to this repo's conventions: gstack's runtime scaffolding (prelude scripts, telemetry, hooks, browser and gbrain integrations) was dropped, and the underlying methodology kept.

## Cross-skill dependencies

- **Setup first**: `/setup-matt-pocock-skills` must run once before the other skills are usable. It writes `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, and adds an `## Agent skills` section to CLAUDE.md or AGENTS.md.
- **Issue tracker**: skills like `code-review` and `triage` read where issues live from `docs/agents/issue-tracker.md` (GitHub via `gh`, GitLab via `glab`, local markdown under `.scratch/`, or freeform). If the file is missing, tell the user to run the setup skill — don't improvise.
- **Triage roles**: the five canonical roles are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, mapped to per-repo label strings in `docs/agents/triage-labels.md`. Skills reference roles; apply the mapped labels.
- **Domain docs**: skills read `CONTEXT.md` (single-context) or `CONTEXT-MAP.md` (multi-context, pointing to per-context `CONTEXT.md`) plus `docs/adr/`. Absence is expected — proceed silently; `domain-modeling` creates them lazily when terms/decisions resolve. Outputs must use the glossary's vocabulary and flag any contradiction with an existing ADR.

## Working on skills

- Follow the frontmatter conventions above; keep `name` matching the directory name.
- If you create a new skill, give it the same shape: `SKILL.md` (frontmatter + process), `agents/openai.yaml` interface, and reference docs under the skill directory.
- `disable-model-invocation: true` marks skills that are intentionally driven only via explicit slash command.
