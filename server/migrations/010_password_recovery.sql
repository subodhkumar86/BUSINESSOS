CREATE TABLE password_reset_tokens(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_lookup ON password_reset_tokens(token_hash,expires_at)
  WHERE used_at IS NULL;
