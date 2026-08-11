-- accessibility and terrain are text[] with no vocabulary, so nothing stopped
-- one contributor writing 'wheelchair' and the next writing 'Wheelchair
-- accessible'. A filter button matching an exact string then silently misses
-- half the map — and silently is the operative word, because both rows look
-- perfectly reasonable in the table.
--
-- `<@` is "is contained by", not `&&` ("overlaps"). The two are one character
-- apart and both look plausible, but `&&` is wrong in both directions: it
-- accepts any array holding at least one valid value, and it *rejects* the
-- empty array, because `'{}' && anything` is false. Measured against this
-- database, `&&` cannot even be installed — two seeded spots record
-- `accessibility = '{}'`, and the ALTER fails on them.
--
-- That distinction is the point. `'{}'` is "none of these apply" and null is
-- "nobody said"; both are legitimate answers for an optional attribute
-- (spec §4.7) and both stay writable here. A null array yields null, which
-- passes a check constraint, and an empty array is contained by every array.
--
-- Kept in step with ACCESSIBILITY_OPTIONS and TERRAIN_OPTIONS in
-- app/domain/spots/attributes.ts. Adding an option is deliberately two steps,
-- one here and one there, so the form and the database cannot drift apart
-- without someone noticing.
alter table public.spots add constraint spots_accessibility_vocabulary
  check (accessibility <@ array[
    'wheelchair', 'stroller', 'restrooms', 'seating', 'shade', 'paved_path'
  ]::text[]);

alter table public.spots add constraint spots_terrain_vocabulary
  check (terrain <@ array[
    'paved', 'grass', 'gravel', 'sand', 'water', 'wooded', 'steep', 'stairs'
  ]::text[]);
