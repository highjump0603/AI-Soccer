# HighJump Design System

**highjump.kr** — personal portfolio site & admin panel design system.

## Sources

- Logos: provided as `uploads/Logo1–4.png` + `uploads/Logo.ai` (see `assets/`)
- Codebase: `highjump/` (mounted via File System Access API — contains logo files only at this stage)
- No Figma file provided

---

## Product Overview

**highjump.kr** is a personal developer portfolio site with two surfaces:

| Surface | Path | Purpose |
|---|---|---|
| Public Portfolio | `/` | Showcases projects, awards, education to visitors/recruiters |
| Admin Panel | `/admin` | CMS-style interface to add/edit portfolio content |

### Content Types

- **Portfolio items** — project name, description, tech stack, links, year
- **Awards** — award title, category, organization, year
- **Education** — school, degree, period, notes

---

## CONTENT FUNDAMENTALS

### Voice & Tone

- **Language**: Bilingual — Korean primary, English secondary (for international reach)
- **Perspective**: First-person, but minimalist. The work speaks; the copy is terse.
- **Casing**: Section headers in ALL CAPS (Bebas Neue); body copy sentence case; tech tags as-written (`Next.js`, `TypeScript`)
- **Numerals**: Arabic numerals always (`3 projects`, `2024`), even at start of sentence
- **Emoji**: Never. The brand is too refined for emoji.
- **Punctuation**: Em-dashes for parentheticals. No Oxford comma. Ellipsis only in loading states.
- **Copy density**: Ruthlessly minimal. If a word can be cut, cut it.

### Example copy patterns

```
// Section header
01 ─ PORTFOLIO

// Project description
실제 사용자를 위한 웹 애플리케이션

// Award line
2024  최우수상  OO해커톤  OOOO재단

// CTA
View Work  /  Download CV
```

---

## VISUAL FOUNDATIONS

### Color

**Palette**: Strictly three-color — near-black, off-white, electric lime. No gradients.

- `--color-black` `#0A0A0A` — primary background; the void
- `--color-white` `#F5F5F5` — primary text; slightly warm, not clinical
- `--color-accent` `#C2FF29` — electric lime; the "jump" moment; used sparingly
- Grays: 10-step scale between black and white for surfaces, borders, secondary text
- Status: success green, warning amber, error red, info blue — all muted against dark bg

**Usage rules**:
- Accent appears on: primary CTA buttons, section numbers, active states, hover borders
- Never use accent as a large background fill — it reads as neon/garish at scale
- Borders are always very subtle (`--border-subtle` or `--border`) except on focus/hover

### Typography

- **Display** — `Bebas Neue` (Google Fonts). For section titles, hero names, stat numbers. 
  - Characteristics: ultra-condensed, all-caps geometric. Athletic.
  - Use at 40px+ only; never for body copy.
  - **Note**: Bebas Neue lacks Korean glyphs — pair with Pretendard fallback for mixed text.
- **Body/UI** — `Pretendard Variable` (CDN). For all body text, UI labels, Korean text.
  - Variable-weight; use 400 for body, 600 for labels, 700 for emphasis.
  - Covers complete Korean (Hangul) + Latin character sets.
- **Mono** — `JetBrains Mono`. For code snippets, tech tags, terminal-style labels.
  - Font substitution flag: All three fonts loaded from CDN, not self-hosted.

### Backgrounds

- Flat dark surfaces — no textures, patterns, or images in UI.
- Full-bleed photography is used in the hero `assets/desk-photo.jpg` (desk/workspace aesthetic).
- No gradients. Hard edges. The lime glow (`--shadow-accent`) is the only "softness".

### Animation & Motion

- Easing: `--ease-out` for entrances; `--ease-spring` for micro-interactions (button press).
- Duration: 120ms (fast UI), 200ms (standard), 350ms (page-level).
- Hover: upward translate (`translateY(-3px)`) + lime border/glow on interactive cards.
- Press: slight scale-down (`scale(0.97)`) + dim accent.
- No infinite decorative loops. No parallax.

### Spacing

- Base unit: **4px**. All spacing is multiples of 4.
- Generous whitespace at section level (`--space-24` to `--space-40` between sections).
- Tight, dense component internals (`--space-2` to `--space-4` within chips/badges).

### Cards & Surfaces

- **Project cards**: `--bg-surface` fill, `--border-subtle` border. Hover: `--border-accent` + lift shadow.
- **Admin table rows**: `--bg-surface` on hover; striped with `--bg-elevated`.
- **Modals**: `--bg-elevated` surface, `--shadow-xl`, `--radius-lg`.
- No left-border-only accent cards. No colored hero banners on cards.

