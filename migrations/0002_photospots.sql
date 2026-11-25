CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  avatar_url TEXT, bio TEXT, website_url TEXT, instagram TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER auth_user_profile AFTER INSERT ON "user" BEGIN
  INSERT INTO profiles(id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NULLIF(trim(NEW.name),''),'Photospots member'), NEW.image);
END;
CREATE TABLE shoot_types (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shoot_types(slug,label,sort_order) VALUES
 ('family','Family',10),('engagement','Engagement',20),('senior-portrait','Senior Portrait',30),
 ('maternity','Maternity',40),('newborn','Newborn',50),('headshot','Headshot',60),
 ('wedding','Wedding',70),('branding','Branding',80),('pets','Pets',90);
CREATE TABLE spots (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('outdoor','studio')),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  locality TEXT, region TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  owner_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','removed')),
  score REAL NOT NULL DEFAULT 0,
  hot_score REAL NOT NULL DEFAULT 0,
  shoot_type_upvote_count INTEGER NOT NULL DEFAULT 0,
  shoot_again_yes_count INTEGER NOT NULL DEFAULT 0,
  shoot_again_no_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  scouting_photo_count INTEGER NOT NULL DEFAULT 0,
  session_photo_count INTEGER NOT NULL DEFAULT 0,
  cost_type TEXT CHECK(cost_type IN ('free','park_pass','permit_required','hourly_rate','negotiated')),
  cost_notes TEXT, permit_url TEXT, hours_notes TEXT,
  best_light TEXT CHECK(best_light IS NULL OR (json_valid(best_light) AND json_type(best_light)='array')),
  best_seasons TEXT CHECK(best_seasons IS NULL OR (json_valid(best_seasons) AND json_type(best_seasons)='array')),
  walk_minutes INTEGER CHECK(walk_minutes IS NULL OR (walk_minutes >= 0 AND typeof(walk_minutes)='integer')),
  parking_notes TEXT,
  terrain TEXT CHECK(terrain IS NULL OR (json_valid(terrain) AND json_type(terrain)='array')),
  accessibility TEXT CHECK(accessibility IS NULL OR (json_valid(accessibility) AND json_type(accessibility)='array')),
  max_group_size INTEGER CHECK(max_group_size IS NULL OR max_group_size > 0),
  dog_friendly INTEGER CHECK(dog_friendly IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX spots_viewport_idx ON spots(lat,lng) WHERE status='published';
CREATE INDEX spots_score_idx ON spots(score DESC,id) WHERE status='published';
CREATE INDEX spots_hot_idx ON spots(hot_score DESC,id) WHERE status='published';
CREATE TABLE spot_shoot_types (
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  shoot_type_id INTEGER NOT NULL REFERENCES shoot_types(id),
  PRIMARY KEY(spot_id,shoot_type_id)
);
CREATE INDEX spot_types_idx ON spot_shoot_types(shoot_type_id,spot_id);
CREATE TABLE signals (
  id TEXT PRIMARY KEY NOT NULL,
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('shoot_type_upvote','shoot_again')),
  shoot_type_id INTEGER REFERENCES shoot_types(id),
  value INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((kind='shoot_type_upvote' AND shoot_type_id IS NOT NULL AND value=1)
     OR (kind='shoot_again' AND shoot_type_id IS NULL AND value IN (0,1)))
);
CREATE UNIQUE INDEX signals_upvote_unique ON signals(spot_id,profile_id,shoot_type_id) WHERE kind='shoot_type_upvote';
CREATE UNIQUE INDEX signals_again_unique ON signals(spot_id,profile_id) WHERE kind='shoot_again';
CREATE INDEX signals_spot_idx ON signals(spot_id);
CREATE INDEX signals_recent_idx ON signals(created_at);
CREATE TABLE photos (
  id TEXT PRIMARY KEY NOT NULL,
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('scouting','session')),
  storage_path TEXT NOT NULL UNIQUE,
  caption TEXT,
  shoot_type_id INTEGER REFERENCES shoot_types(id),
  rights_attested INTEGER NOT NULL DEFAULT 0 CHECK(rights_attested IN (0,1)),
  credit_name TEXT, credit_url TEXT,
  width INTEGER, height INTEGER, blurhash TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(kind <> 'session' OR rights_attested=1)
);
CREATE INDEX photos_spot_idx ON photos(spot_id,kind,status,created_at);
CREATE INDEX photos_recent_idx ON photos(created_at);
CREATE TABLE spot_gallery_links (
  id TEXT PRIMARY KEY NOT NULL,
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  url TEXT NOT NULL, title TEXT NOT NULL,
  shoot_type_id INTEGER REFERENCES shoot_types(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX gallery_spot_idx ON spot_gallery_links(spot_id);
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000 AND length(trim(body,char(9)||char(10)||char(13)||' '))>0),
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX comments_spot_idx ON comments(spot_id,created_at);
CREATE INDEX comments_recent_idx ON comments(created_at);
CREATE TABLE studio_details (
  spot_id TEXT PRIMARY KEY NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  hourly_rate_cents INTEGER CHECK(hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  booking_url TEXT, contact_email TEXT,
  claimed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('spot','photo','comment')),
  target_id TEXT NOT NULL,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  resolved_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reports_queue_idx ON reports(status,created_at DESC);
-- Upload receipts survive user deletion so the scheduled sweeper can remove
-- abandoned R2 objects. Published photos retain their independent object key.
CREATE TABLE uploads (
  storage_path TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8000000),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attached_at TEXT,
  CHECK(expires_at > created_at)
);
CREATE INDEX uploads_expiry_idx ON uploads(expires_at) WHERE attached_at IS NULL;

CREATE TRIGGER photos_cap_insert BEFORE INSERT ON photos WHEN NEW.status='published' BEGIN
  SELECT RAISE(ABORT,'photo cap reached') WHERE (SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind=NEW.kind AND status='published') >= 6;
END;
CREATE TRIGGER photos_cap_update BEFORE UPDATE OF status,kind,spot_id ON photos WHEN NEW.status='published' BEGIN
  SELECT RAISE(ABORT,'photo cap reached') WHERE (SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind=NEW.kind AND status='published' AND id<>NEW.id) >= 6;
END;
CREATE TRIGGER spots_vocabulary_insert AFTER INSERT ON spots BEGIN
  SELECT RAISE(ABORT,'invalid accessibility vocabulary') WHERE EXISTS(SELECT 1 FROM json_each(NEW.accessibility) WHERE type<>'text' OR value NOT IN ('wheelchair','stroller','restrooms','seating','shade','paved_path'));
  SELECT RAISE(ABORT,'invalid terrain vocabulary') WHERE EXISTS(SELECT 1 FROM json_each(NEW.terrain) WHERE type<>'text' OR value NOT IN ('paved','grass','gravel','sand','water','wooded','steep','stairs'));
END;
CREATE TRIGGER spots_vocabulary_update AFTER UPDATE OF accessibility,terrain ON spots BEGIN
  SELECT RAISE(ABORT,'invalid accessibility vocabulary') WHERE EXISTS(SELECT 1 FROM json_each(NEW.accessibility) WHERE type<>'text' OR value NOT IN ('wheelchair','stroller','restrooms','seating','shade','paved_path'));
  SELECT RAISE(ABORT,'invalid terrain vocabulary') WHERE EXISTS(SELECT 1 FROM json_each(NEW.terrain) WHERE type<>'text' OR value NOT IN ('paved','grass','gravel','sand','water','wooded','steep','stairs'));
END;
CREATE TRIGGER spots_touch AFTER UPDATE OF name,slug,description,kind,lat,lng,locality,region,status,owner_profile_id,cost_type,cost_notes,permit_url,hours_notes,best_light,best_seasons,walk_minutes,parking_notes,terrain,accessibility,max_group_size,dog_friendly ON spots BEGIN
  UPDATE spots SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
