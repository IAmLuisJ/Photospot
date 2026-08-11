-- Two problems with `check (length(trim(body)) > 0)` from migration 3.
--
-- First, it does not do what it looks like. Postgres `trim()` is
-- `btrim(x, ' ')` — it strips SPACES ONLY, so a body of E'\n\t' passes it.
-- `comments_insert` requires only `profile_id = auth.uid()`, and the anon key
-- ships in the browser bundle with self-serve signup, so any signed-in user
-- could POST a newline straight to PostgREST: a blank-looking comment that
-- still renders, still bumps `comment_count`, and is still worth
-- `weights.comment` in `computeScore`. Repeatable in a loop. Verified against
-- this database before writing this migration, not inferred from the docs.
--
-- The regex says what was meant — "contains at least one non-whitespace
-- character", which is what JS `.trim().length > 0` means. Measured code point
-- by code point against JS on this database, the two agree on space, tab,
-- newline, NBSP, U+2028, U+2029 and U+3000, and disagree on exactly two:
--
--   U+FEFF  JS trims it, [:space:] does not, so the database still accepts a
--           body of only a byte-order mark.
--   U+0085  JS keeps it, [:space:] treats it as space, so the database rejects
--           a body of only U+0085 that validateComment accepted.
--
-- Both are narrow, and the second fails loudly as a 23514 rather than storing
-- anything. They are written down because claiming parity without checking is
-- the exact mistake this migration exists to correct.
alter table public.comments drop constraint comments_body_check;

alter table public.comments add constraint comments_body_not_blank
  check (body ~ '[^[:space:]]');

-- MAX_COMMENT_LENGTH (2000) stays in TypeScript: it is a product limit that
-- feedback will move, and a migration is a poor place for a number that gets
-- tuned. But a limit only the application enforces is not a limit — `body` is
-- unconstrained `text`, so a direct PostgREST insert can store up to 1GB in a
-- column that every visitor to that spot's detail page then downloads.
--
-- So: two numbers with two jobs, following the precedent of
-- MAX_PHOTOS_PER_KIND, which enforce_photo_cap() duplicates into the database
-- precisely so the cap holds for anything reaching the table — the API
-- directly, a future import script, a careless migration. This is the abuse
-- ceiling, five times the product limit, and nobody tunes it from feedback.
--
-- Postgres `length()` counts code points while JS `.length` counts UTF-16
-- units, so an emoji-heavy body measures larger in TypeScript than it does
-- here. Harmless while the two numbers are far apart; they must never be set
-- equal, or a body could pass validation and then be rejected by this check.
alter table public.comments add constraint comments_body_length
  check (length(body) <= 10000);
