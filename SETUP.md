# MatchAI — setup

Real implementation of the `축구경기 예측 사이트` design (see `README.md` and
`chats/chat1.md` for the design handoff this was built from). React + Vite
SPA, data lives in Supabase.

## 1. Install

```
npm install
```

## 2. Connect Supabase

1. Create a project at https://supabase.com.
2. Open the SQL Editor and run `supabase/schema.sql` — it creates the
   `matches` table, enables RLS with fully-open read/write policies (see the
   note in that file — there's no admin login yet), and seeds the 8 example
   matches from the prototype.
3. Copy `.env.example` to `.env` and fill in your project's URL and anon key
   (Project Settings → API in the Supabase dashboard).

## 3. Run

```
npm run dev
```

Visit http://localhost:5173. Routes: `/` (home + dashboard), `/match/:id`
(match detail), `/admin` (CRUD for matches).

## Team logos

Logos are static files, not a database field. Drop images into
`src/assets/logos/` named after the team (see the README in that folder for
the exact filename convention) and they're picked up automatically — no code
changes. Teams without a matching file fall back to a circular initials
avatar so the layout never breaks.

## Known limitation: no auth

The admin page has no login — anyone with the site's anon key (which is
public, it ships in the JS bundle) can add/edit/delete matches. This mirrors
the prototype, which also had no auth on its "관리자" tab. Add Supabase Auth
and tighten the RLS policies in `supabase/schema.sql` before treating this as
a real production admin panel.
