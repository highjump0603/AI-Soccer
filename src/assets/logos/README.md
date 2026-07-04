# Team logos

Drop real crest images in this folder to have them picked up automatically —
no code changes needed. Supported formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`.

**Filename convention:** the team's exact name, lowercased, with spaces
collapsed to single hyphens. Matching is accent/whitespace-normalized, so:

- `맨체스터 시티` → `맨체스터-시티.png`
- `Manchester City` → `manchester-city.png`

If no file matches a team's name, the site falls back to a circular
initials avatar (see `src/components/TeamLogo.jsx`) so the layout never
breaks — it just looks a little plainer until you add the real crest.
