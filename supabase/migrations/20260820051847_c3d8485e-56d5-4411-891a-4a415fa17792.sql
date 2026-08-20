-- =========================================================
-- SyncTogether — Phase 1 foundation schema
-- =========================================================

-- ---------- Enums ----------
CREATE TYPE public.app_role AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE public.account_status AS ENUM ('active', 'suspended', 'deactivated', 'deleted');
CREATE TYPE public.room_type AS ENUM ('couple','friends','family','study','research','music','watch','game','private');
CREATE TYPE public.room_status AS ENUM ('draft','active','paused','ended','archived');
CREATE TYPE public.room_privacy AS ENUM ('private','invite_only','unlisted','public');
CREATE TYPE public.room_member_role AS ENUM ('host','co_host','moderator','member','guest');
CREATE TYPE public.room_member_status AS ENUM ('invited','joined','left','kicked','banned');
CREATE TYPE public.visibility_level AS ENUM ('public','members','contacts','private');
CREATE TYPE public.report_target AS ENUM ('user','room','message','other');
CREATE TYPE public.report_status AS ENUM ('open','reviewing','actioned','dismissed');
CREATE TYPE public.moderation_action_type AS ENUM ('warn','mute','kick','ban','suspend','content_removed','dismissed');
CREATE TYPE public.room_event_type AS ENUM (
  'ROOM_CREATED','ROOM_UPDATED','USER_JOINED','USER_LEFT','HOST_CHANGED',
  'PLAY','PAUSE','SEEK','CONTENT_CHANGED','CHAT_MESSAGE','REACTION',
  'SCREEN_SHARE_STARTED','SCREEN_SHARE_STOPPED','ROOM_ENDED'
);
CREATE TYPE public.subscription_tier AS ENUM ('free','pro','pro_plus');

-- ---------- Shared helpers ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- profiles ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  status public.account_status NOT NULL DEFAULT 'active',
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$'),
  CONSTRAINT profiles_bio_len CHECK (bio IS NULL OR char_length(bio) <= 300),
  CONSTRAINT profiles_display_name_len CHECK (display_name IS NULL OR char_length(display_name) <= 60)
);
CREATE INDEX idx_profiles_username ON public.profiles(username);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------- user_roles ----------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('moderator','admin'));
$$;

CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- ---------- privacy_settings ----------
CREATE TABLE public.privacy_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_visibility public.visibility_level NOT NULL DEFAULT 'members',
  room_visibility public.visibility_level NOT NULL DEFAULT 'private',
  who_can_invite public.visibility_level NOT NULL DEFAULT 'contacts',
  who_can_message public.visibility_level NOT NULL DEFAULT 'contacts',
  activity_visibility public.visibility_level NOT NULL DEFAULT 'private',
  searchable_by_username BOOLEAN NOT NULL DEFAULT false,
  analytics_consent BOOLEAN NOT NULL DEFAULT false,
  personalization_consent BOOLEAN NOT NULL DEFAULT false,
  ads_consent BOOLEAN NOT NULL DEFAULT false,
  room_data_retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT privacy_retention_range CHECK (room_data_retention_days BETWEEN 1 AND 365)
);
GRANT SELECT, INSERT, UPDATE ON public.privacy_settings TO authenticated;
GRANT ALL ON public.privacy_settings TO service_role;
ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "privacy_own_all" ON public.privacy_settings FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- user_settings ----------
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system',
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  notify_push BOOLEAN NOT NULL DEFAULT false,
  notify_room_invites BOOLEAN NOT NULL DEFAULT true,
  notify_room_activity BOOLEAN NOT NULL DEFAULT true,
  reduced_motion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_theme CHECK (theme IN ('system','light','dark'))
);
GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_settings_own_all" ON public.user_settings FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- rooms ----------
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  type public.room_type NOT NULL DEFAULT 'friends',
  status public.room_status NOT NULL DEFAULT 'active',
  privacy public.room_privacy NOT NULL DEFAULT 'private',
  invite_only BOOLEAN NOT NULL DEFAULT true,
  is_ephemeral BOOLEAN NOT NULL DEFAULT true,
  max_members INTEGER NOT NULL DEFAULT 10,
  join_code TEXT UNIQUE,
  scheduled_start_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rooms_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT rooms_desc_len CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT rooms_max_members CHECK (max_members BETWEEN 2 AND 50),
  CONSTRAINT rooms_join_code_format CHECK (join_code IS NULL OR join_code ~ '^[A-Z0-9]{6,12}$')
);
CREATE INDEX idx_rooms_owner ON public.rooms(owner_id);
CREATE INDEX idx_rooms_status ON public.rooms(status);
CREATE INDEX idx_rooms_expires ON public.rooms(expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- ---------- room_members ----------
CREATE TABLE public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.room_member_role NOT NULL DEFAULT 'member',
  status public.room_member_status NOT NULL DEFAULT 'joined',
  can_invite BOOLEAN NOT NULL DEFAULT false,
  can_moderate BOOLEAN NOT NULL DEFAULT false,
  can_control_playback BOOLEAN NOT NULL DEFAULT false,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON public.room_members(user_id);
CREATE INDEX idx_room_members_room ON public.room_members(room_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_members TO authenticated;
GRANT ALL ON public.room_members TO service_role;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (avoid RLS recursion between rooms and room_members)
CREATE OR REPLACE FUNCTION public.is_room_member(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = _room_id AND user_id = _user_id AND status IN ('invited','joined')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_host(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rooms WHERE id = _room_id AND (owner_id = _user_id OR host_id = _user_id))
      OR EXISTS (
        SELECT 1 FROM public.room_members
        WHERE room_id = _room_id AND user_id = _user_id
          AND status = 'joined' AND role IN ('host','co_host')
      );
$$;

CREATE OR REPLACE FUNCTION public.can_moderate_room(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_room_host(_room_id, _user_id)
      OR EXISTS (
        SELECT 1 FROM public.room_members
        WHERE room_id = _room_id AND user_id = _user_id AND status = 'joined'
          AND (role = 'moderator' OR can_moderate)
      );
$$;

CREATE OR REPLACE FUNCTION public.shares_room_with(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members m1
    JOIN public.room_members m2 ON m1.room_id = m2.room_id
    WHERE m1.user_id = _a AND m2.user_id = _b AND m1.status = 'joined' AND m2.status = 'joined'
  );
$$;

-- ---------- user_blocks ----------
CREATE TABLE public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT block_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500)
);
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks_own_select" ON public.user_blocks FOR SELECT TO authenticated
USING (blocker_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "blocks_own_insert" ON public.user_blocks FOR INSERT TO authenticated
WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "blocks_own_delete" ON public.user_blocks FOR DELETE TO authenticated
USING (blocker_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_blocked_between(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _a AND blocked_id = _b) OR (blocker_id = _b AND blocked_id = _a)
  );
$$;

-- ---------- profiles policies (need helpers above) ----------
CREATE POLICY "profiles_select_visible" ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_staff(auth.uid())
  OR (
    NOT public.is_blocked_between(auth.uid(), id)
    AND status = 'active'
    AND (
      public.shares_room_with(auth.uid(), id)
      OR EXISTS (
        SELECT 1 FROM public.privacy_settings ps
        WHERE ps.user_id = profiles.id AND ps.profile_visibility = 'public'
      )
    )
  )
);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ---------- rooms policies ----------
CREATE POLICY "rooms_select_member" ON public.rooms FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.is_room_member(id, auth.uid()) OR public.is_staff(auth.uid()));
CREATE POLICY "rooms_insert_own" ON public.rooms FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());
CREATE POLICY "rooms_update_host" ON public.rooms FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.is_room_host(id, auth.uid()))
WITH CHECK (owner_id = auth.uid() OR public.is_room_host(id, auth.uid()));
CREATE POLICY "rooms_delete_owner" ON public.rooms FOR DELETE TO authenticated
USING (owner_id = auth.uid());

-- ---------- room_members policies ----------
CREATE POLICY "room_members_select" ON public.room_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()) OR public.is_staff(auth.uid()));
CREATE POLICY "room_members_insert" ON public.room_members FOR INSERT TO authenticated
WITH CHECK (
  (user_id = auth.uid() AND role IN ('member','guest'))
  OR public.is_room_host(room_id, auth.uid())
);
CREATE POLICY "room_members_update" ON public.room_members FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.can_moderate_room(room_id, auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.can_moderate_room(room_id, auth.uid()));
CREATE POLICY "room_members_delete" ON public.room_members FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.is_room_host(room_id, auth.uid()));

-- ---------- room_invites ----------
CREATE TABLE public.room_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invites_max_uses CHECK (max_uses BETWEEN 1 AND 100),
  CONSTRAINT invites_use_count CHECK (use_count >= 0)
);
CREATE INDEX idx_room_invites_room ON public.room_invites(room_id);
GRANT SELECT, INSERT, UPDATE ON public.room_invites TO authenticated;
GRANT ALL ON public.room_invites TO service_role;
ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invites_select_member" ON public.room_invites FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.is_room_host(room_id, auth.uid()));
CREATE POLICY "invites_insert_host" ON public.room_invites FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.is_room_host(room_id, auth.uid()));
CREATE POLICY "invites_update_host" ON public.room_invites FOR UPDATE TO authenticated
USING (public.is_room_host(room_id, auth.uid())) WITH CHECK (public.is_room_host(room_id, auth.uid()));

