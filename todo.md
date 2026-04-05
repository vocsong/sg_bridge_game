# Next tasks (requirement specs)

## Done (reference)

- SPEC-01: Tighten trump/partner glow; CSS vars as single source of truth; remove border-color override
- SPEC-02: Basic fallback discard uses smartDump (no accidental high-card dumps or trump wastage)


## SPEC-01 — Trick play-order accents vs trump/partner glow

### Problem

On the **game over** hand recap, cards use **play-order markers** (`po-1` … `po-4`: green / yellow / **orange** / **red** top borders on `.card-mini`). The **trump fire** (`.card-trump-fire`) and **partner** (`.card-partner-glow`) animations use large `box-shadow` / `drop-shadow` and `border-color: … !important`, which **visually overpower** those sequence borders and make play order hard to read.

### Goal

- Play-order indication stays **clearly readable** on game over (and anywhere both apply).
- **Smaller, tighter** glow so it does not swallow the **3px top border** used for trick sequence.
- **Gameplay** trick area / last-trick UI uses the **same tightened glow radii** as game over for consistency.

### In scope

- `static/style.css`: `@keyframes trump-fire-glow`, `.card-trump-fire`, `@keyframes partner-card-glow`, `.card-partner-glow` (and `prefers-reduced-motion` fallbacks).
- Optional: if `!important` border overrides remain necessary for trump/partner, restrict so **gameover recap** cards can keep sequence border visible (e.g. wrapper glow only, or separate class on recap).

### Acceptance criteria

1. On game over hands, for a card that has both a **play-order class** (`po-*`) and **trump/partner** styling, the **po-* top border** remains visible at a glance (user can identify 1st–4th play in trick without confusion).
2. Trump and partner effects are still noticeable but **subtler** than today (smaller spread/blur — target to be agreed; see open questions).
3. Live **play** trick display and **last-trick popup** use the **same** glow distance/intensity tokens as the recap (single source of truth, e.g. CSS variables).

### Open questions (you fill in)

- **A1.** Should recap cards use **no** inner border override at all (glow only outside), or is a **thin** trump/partner border OK if it doesn’t touch the top edge? yes use no inner border override
- **A2.** Preference: one global “tight glow” for both contexts, or **slightly** stronger on live play than recap?  global
- **A3.** Any **screenshot** or “good enough” reference (another card site / app) for glow intensity? no

---

## SPEC-02 — Bot discards high on void (non-trump); fix code + `bot.md`

### Problem (observed)

When the bot **cannot follow suit** and is **not** ruffing (playing a non-trump discard), behaviour sometimes **throws away a high** side card; expectation is to **dump low** to preserve strength.

### Goal

- Review **following** paths in `src/game-room.ts` (e.g. `smartDump`, `basic` fallback, bidder-team / opposition branches) for the case: **void in led suit**, **chosen card is not trump** (or trump not used to win).
- Change logic so default discard in that situation prefers **lowest** useful loser / lowest in chosen discard suit as per design.
- Update **`bot.md`** so the written spec matches the implementation (same sections as today: helpers, following, fallbacks).

### In scope

- `getBotCard`, `getBotCardAsBidderTeam`, `getBotCardAsOpposition`, `smartDump`, and any **basic** path when `useTeamLogic` is false.
- `bot.md` — behaviour description + rationale.

### Acceptance criteria

1. Repro case (void in led suit, discard off-suit, not trumping): bot plays a **low** card per agreed rule below, not a high honour without a tactical reason documented in code comment or `bot.md`.
2. Existing tests pass; add or extend a **unit/integration** test if there is a harness for bot card choice (optional but preferred).
3. `bot.md` documents the discard rule in **Following** / **smartDump** (or new subsection) so future changes don’t regress.

### Open questions (you fill in)

- **B1.** “Dump low” means **global lowest** off-suit card, or **lowest in the shortest non-trump suit** (current `smartDump` idea) — which should win when they disagree? smartDump
- **B2.** Exception: may the bot ever **discard high** off-suit (e.g. signalling, unblocking, known voids) — **never**, or **rare** with explicit conditions? never
- **B3.** Does the bug appear mainly when **confidence fails** (random basic path), or also when **team logic** runs? not sure

---

*After you answer A1–A3 and B1–B3, fold answers into each spec’s “Decisions” subsection and trim open questions.*
