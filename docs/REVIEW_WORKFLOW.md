# Local GPT/Codex Review Workflow

This repository has a small, local quality gate built around independent Codex subprocesses. The implementation agent and reviewer never share a resumed session.

## Normal workflow

```bash
# create a feature branch from the milestone base
# implement the complete milestone in 3–8 focused local commits
npm run verify
npm run review -- --base <original-milestone-base>
cat .review/latest.md
npm run review:fix
npm run verify
npm run review -- --base <original-milestone-base>
# after PASS only: push the feature branch and create/update one PR
```

Work continuously until the whole requested milestone is complete; do not stop after one small subtask while milestone items remain. Create several focused local commits during implementation, usually 3–8, without pushing intermediate commits. Once implementation is complete, run verification and a fresh independent review over the full milestone range. Never treat an unavailable or failed reviewer as approval.

For each valid P0/P1/P2 finding, make the narrow fix and regression test in an additional local commit. Repeat verification and a fresh review with the same original milestone base until PASS. Only then push the feature branch and create or update one PR for the milestone. Stop and wait for external ChatGPT PR review. Add later PR-review fixes to the same branch as new commits; never rewrite pushed history. Never merge automatically. The user controls merging and every direct push to `main`.

For an ad hoc bounded autonomous check, you may run:

```bash
npm run review:cycle
```

`review:cycle` verifies first, runs a fresh read-only reviewer, launches a fresh write-enabled fixer for BLOCK findings, verifies again, and reviews again (two rounds by default; set `MAX_REVIEW_ROUNDS=3` to allow three). It currently does not pin one base across rounds, so it is not the milestone quality gate. For milestones, run every review explicitly with `--base <original-milestone-base>`. The command never pushes, resets, merges, or discards changes.

## Review scope

For milestone reviews, record the starting commit and always use `npm run review -- --base <original-milestone-base>`. This includes all milestone commits plus staged, unstaged, and untracked files and prevents later fix rounds from narrowing the scope. The default base selection remains available for ad hoc reviews, while `--commit <sha>` and `--working-tree` provide narrower explicit scopes.

The reviewer receives repository location, scope metadata, and instructions; it inspects the actual files and diff itself rather than receiving a repository dump. Its Codex process uses `--sandbox read-only`, `--ephemeral`, ignores inherited config/rules, and writes its final message to a temporary file. The fixer uses a separate fresh `codex exec --sandbox workspace-write` process and receives `.review/latest.json`.

## Reports and configuration

The reviewer validates strict JSON against `.review/review-schema.json`, writes `.review/latest.json` and `.review/latest.md`, and exits nonzero for BLOCK or malformed/unavailable output. Reports are ignored by Git. `CODEX_REVIEW_MODEL`, `CODEX_FIX_MODEL`, `CODEX_REVIEW_TIMEOUT_MS`, and `CODEX_BIN` are optional environment overrides; authentication comes from the local Codex installation.

Do not use `codex exec resume` for review or fixing. A reviewer failure is never treated as approval. Read `.review/REVIEWER.md` and `.review/FIXER.md` when changing the harness.
