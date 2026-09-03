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

History uses concise conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `polish:`, `chore:`, and `ci:`. Keep commits focused and imperative. Pull requests should explain the change, link related issues, list commands run, and include screenshots for visible UI changes. Target `main` and call out protocol, persistence, security, or localization impacts explicitly.

## Security & Configuration

Never commit `.env`, `data/`, or Playwright artifacts. Hidden-information games must be server-authoritative: never send opponent mine coordinates in state, reconnect payloads, or progress messages. Preserve the extensible registry, room/reconnect infrastructure, and responsive UI.

Do not create commits, push, or rewrite history unless the user explicitly requests it. For a major milestone, once verification and the independent review gate pass, commit the focused milestone and push it to the configured GitHub remote when the user has authorized GitHub submission.

## Mandatory Review Gate

After every meaningful code change, run deterministic verification and then launch a fresh independent review with `npm run review`. Inspect `.review/latest.md`; a reviewer failure or `BLOCK` result must be reported and resolved or explicitly surfaced before claiming the work is complete. Use `npm run review:cycle` when fixes and a bounded re-review are appropriate.
