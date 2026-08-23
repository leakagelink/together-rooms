
CREATE TYPE public.research_permission_mode AS ENUM ('host_only','collaborative','host_approval');
CREATE TYPE public.research_focus_mode AS ENUM ('host_sync','free_navigation');
CREATE TYPE public.resource_kind AS ENUM ('web_link','youtube','document_reference','note');
CREATE TYPE public.resource_status AS ENUM ('pending','active','archived','rejected');
CREATE TYPE public.study_task_status AS ENUM ('todo','in_progress','completed');
CREATE TYPE public.focus_timer_phase AS ENUM ('focus','short_break','long_break','custom');
CREATE TYPE public.focus_timer_status AS ENUM ('idle','running','paused','completed');

-- ---------------------------------------------------------------- settings
CREATE TABLE public.room_study_settings (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  resource_mode public.research_permission_mode NOT NULL DEFAULT 'collaborative',
  note_mode public.research_permission_mode NOT NULL DEFAULT 'collaborative',
  timer_mode public.research_permission_mode NOT NULL DEFAULT 'host_only',
  focus_mode public.research_focus_mode NOT NULL DEFAULT 'free_navigation',
  private_research_mode BOOLEAN NOT NULL DEFAULT true,
  focused_resource_id UUID,
  focus_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- resources
CREATE TABLE public.room_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  resource_type public.resource_kind NOT NULL DEFAULT 'web_link',
  url TEXT,
  normalized_url TEXT,
  host TEXT,
  provider_media_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  favicon_url TEXT,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.resource_status NOT NULL DEFAULT 'active',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT room_resources_scheme_chk
    CHECK (url IS NULL OR url ~* '^https?://[^\s]+$'),
  CONSTRAINT room_resources_url_required_chk
    CHECK (resource_type = 'note' OR url IS NOT NULL)
);
CREATE INDEX room_resources_room_idx ON public.room_resources(room_id, status, created_at DESC);
CREATE UNIQUE INDEX room_resources_dedupe_idx
  ON public.room_resources(room_id, normalized_url)
  WHERE normalized_url IS NOT NULL AND status IN ('active','pending');

ALTER TABLE public.room_study_settings
  ADD CONSTRAINT room_study_settings_focus_fk
  FOREIGN KEY (focused_resource_id) REFERENCES public.room_resources(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------- notes
CREATE TABLE public.room_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX room_notes_room_idx ON public.room_notes(room_id, updated_at DESC);

CREATE TABLE public.room_note_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES public.room_notes(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content_length INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, revision)
);

-- ------------------------------------------------------------------- tasks
CREATE TABLE public.room_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.study_task_status NOT NULL DEFAULT 'todo',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX room_tasks_room_idx ON public.room_tasks(room_id, status, created_at DESC);

-- ------------------------------------------------------------------- timer
CREATE TABLE public.room_focus_timer (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  phase public.focus_timer_phase NOT NULL DEFAULT 'focus',
  status public.focus_timer_status NOT NULL DEFAULT 'idle',
  duration_seconds INTEGER NOT NULL DEFAULT 1500,
  remaining_seconds INTEGER,
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ grants
GRANT SELECT ON public.room_study_settings TO authenticated;
GRANT SELECT ON public.room_resources TO authenticated;
GRANT SELECT ON public.room_notes TO authenticated;
GRANT SELECT ON public.room_note_revisions TO authenticated;
GRANT SELECT ON public.room_tasks TO authenticated;
GRANT SELECT ON public.room_focus_timer TO authenticated;
GRANT ALL ON public.room_study_settings TO service_role;
GRANT ALL ON public.room_resources TO service_role;
GRANT ALL ON public.room_notes TO service_role;
GRANT ALL ON public.room_note_revisions TO service_role;
GRANT ALL ON public.room_tasks TO service_role;
GRANT ALL ON public.room_focus_timer TO service_role;

ALTER TABLE public.room_study_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_note_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_focus_timer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study settings readable by room members" ON public.room_study_settings
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "resources readable by room members" ON public.room_resources
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "notes readable by room members" ON public.room_notes
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "note revisions readable by room members" ON public.room_note_revisions
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "tasks readable by room members" ON public.room_tasks
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "timer readable by room members" ON public.room_focus_timer
  FOR SELECT TO authenticated USING (public.is_room_member(room_id, auth.uid()));

-- ------------------------------------------------------------ guard trigger
CREATE OR REPLACE FUNCTION public.guard_study_tables()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.study_ctx', true), '') = '1'
     OR current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'study_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE TRIGGER guard_room_study_settings BEFORE INSERT OR UPDATE OR DELETE ON public.room_study_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();
CREATE TRIGGER guard_room_resources BEFORE INSERT OR UPDATE OR DELETE ON public.room_resources
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();
CREATE TRIGGER guard_room_notes BEFORE INSERT OR UPDATE OR DELETE ON public.room_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();
CREATE TRIGGER guard_room_note_revisions BEFORE INSERT OR UPDATE OR DELETE ON public.room_note_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();
CREATE TRIGGER guard_room_tasks BEFORE INSERT OR UPDATE OR DELETE ON public.room_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();
CREATE TRIGGER guard_room_focus_timer BEFORE INSERT OR UPDATE OR DELETE ON public.room_focus_timer
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_tables();

CREATE TRIGGER room_resources_updated_at BEFORE UPDATE ON public.room_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER room_notes_updated_at BEFORE UPDATE ON public.room_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER room_tasks_updated_at BEFORE UPDATE ON public.room_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_resources;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_focus_timer;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_study_settings;