### Corner Radius

- Buttons, inputs, badges: `--radius-sm` (4px) — tight, purposeful.
- Cards, panels: `--radius-md` (8px) to `--radius-lg` (12px).
- Circular avatars, pills: `--radius-full`.
- The logo's J has organic curves — the brand mark is the only "round" element at large scale.

### Borders

- Default UI border: `1px solid var(--border)` — barely visible on dark bg.
- Focus/active: `1px solid var(--border-accent)` + `box-shadow: 0 0 0 3px var(--color-accent-faint)`.
- No double borders. No dashed/dotted borders except in upload drop zones.

### Shadows

- Used for elevation only, not decoration.
- Cards: no shadow by default; shadow appears on hover.
- Modals: `--shadow-xl` — heavy, grounding.
- Accent glow (`--shadow-accent`) on primary CTA button hover only.

### Hover / Press States

- Buttons: background shifts to `--interactive-hover` (brighter lime) on hover; `--interactive-press` (dimmer) on press.
- Ghost/secondary buttons: lime tint fill + lime border on hover.
- Cards (interactive): `translateY(-3px)` + `--border-accent` + `--shadow-accent`.
- Nav links: lime color on hover; underline on active.
- Opacity reduction (`opacity: 0.6`) for disabled states only.

### Iconography

No custom icon library. The brand uses:
- **Lucide Icons** (CDN) — clean 2px stroke, geometric. Used in admin UI for actions.
- **Unicode arrows** (`→`, `↑`, `↗`) — in nav links and CTAs.
- **Section numbers** (`01`, `02`, `03`) styled with Bebas Neue in accent color — serve as visual landmarks.
- No emoji. No filled/solid icon style — Lucide stroke only.

### Imagery

- `assets/desk-photo.jpg` — developer workspace, B&W aesthetic.
- Photography vibe: monochromatic, grainy, atmospheric.
- Image overlays: `background: linear-gradient(to bottom, transparent, var(--bg))` for blending.

---

## File Manifest

```
styles.css                 — root entry point (@imports all tokens)
tokens/
  colors.css               — full color system (base + semantic)
  typography.css           — font imports + type scale
  spacing.css              — spacing scale + border radius
  shadows.css              — shadow + glow tokens
  motion.css               — easing + duration tokens

assets/
  logo-black.png           — HJ mark, black on white
  logo-on-black.png        — HJ mark, white on black (primary dark-mode logo)
  logo-white.png           — HJ mark, white on transparent
  desk-photo.jpg           — developer workspace photo (hero background)

guidelines/                — foundation specimen cards (Design System tab)
  brand-logos.card.html
  colors-primary.card.html
  colors-accent.card.html
  colors-neutral.card.html
  colors-semantic.card.html
  colors-status.card.html
  type-display.card.html
  type-body.card.html
  type-scale.card.html
  type-mono.card.html
  spacing-scale.card.html
  spacing-usage.card.html
  shadows.card.html
  motion.card.html
  radius.card.html

components/core/           — reusable React UI primitives
  Button (.jsx/.d.ts/.prompt.md)
  Badge  (.jsx/.d.ts/.prompt.md)
  Card   (.jsx/.d.ts/.prompt.md)
  Input  (.jsx/.d.ts/.prompt.md)
  Tag    (.jsx/.d.ts/.prompt.md)
  core.card.html           — component preview card

ui_kits/portfolio/         — public portfolio site prototype
  index.html
  Header.jsx / Hero.jsx / Projects.jsx / Awards.jsx / Education.jsx / Footer.jsx

ui_kits/admin/             — admin panel prototype
  index.html
  Sidebar.jsx / Dashboard.jsx / ProjectManager.jsx / AwardManager.jsx / EducationManager.jsx
```

---

## Components

| Component | Description | Variants |
|---|---|---|
| `Button` | Primary action control | primary, secondary, ghost, danger |
| `Badge` | Status/category label | default, accent, success, warning, error, solid |
| `Card` | Content container | default, elevated, bordered, accent |
| `Input` | Text field + textarea | with label, error, hint |
| `Tag` | Tech stack / category chip | outline, filled, accent |

## UI Kits

| Kit | Path | Description |
|---|---|---|
| Portfolio | `ui_kits/portfolio/` | Public portfolio site |
| Admin | `ui_kits/admin/` | Content management panel |
