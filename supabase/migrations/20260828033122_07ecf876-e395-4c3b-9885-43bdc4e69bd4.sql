ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'resource';
ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'note';
ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'task';
ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'queue_item';
ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'playlist';
ALTER TYPE public.report_target ADD VALUE IF NOT EXISTS 'local_media_session';