# FE-14 — accessibility audit (states / keyboard / contrast / reduced motion)

**Status: procedure only.** This document contains commands and an evidence template. It does **not** contain audit findings, pass/fail verdicts, violation counts, contrast ratios, or screen-reader observations. Findings must be produced by actually running the steps below and pasting the real output into the evidence tables. Every row is `NOT RUN` until then. No automated audit, browser run, or screen-reader session was performed while writing this file.

Scope note: the roadmap's UX/accessibility checklist is labelled FE-02 in `LinguaAI_Engineering_Roadmap.md` (loading/empty/error/success/offline states, token cost states, keyboard/focus/contrast/reduced motion, streaming live regions, audio controls). This document is the FE-14 audit slice for those frontend items. It does not change code, declare passes, or make triage decisions.

## 1. Scope and inputs

| Area | Inputs actually present in this checkout | Covered here |
|---|---|---|
| UI states | `apps/web/src/app/(dashboard)/chat/page.tsx` (`StreamState`, `statusNote`, `role="status"`), `apps/web/src/components/ui/*`, feature pages under `apps/web/src/app/(dashboard)/` | Yes — procedure and placeholders |
| Keyboard / focus | `apps/web/src/components/layout/sidebar.tsx` (mobile drawer and language listbox, Escape and focus return), `language-switcher.tsx`, `topbar.tsx`, `apps/web/src/components/ui/input.tsx`, `button.tsx` | Yes — procedure and placeholders |
| Contrast | `apps/web/src/app/globals.css` (light/dark token sets, opacity-based utility colours), `theme-provider.tsx` | Yes — procedure and placeholders |
| Reduced motion | `apps/web/src/app/globals.css` (animation keyframes and utilities, `scroll-behavior: smooth`), `components/layout/page-transition.tsx` (framer-motion), sidebar/topbar transitions | Yes — procedure and placeholders |
| Screen readers / live regions | Chat `role="log" aria-live="polite"` and `role="status"`, `Input` error `role="alert"`, toasts via `sonner` | Yes — but browser/manual evidence only; jsdom cannot prove announcements |
| Backend, billing logic, API contracts, CMS data | Out of this frontend slice | No — record out-of-scope findings in blockers, do not edit those paths |

No `.env`, `.env.local`, token, or API key values may be read, printed, or pasted into this file. Evidence should contain selectors, computed values, violation IDs, contrast ratios, and command/browser errors only. If a command needs a running app, use a local test account and never paste credentials or response bodies containing user data.

## 2. Prerequisites and safety

- Run commands from the repository root unless stated otherwise and record `git rev-parse HEAD`, branch, and whether the working tree had concurrent edits.
- Confirm installed tool versions and flag support (`pnpm exec playwright --version`, `pnpm exec eslint --version`) before relying on a flag. **Do not install or upgrade packages for this audit.** `axe-core` 4.11.1 and `eslint-plugin-jsx-a11y` 6.10.2 appear in `pnpm-lock.yaml` only as transitive dependencies; `apps/web/package.json` does not declare an axe runner or the `jsx-a11y` plugin, and `apps/web/eslint.config.mjs` does not enable it. Importing either directly is an out-of-scope code change — record the blocker instead.
- An axe scan needs a reachable running app. `apps/web/playwright.config.ts` uses `http://localhost:3000` and a single Chromium project; the existing e2e specs (`auth-flow.spec.ts`, `review-session.spec.ts`) cover flows, not accessibility. Do not claim a clean audit from a failed navigation or a blank/hydrating page.
- A reduced-motion check needs both the CSS media query and framer-motion JS behaviour. Emulating the media feature only covers CSS.
- Store raw output outside tracked source paths (for example `/tmp/linguaai-a11y-*`) until reviewed. Do not commit raw logs containing environment-specific paths or user data.
- Automated tools find a subset of issues. A clean axe result is not evidence of usable keyboard flow, correct announcements, or meaningful alt text.

## 3. What to check

The success criteria below are the checklist for this audit, not results. Record the observed value for each; do not infer it from source code alone.

### 3.1 States (WCAG 1.4.13, 3.3.1, 3.3.3, 4.1.3)

For each feature route (at minimum `chat`, `speaking`, `reading`, `writing`, `quiz`, `flashcards`, and dashboard):