-- ---------- room_sessions ----------
CREATE TABLE public.room_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  participant_peak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_room_sessions_room ON public.room_sessions(room_id);
GRANT SELECT, INSERT, UPDATE ON public.room_sessions TO authenticated;
GRANT ALL ON public.room_sessions TO service_role;
ALTER TABLE public.room_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_sessions_select" ON public.room_sessions FOR SELECT TO authenticated
USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));
CREATE POLICY "room_sessions_insert" ON public.room_sessions FOR INSERT TO authenticated
WITH CHECK (public.is_room_host(room_id, auth.uid()));
CREATE POLICY "room_sessions_update" ON public.room_sessions FOR UPDATE TO authenticated
USING (public.is_room_host(room_id, auth.uid())) WITH CHECK (public.is_room_host(room_id, auth.uid()));

-- ---------- room_events ----------
CREATE TABLE public.room_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.room_sessions(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type public.room_event_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_room_events_room_created ON public.room_events(room_id, created_at DESC);
GRANT SELECT, INSERT ON public.room_events TO authenticated;
GRANT ALL ON public.room_events TO service_role;
ALTER TABLE public.room_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_events_select_member" ON public.room_events FOR SELECT TO authenticated
USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));
CREATE POLICY "room_events_insert_member" ON public.room_events FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid() AND (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid())));

-- ---------- user_reports ----------
CREATE TABLE public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type public.report_target NOT NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  target_ref TEXT,
  category TEXT NOT NULL,
  details TEXT,
  status public.report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_details_len CHECK (details IS NULL OR char_length(details) <= 2000),
  CONSTRAINT reports_category_len CHECK (char_length(category) BETWEEN 2 AND 60),
  CONSTRAINT reports_no_self CHECK (target_user_id IS NULL OR target_user_id <> reporter_id)
);
CREATE INDEX idx_reports_status ON public.user_reports(status);
CREATE INDEX idx_reports_reporter ON public.user_reports(reporter_id);
GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_select_own_or_staff" ON public.user_reports FOR SELECT TO authenticated
USING (reporter_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "reports_insert_own" ON public.user_reports FOR INSERT TO authenticated
WITH CHECK (reporter_id = auth.uid());

-- ---------- moderation_actions ----------
CREATE TABLE public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.user_reports(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action public.moderation_action_type NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_moderation_target ON public.moderation_actions(target_user_id);
GRANT SELECT ON public.moderation_actions TO authenticated;
GRANT ALL ON public.moderation_actions TO service_role;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moderation_select_staff" ON public.moderation_actions FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR (room_id IS NOT NULL AND public.can_moderate_room(room_id, auth.uid())));

-- ---------- notifications ----------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own_select" ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "notifications_own_update" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_own_delete" ON public.notifications FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ---------- device_sessions ----------
CREATE TABLE public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_label TEXT,
  platform TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_sessions_user ON public.device_sessions(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_sessions TO authenticated;
GRANT ALL ON public.device_sessions TO service_role;
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices_own_all" ON public.device_sessions FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- analytics_events ----------
CREATE TABLE public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analytics_name_len CHECK (char_length(name) BETWEEN 2 AND 60)
);
CREATE INDEX idx_analytics_name_created ON public.analytics_events(name, created_at DESC);
GRANT SELECT, INSERT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analytics_insert_own" ON public.analytics_events FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "analytics_select_own_or_staff" ON public.analytics_events FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- ---------- audit_logs ----------
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor_created ON public.audit_logs(actor_id, created_at DESC);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_staff" ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_privacy_updated BEFORE UPDATE ON public.privacy_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_user_settings_updated BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_room_members_updated BEFORE UPDATE ON public.room_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_room_sessions_updated BEFORE UPDATE ON public.room_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON public.user_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- validation trigger: ephemeral room expiry must be in the future ----------
CREATE OR REPLACE FUNCTION public.validate_room_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'expires_at must be in the future';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_rooms_validate_expiry BEFORE INSERT ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.validate_room_expiry();

-- ---------- new user bootstrap ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.privacy_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- room creation bootstrap: owner becomes host member ----------
CREATE OR REPLACE FUNCTION public.handle_new_room()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.room_members (room_id, user_id, role, status, can_invite, can_moderate, can_control_playback)
  VALUES (NEW.id, NEW.owner_id, 'host', 'joined', true, true, true)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (NEW.id, NEW.owner_id, 'ROOM_CREATED', jsonb_build_object('type', NEW.type, 'privacy', NEW.privacy));
  RETURN NEW;
END; $$;

CREATE TRIGGER on_room_created
AFTER INSERT ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.handle_new_room();