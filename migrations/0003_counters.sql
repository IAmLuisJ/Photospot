-- SQLite row triggers maintain counts inside each contribution transaction.
CREATE TRIGGER signals_count_insert AFTER INSERT ON signals BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
CREATE TRIGGER signals_count_delete AFTER DELETE ON signals BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
END;
CREATE TRIGGER signals_count_update AFTER UPDATE ON signals BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
CREATE TRIGGER comments_count_insert AFTER INSERT ON comments BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
CREATE TRIGGER comments_count_delete AFTER DELETE ON comments BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
END;
CREATE TRIGGER comments_count_update AFTER UPDATE ON comments BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
CREATE TRIGGER photos_count_insert AFTER INSERT ON photos BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
CREATE TRIGGER photos_count_delete AFTER DELETE ON photos BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
END;
CREATE TRIGGER photos_count_update AFTER UPDATE ON photos BEGIN
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=OLD.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=OLD.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=OLD.spot_id AND kind='session' AND status='published') WHERE id=OLD.spot_id;
UPDATE spots SET
 shoot_type_upvote_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_type_upvote'),
 shoot_again_yes_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=1),
 shoot_again_no_count=(SELECT COUNT(*) FROM signals WHERE spot_id=NEW.spot_id AND kind='shoot_again' AND value=0),
 comment_count=(SELECT COUNT(*) FROM comments WHERE spot_id=NEW.spot_id AND status='published'),
 scouting_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='scouting' AND status='published'),
 session_photo_count=(SELECT COUNT(*) FROM photos WHERE spot_id=NEW.spot_id AND kind='session' AND status='published') WHERE id=NEW.spot_id;
END;