- Loading: is a pending state visible and programmatically identifiable (`aria-busy`, text, or status role)? Does it appear before content shifts?
- Empty: is the empty state explanatory and not just a blank region?
- Error: is the failure described in text with a recovery action? Does the error use `role="alert"` or an equivalent announced pattern, and is the invalid field linked by `aria-invalid` / `aria-describedby`? `Input` in `components/ui/input.tsx` already wires the latter when callers pass `error`; verify callers do.
- Success / terminal: is the confirmed result distinguishable from a provisional or failed result without relying only on colour? Chat marks unconfirmed replies with a dashed border and the text "Partial response — not saved until confirmed." Verify with a screen reader and with colour disabled.
- Offline / degraded: chat turns that end at EOF or without a verified terminal set a `statusNote`; verify the note is perceivable and that a retry exists. Do not treat a network failure as success.
- Token cost / reserved / refunded: `TokenCost` badge and chat status messages must be readable and understood; verify text, not just icon or colour. Do not audit billing logic here.
- Focus after state change: after an error, cancel, or completion, does focus stay somewhere predictable rather than being lost to `<body>`?

### 3.2 Keyboard and focus (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 4.1.2)

- Tab from the top of each route: can every interactive control be reached, and is the order the same as the visual order? Check the mobile sidebar drawer (`role="dialog"`, `aria-modal`, `inert`) for a contained tab cycle and focus return to the Menu button on Escape/close.
- Focus indicator: is a visible 2px-or-clearer indicator present on every focusable control, including `Button`, `Input`, `select`, language menu items, and icon-only buttons? `button.tsx` uses `focus-visible:ring-2 ... focus-visible:ring-offset-2`; several plain inputs use `focus:ring-2 focus:ring-primary/12` or `/15` — measure, do not assume visibility.
- Language switcher: `role="menu"` with plain buttons, and sidebar `role="listbox"` with `role="option"` buttons. Verify actual keyboard behaviour (Arrow keys, Escape, Enter/Space, focus into and out of the popup). `language-switcher.tsx` has `aria-expanded` but no documented Escape/focus-return handler; verify rather than assert.
- No keyboard traps; no positive `tabindex`; no click-only `<div>`/`<span>` controls; icon-only buttons have an accessible name.
- Skip link and landmarks: verify presence of a "skip to main content" path and correct `header` / `nav` / `main` / `aside` structure in the rendered DOM, including the login/register routes.
- 200% zoom / narrow viewport: controls remain reachable and text is not clipped (WCAG 1.4.4, 1.4.10).

### 3.3 Contrast (WCAG 1.4.3, 1.4.11)

- Measure computed foreground/background pairs in both light and dark themes; do not compute from the token table by eye.
- Priority pairs from `globals.css`: primary `#58cc02` / primary-foreground `#ffffff`, muted-foreground `#64748b` on background `#fafdf6` and on muted `#f1f5f9`, accent-foreground `#ca8a04` on accent `#fef9c3`, destructive `#ef4444` on white, and dark equivalents (`#5dd106` primary, `#a0b4a4` muted-foreground on `#0d1310`, `#fbbf24` accent-foreground on `#2e2609`).
- Utility opacity lowers effective contrast (for example `text-muted-foreground/50`, `text-foreground/70`, `bg-primary/[0.06]`, `placeholder:text-muted-foreground/40`). Sample the **computed** colour over its actual composited background, including glass panels.
- Non-text contrast (3:1): focus rings, input borders, progress bars, and active nav states.
- Non-colour cues: error, success, active, unread, and provisional states must have text, shape, or icon in addition to colour. Do not record a colour-only state as passing.

### 3.4 Reduced motion (WCAG 2.3.3 in WCAG 2.2)

- With `prefers-reduced-motion: reduce` emulated, check `globals.css`: no `@media (prefers-reduced-motion: reduce)` block is present in this checkout, and `html { scroll-behavior: smooth }` plus the `animate-*`, `.skeleton`, `.typing-dot`, hover-lift, and shimmer rules run unconditionally. Record the measured behaviour, not the intent.
- Check framer-motion: `page-transition.tsx` sets `initial/animate/exit` opacity, y, and blur unconditionally; sidebar `motion.div layoutId="sidebar-active-pill"` uses a spring. Verify whether any `useReducedMotion` hook or `MotionConfig reducedMotion="user"` exists at runtime. A CSS media query alone would not disable these JS animations.
- Verify that reduced motion does not remove necessary information: a skipped entrance animation must leave content visible and focusable.

## 4. Commands and procedure to run

No command below was executed for this document. Record the exact command, date (UTC), commit SHA, tool version, exit code, and first error for each row.

### 4.1 Static inventory (no server required)

```bash
pwd
git rev-parse HEAD
git status --short

rg -n "aria-live|role=\"status\"|role=\"alert\"|aria-busy|aria-invalid|aria-describedby|aria-expanded|aria-controls|aria-current|inert|sr-only" apps/web/src -g '*.tsx'
rg -n "prefers-reduced-motion|useReducedMotion|MotionConfig|scroll-behavior|animate-|animation:" apps/web/src
rg -n "text-(muted|foreground|primary|amber|emerald|red)|bg-primary/|opacity-" apps/web/src -g '*.tsx'
```

