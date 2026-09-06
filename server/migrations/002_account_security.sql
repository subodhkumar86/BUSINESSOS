ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0 CHECK(session_version >= 0);
