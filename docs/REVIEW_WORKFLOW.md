# Local GPT/Codex Review Workflow

This repository has a small, local quality gate built around independent Codex subprocesses. The implementation agent and reviewer never share a resumed session.

## Normal workflow

```bash
npm run verify
npm run review
cat .review/latest.md
npm run review:fix
npm run review
```

This sequence is mandatory after every meaningful implementation milestone: finish the code, run verification, then run `npm run review` automatically before reporting completion. Never treat an unavailable or failed reviewer as approval.

After every completed change set, update Git and submit it for review: commit and push the current branch, or push a feature branch and open a pull request. Do not leave completed implementation work only in the local working tree, and never force-push or rewrite history. Do not push an incomplete or blocked milestone.

Or run the bounded autonomous sequence:

```bash
npm run review:cycle
```

`review:cycle` verifies first, runs a fresh read-only reviewer, launches a fresh write-enabled fixer for BLOCK findings, verifies again, and reviews again (two rounds by default; set `MAX_REVIEW_ROUNDS=3` to allow three). It never commits, pushes, resets, or discards changes.

## Review scope

`npm run review` selects `origin/main` as the base when available, then local `main`/`master`, then `HEAD~1`. It reviews committed changes in that range plus staged, unstaged, and untracked files. Use `npm run review -- --base HEAD~1`, `--commit <sha>`, or `--working-tree` for an explicit scope.

The reviewer receives repository location, scope metadata, and instructions; it inspects the actual files and diff itself rather than receiving a repository dump. Its Codex process uses `--sandbox read-only`, `--ephemeral`, ignores inherited config/rules, and writes its final message to a temporary file. The fixer uses a separate fresh `codex exec --sandbox workspace-write` process and receives `.review/latest.json`.

## Reports and configuration

The reviewer validates strict JSON against `.review/review-schema.json`, writes `.review/latest.json` and `.review/latest.md`, and exits nonzero for BLOCK or malformed/unavailable output. Reports are ignored by Git. `CODEX_REVIEW_MODEL`, `CODEX_FIX_MODEL`, `CODEX_REVIEW_TIMEOUT_MS`, and `CODEX_BIN` are optional environment overrides; authentication comes from the local Codex installation.

Do not use `codex exec resume` for review or fixing. A reviewer failure is never treated as approval. Read `.review/REVIEWER.md` and `.review/FIXER.md` when changing the harness.