Package/tool declarations (do not install):

```bash
node -e "const p=require('./apps/web/package.json'); console.log(JSON.stringify({dependencies:p.dependencies,devDependencies:p.devDependencies},null,2))"
pnpm exec eslint --version
pnpm exec playwright --version
```

### 4.2 Automated browser scan (only if a local app is already running)

Confirm no secrets are in shell history output or page content before capturing. Start the app using the project's documented dev command if needed; do not add dependencies.

```bash
# Terminal A, from apps/web, if the app is not already serving on :3000
pnpm dev

# Terminal B, from the repository root
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
```

Browser checks with `mcp__playwright__*` tools or an equivalent local script:

1. `browser_navigate` to `http://localhost:3000/login`, wait for hydration, take a snapshot.
2. `browser_emulate_media` with `reducedMotion: "reduce"`; snapshot computed styles and animations, then reset to `"no-preference"`.
3. `browser_resize` to a narrow viewport (for example 390x844) and repeat the keyboard pass through the mobile drawer.
4. `browser_evaluate` to dump computed colour pairs and `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
5. If an axe runner is deliberately added in an in-scope follow-up, run it and paste the violation IDs, nodes, and impact. Until then mark the axe row `BLOCKED`, not `PASS`.

Keyboard pass (manual or `browser_press_key`): Tab / Shift+Tab through login, dashboard, sidebar sections, language popovers, chat input and send/cancel controls; press Escape in the mobile drawer and language popovers; record visible focus and where focus lands after close.

### 4.3 Screen reader pass (manual evidence)

Record the reader/browser pair, date, and exact route. Suggested checks:

- Chat: send a short turn; confirm the number of announcements for `role="log" aria-live="polite"` and whether streaming deltas spam the reader. Check whether the terminal `role="status"` note is announced once.
- Error: submit an invalid form field and verify the `role="alert"` message is announced and linked to the input.
- States: verify "Partial response — not saved until confirmed.", cancelled/failed/unknown notes, and token cost/reserved/refunded text are understandable out of context.

## 5. Evidence template

Replace every `<...>` placeholder with real observed values. Keep `NOT RUN` rows if a step could not be performed; include the first error. Do not convert a source-code observation into a runtime result.

| Field | Value |
|---|---|
| Date (UTC) | `<fill after run>` |
| Git HEAD | `<git rev-parse HEAD>` |
| Branch / working tree | `<observed value; note concurrent edits if any>` |
| Node / pnpm version | `<node -v / pnpm -v>` |
| Browser + version | `<observed value>` |
| Screen reader + browser pair | `<e.g. NVDA + Firefox, VoiceOver + Safari; or NOT RUN>` |
| App URL / dev command | `<observed value>` |
| `axe` runner status | `<declared? version? NOT RUN / BLOCKED>` |

### 5.1 States

| Route and state | Check performed | Observed text / role / focus result | Result (`PASS`/`FAIL`/`NOT RUN`) | Evidence (screenshot or raw output path) |
|---|---|---|---|---|
| `chat` — loading / submitting | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `chat` — streaming / provisional | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `chat` — completed / failed / cancelled / reconnecting | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `chat` — offline / degraded note | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `<feature>` — empty | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `<feature>` — error with recovery | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| `<feature>` — success vs provisional without colour | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| Token cost reserved / refunded text | `<check>` | `<paste>` | `NOT RUN` | `<path>` |
| Screen-reader announcement count for chat stream | `<check>` | `<paste>` | `NOT RUN` | `<path>` |

### 5.2 Keyboard and focus

| Route / control | Check performed | Observed focus order, indicator, and ARIA state | Result | Evidence |
|---|---|---|---|---|
| Desktop sidebar sections | `<Tab / Enter / Space / aria-expanded>` | `<paste>` | `NOT RUN` | `<path>` |
| Mobile drawer open / Escape / close | `<Tab cycle, focus return>` | `<paste>` | `NOT RUN` | `<path>` |
| Sidebar language listbox | `<Arrow keys / Enter / Escape>` | `<paste>` | `NOT RUN` | `<path>` |
| Topbar language switcher | `<Tab / Enter / Escape / focus return>` | `<paste>` | `NOT RUN` | `<path>` |
| Icon-only buttons (theme, notifications, logout, mic, send) | `<accessible name + focus ring>` | `<paste>` | `NOT RUN` | `<path>` |
| Form inputs and errors | `<label / aria-describedby / aria-invalid>` | `<paste>` | `NOT RUN` | `<path>` |
| Skip link and landmarks | `<Tab from page top; DOM dump>` | `<paste>` | `NOT RUN` | `<path>` |
| 200% zoom / 390px viewport | `<resize and repeat>` | `<paste>` | `NOT RUN` | `<path>` |

### 5.3 Contrast

| Theme | Foreground / background pair (selector + computed values) | Measured ratio | Required ratio | Result | Evidence |
|---|---|---|---|---|---|
| Light | `<paste>` | `<number:1>` | `4.5:1` | `NOT RUN` | `<path>` |
| Light | `<paste>` | `<number:1>` | `4.5:1` | `NOT RUN` | `<path>` |
| Dark | `<paste>` | `<number:1>` | `4.5:1` | `NOT RUN` | `<path>` |
| Dark | `<paste>` | `<number:1>` | `4.5:1` | `NOT RUN` | `<path>` |
| Focus ring / input border | `<paste>` | `<number:1>` | `3:1` | `NOT RUN` | `<path>` |
| Glass / opacity-composited text | `<paste>` | `<number:1>` | `4.5:1` | `NOT RUN` | `<path>` |
| Non-colour state cue | `<paste>` | `<n/a>` | `<n/a>` | `NOT RUN` | `<path>` |

Do not mark a ratio `PASS` from a token hex value alone; paste the computed colours and the tool or calculation used.

### 5.4 Reduced motion

| Check | Check performed | Observed result with `prefers-reduced-motion: reduce` | Result | Evidence |
|---|---|---|---|---|
| CSS media query in `globals.css` | `<rg / computed style>` | `<paste; current source has no media query>` | `NOT RUN` | `<path>` |
| `html { scroll-behavior: smooth }` | `<computed style>` | `<paste>` | `NOT RUN` | `<path>` |
| `animate-*` / shimmer / floating / typing dots | `<emulate media + computed animation>` | `<paste>` | `NOT RUN` | `<path>` |
| `page-transition.tsx` framer-motion opacity/y/blur | `<navigate with media emulated>` | `<paste>` | `NOT RUN` | `<path>` |
| Sidebar active-pill spring | `<navigate with media emulated>` | `<paste>` | `NOT RUN` | `<path>` |
| Content still visible and focusable | `<snapshot / Tab pass>` | `<paste>` | `NOT RUN` | `<path>` |

### 5.5 Automated scan

| Command / tool | Exit code | Violations (critical / serious / moderate / minor) | First violation ID or first error | Raw output location |
|---|---|---|---|---|
| Static `rg` inventory | `NOT RUN` | `<n/a>` | `<paste>` | `<path>` |
| Axe scan (if runner is explicitly declared) | `BLOCKED — no declared runner` | `<n/a>` | `<paste>` | `<path>` |
| Keyboard manual pass | `NOT RUN` | `<n/a>` | `<paste>` | `<path>` |
| Screen reader manual pass | `NOT RUN` | `<n/a>` | `<paste>` | `<path>` |

## 6. Known gaps to carry into the audit, not treat as findings

These are source-level observations recorded as starting points for verification. They are **not** results and must not be promoted to `PASS` or `FAIL` without evidence from section 5.

- `apps/web/src/app/globals.css` has no `@media (prefers-reduced-motion: reduce)` block; animations and smooth scrolling are unconditional.
- `apps/web/src/components/layout/page-transition.tsx` drives opacity/y/blur with framer-motion without a `useReducedMotion` check or `MotionConfig`.
- `apps/web/package.json` declares no axe runner and no `eslint-plugin-jsx-a11y`; `eslint.config.mjs` enables `i18next` but not `jsx-a11y`. The packages appear in `pnpm-lock.yaml` transitively only.
- `playwright.config.ts` has one Chromium project; existing e2e specs contain no accessibility assertions.
- Several controls use low-opacity text (`text-muted-foreground/50`, `/40`) or background tints (`bg-primary/[0.06]`) whose composited contrast needs measurement.
- `topbar.tsx` icon buttons rely on `title` for their accessible name; `notification` and `logout` buttons have no `aria-label`. Verify with a screen reader before recording a result.
- Chat streaming writes each delta into `role="log" aria-live="polite"` and also updates a separate `role="status"` region. Verify announcement frequency with a real reader rather than inferring from jsdom tests.

## 7. Triage (after evidence exists)

For each confirmed finding, add a row with:

| Field | What to record |
|---|---|
| ID / area / WCAG criterion | From the evidence row, not from memory |
| Route, viewport, theme, reader pair | Conditions needed to reproduce |
| Observed vs expected | Exact observed value and the criterion's requirement |
| Impact | Which learner flow is blocked and for whom; severity without inflating |
| Fix owner / slice | Smallest in-scope change; link to the commit or follow-up ticket |
| Verification | Command or manual step that will re-check this row |

Rules: an unevaluated item is `NOT RUN`, a blocked tool is `BLOCKED`, and a failed run is `FAILED`. None of these means `clean`. Do not make fix-or-accept decisions in this document; it only defines how evidence is produced and recorded.
