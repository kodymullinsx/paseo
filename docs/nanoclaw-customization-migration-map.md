# Nanoclaw -> Paseo Customization Migration Map

Date: 2026-02-21

## Goal
Run Paseo as a separate standalone application in `~/.Paseo`, and apply Nanoclaw-specific behavior without blending codebases.

## Current State
- `~/.nanoclaw` has been restored to clean git `main` at commit `978f366`.
- previous blended/refactor state has been backed up at:
  - `/Users/kodymullins/nanoclaw_migration_backup_20260221-235229`
- `~/.Paseo` cloned from upstream `getpaseo/paseo` and validated:
  - `npm install` passed
  - `npm run typecheck` passed
  - `npm run build --workspace=@getpaseo/server` passed
  - `npm run build --workspace=@getpaseo/cli` passed

## Hard Requirements (from product direction)
- Web and Telegram must be treated as separate systems (no forced cross-sync).
- Web-created conversations stay web-only.
- Telegram messages stay Telegram-only.
- New conversation naming behavior:
  - initial title: `New conversation`
  - auto-rename after ~1-2 minutes based on context
  - manual rename via `/rename ...`
- Style fidelity to Paseo should be 1:1 (black/white scheme), except your artifact pane additions.
- Remove emojis from chat markers and use Paseo-style small circular indicators.
- Changes/files pane must be scoped to selected conversation context.
- Fix duplicate user message issue.

## Migration Workstreams

| Workstream | Scope | Source of truth | Status |
|---|---|---|---|
| Channel separation policy | conversation creation/routing rules (web vs telegram isolation) | backup WS routing logic + product requirements | Pending |
| Conversation naming | `New conversation`, timed auto-rename, `/rename` command | backup protocol/state notes | Pending |
| Message duplication fix | remove duplicate optimistic message behavior | backup web client patch | Pending |
| Changes/files scoping | filter dirty files by per-conversation baseline | backup server patch | Pending |
| Visual parity | restore Paseo monochrome styling and remove non-Paseo blue variants | upstream Paseo UI | Pending |
| Emoji removal | replace emoji markers with circular status dots | upstream Paseo components | Pending |
| Artifact pane | preserve only this intentional deviation | Nanoclaw requirement | Pending |
| Feature parity audit | compare Nanoclaw web to Paseo desktop/web functionality matrix | earlier parity checklist | Pending |

## Recommended Implementation Strategy
1. Keep upstream Paseo behavior as default.
2. Put Nanoclaw-specific behavior behind explicit feature flags/config in one place.
3. Avoid global protocol changes unless required; prefer additive fields/messages.
4. Implement and test each workstream in small PR-sized commits.

## Proposed First Patch Set (high confidence)
1. Web channel guardrails and conversation creation defaults.
2. Naming lifecycle (`New conversation` -> auto-rename -> `/rename`).
3. Duplicate user-message fix.
4. Remove emoji markers and use Paseo-style dots.
5. Scope changes/files pane to active conversation baseline.

## GitHub Repo Forking Constraint
Automated fork/create failed due token scope limits:
- `gh repo fork getpaseo/paseo` -> HTTP 403 (token cannot fork)
- `gh repo create kodymullinsx/paseo` -> GraphQL 403 (token cannot create repositories)

Action needed: create the destination repo manually (or provide a token with `repo` permissions), then set remotes and push from `~/.Paseo`.
