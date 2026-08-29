-- 0054 · Inbound media: remember enough to fetch it back.
--
-- A customer sending a photo of a damaged parcel, or a voice note asking where
-- their book is, arrived as a row saying `kind: 'image'` and nothing else. The
-- webhook read Meta's `type` field and threw away the `{id, mime_type}` beside
-- it, so the thread had nothing to render and showed "(image)" in italics.
--
-- Media on the Cloud API is never sent inline. The webhook carries an id; you
-- exchange that id for a short-lived URL, and that URL only answers to a
-- request carrying the access token. So the id is the whole of what has to be
-- kept — everything else is a round trip we can make later.
--
-- One deadline worth knowing: **Meta deletes media 30 days after it is sent.**
-- An id older than that resolves to nothing. If these ever need to outlive the
-- conversation they have to be copied into storage of our own, which is a
-- bigger change than this one and not needed while the CRM is a place people
-- read a thread and answer it.
--
-- Safe to run twice.

ALTER TABLE whatsapp_messages
  -- Meta's media id. The only thing that cannot be re-derived.
  ADD COLUMN IF NOT EXISTS media_id       text,
  -- "image/jpeg", "audio/ogg; codecs=opus". Decides which player renders it,
  -- and it is stored rather than guessed from `kind` because a voice note and
  -- an uploaded mp3 are both `audio` and only one of them is an ogg.
  ADD COLUMN IF NOT EXISTS media_mime     text,
  -- Documents carry the name the customer saw. Nothing else does.
  ADD COLUMN IF NOT EXISTS media_filename text;

-- Finding the media in a thread without scanning the thread.
CREATE INDEX IF NOT EXISTS whatsapp_messages_media_idx
  ON whatsapp_messages (contact_id, created_at DESC)
  WHERE media_id IS NOT NULL;
