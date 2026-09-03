# Repository Guidelines

## Project Structure & Module Organization

The application is a Chinese-only, plain HTML/CSS/JavaScript mini-game platform backed by Node.js and WebSocket. `index.html` loads shared modules from `js/`; each game lives in `js/games/<game-id>.js` and registers with `GameRegistry`. `server.js` owns rooms and hidden-information state. Automated checks live in `tests/`, with two-browser journeys under `tests/e2e/`; utility scripts are in `scripts/`. See `docs/ARCHITECTURE.md` before changing game lifecycle or online synchronization.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency set (Node.js 20 or newer).
- `npm start`: serve the app at `http://localhost:8777`.
- `npm run lint`: run ESLint across browser, server, script, and test code.
- `npm test`: run smoke, unit, integrity, security, and online integration checks.
- `npm run test:unit` or `npm run test:online`: run a focused suite.
- `npm run test:e2e`: run Playwright critical flows; install Chromium first with `npx playwright install chromium` if needed.

There is no compilation step; browser files are served directly.

## Coding Style & Naming Conventions

Follow adjacent code and use two-space indentation, semicolons, double quotes, and `const`/`let`. Browser modules are classic scripts, often isolated in an IIFE; Node files use CommonJS. Use lowercase descriptive game IDs and matching filenames. All user-facing UI must remain Simplified Chinese; keep English internal identifiers. For hidden-information games, validate actions on the server and never relay secret state. Do not migrate to a frontend framework or add gameplay unless explicitly requested. Run ESLint before submitting; no separate formatter is configured.

## Testing Guidelines

Unit tests use `node:test` and `node:assert`. Name unit files `*.test.js`, server integrations `*-it.js`, and Playwright specs `*.spec.js`. Add regression coverage for behavior changes. Browser room flows must use two independent Playwright contexts against the real server. Run `npm run verify` before claiming completion.

## Commit & Pull Request Guidelines

History uses concise conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `polish:`, `chore:`, and `ci:`. Complete the entire requested milestone without stopping after a small subtask. During implementation, create several focused local commits (usually 3–8), but do not push them individually. Keep commits imperative and never rewrite pushed history.

After the milestone is complete, run `npm run verify` and a fresh local GPT review over the full milestone range, always using the original milestone base for every review round. Fix every valid P0/P1/P2 finding in additional local commits, then repeat verification and fresh review until PASS. Only after PASS may the milestone feature branch be pushed and one pull request created or updated. Put later PR-review fixes on that same branch as new commits. Stop after updating the PR and wait for external ChatGPT review. Never merge automatically; the user controls merges and all direct pushes to `main`.

Pull requests should explain the milestone, link related issues, list commands run, and include screenshots for visible UI changes. Target `main` and call out protocol, persistence, security, or localization impacts explicitly.

## Security & Configuration

Never commit `.env`, `data/`, or Playwright artifacts. Hidden-information games must be server-authoritative: never send opponent mine coordinates in state, reconnect payloads, or progress messages. Preserve the extensible registry, room/reconnect infrastructure, and responsive UI.

## Mandatory Review Gate

At the end of every meaningful milestone, run deterministic verification and launch a fresh independent review with an explicit original milestone base, for example `npm run review -- --base <milestone-base>`. Inspect `.review/latest.md`; reviewer failure or `BLOCK` is not approval. The current `review:cycle` command does not pin a base, so do not use it as the milestone gate; run each review round explicitly with the same base. Do not push before PASS, and do not merge after opening or updating the milestone PR.
