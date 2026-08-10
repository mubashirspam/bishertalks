-- Landing page CMS.
--
-- Testimonials and the explainer video move out of the code and into the
-- database, so adding a reader's voice note stops being a deploy. Media itself
-- lives in ImageKit; only the URL is stored here.
--
-- One table for all four kinds rather than four tables: they share ordering,
-- an on/off switch and a name, differ only in which media column is filled,
-- and are always read together as "the testimonials". Four tables would mean
-- four queries and four admin screens to render one section.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS landing_testimonials (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'audio', 'text')),

  name TEXT NOT NULL,
  /** e.g. "അധ്യാപിക, തൃശൂർ" */
  role TEXT,

  -- text / audio quote, or the caption overlaid on a video thumbnail
  quote TEXT,

  -- ── Media, by kind ────────────────────────────────────────────────────────
  -- video: either a YouTube ID or an ImageKit video URL — the author records
  -- on a phone and sometimes uploads straight here rather than to YouTube.
  youtube_id TEXT,
  video_url TEXT,
  -- image: a WhatsApp screenshot. audio: a voice note. Both ImageKit URLs.
  image_url TEXT,
  audio_url TEXT,
  -- shown in the round avatar next to a voice note
  avatar_url TEXT,

  -- Displayed beside the player; not derived from the file because reading
  -- duration server-side means downloading it.
  duration TEXT,
  /** e.g. "Today, 10:32 AM" — mirrors how the message arrived. */
  sent_at_label TEXT,

  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),

  -- Gaps of 10 so a row can be dropped between two others without renumbering.
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- What the public page asks for: the live ones, in order, for one kind.
CREATE INDEX IF NOT EXISTS idx_testimonials_live
  ON landing_testimonials (kind, sort_order)
  WHERE is_active;

DROP TRIGGER IF EXISTS landing_testimonials_updated_at ON landing_testimonials;
CREATE TRIGGER landing_testimonials_updated_at
  BEFORE UPDATE ON landing_testimonials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- SETTINGS — one row. Same single-row trick as referral_settings.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS landing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- The "what is Neuro Code" explainer. YouTube ID, or an ImageKit URL for a
  -- self-hosted file.
  explainer_youtube_id TEXT,
  explainer_video_url TEXT,
  explainer_length TEXT,

  -- Dashed "add a testimonial here" frames. On while the page is being built,
  -- off before launch — a live page shows real testimonials or none.
  show_placeholders BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO landing_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- RLS — deny by default. The page reads through the service role like every
-- other server component here, so the anon key needs no access at all.
-- ----------------------------------------------------------------------------
ALTER TABLE landing_testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
