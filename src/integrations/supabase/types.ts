export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          reason: string | null
          requested_at: string
          status: Database["public"]["Enums"]["deletion_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          id: string
          name: string
          properties: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          properties?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          properties?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      device_sessions: {
        Row: {
          created_at: string
          device_label: string | null
          id: string
          last_seen_at: string
          platform: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          platform?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          platform?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          plan: Database["public"]["Enums"]["subscription_tier"]
          source: Database["public"]["Enums"]["entitlement_source"]
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_tier"]
          source?: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_tier"]
          source?: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      message_moderation_archive: {
        Row: {
          created_at: string
          id: string
          message_id: string
          original_content: string
          removal_kind: string
          removed_by: string | null
          room_id: string
          sender_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          original_content: string
          removal_kind: string
          removed_by?: string | null
          room_id: string
          sender_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          original_content?: string
          removal_kind?: string
          removed_by?: string | null
          room_id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_moderation_archive_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "room_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_moderation_archive_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          id: string
          message_id: string
          reaction: Database["public"]["Enums"]["message_reaction"]
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          reaction: Database["public"]["Enums"]["message_reaction"]
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          reaction?: Database["public"]["Enums"]["message_reaction"]
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "room_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          actor_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          reason: string | null
          report_id: string | null
          room_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          actor_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          reason?: string | null
          report_id?: string | null
          room_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["moderation_action_type"]
          actor_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          reason?: string | null
          report_id?: string | null
          room_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "user_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_settings: {
        Row: {
          activity_visibility: Database["public"]["Enums"]["visibility_level"]
          ads_consent: boolean
          analytics_consent: boolean
          created_at: string
          personalization_consent: boolean
          profile_visibility: Database["public"]["Enums"]["visibility_level"]
          room_data_retention_days: number
          room_visibility: Database["public"]["Enums"]["visibility_level"]
          searchable_by_username: boolean
          updated_at: string
          user_id: string
          who_can_invite: Database["public"]["Enums"]["visibility_level"]
          who_can_message: Database["public"]["Enums"]["visibility_level"]
        }
        Insert: {
          activity_visibility?: Database["public"]["Enums"]["visibility_level"]
          ads_consent?: boolean
          analytics_consent?: boolean
          created_at?: string
          personalization_consent?: boolean
          profile_visibility?: Database["public"]["Enums"]["visibility_level"]
          room_data_retention_days?: number
          room_visibility?: Database["public"]["Enums"]["visibility_level"]
          searchable_by_username?: boolean
          updated_at?: string
          user_id: string
          who_can_invite?: Database["public"]["Enums"]["visibility_level"]
          who_can_message?: Database["public"]["Enums"]["visibility_level"]
        }
        Update: {
          activity_visibility?: Database["public"]["Enums"]["visibility_level"]
          ads_consent?: boolean
          analytics_consent?: boolean
          created_at?: string
          personalization_consent?: boolean
          profile_visibility?: Database["public"]["Enums"]["visibility_level"]
          room_data_retention_days?: number
          room_visibility?: Database["public"]["Enums"]["visibility_level"]
          searchable_by_username?: boolean
          updated_at?: string
          user_id?: string
          who_can_invite?: Database["public"]["Enums"]["visibility_level"]
          who_can_message?: Database["public"]["Enums"]["visibility_level"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          status: Database["public"]["Enums"]["account_status"]
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          status?: Database["public"]["Enums"]["account_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          status?: Database["public"]["Enums"]["account_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          count: number
          created_at: string
          id: string
          user_id: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string
          id?: string
          user_id: string
          window_start: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string
          id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      room_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          payload: Json
          room_id: string
          session_id: string | null
          type: Database["public"]["Enums"]["room_event_type"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          room_id: string
          session_id?: string | null
          type: Database["public"]["Enums"]["room_event_type"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          room_id?: string
          session_id?: string | null
          type?: Database["public"]["Enums"]["room_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "room_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      room_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          revoked_at: string | null
          room_id: string
          token_hash: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          max_uses?: number
          revoked_at?: string | null
          room_id: string
          token_hash: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_uses?: number
          revoked_at?: string | null
          room_id?: string
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          can_control_playback: boolean
          can_invite: boolean
          can_moderate: boolean
          created_at: string
          id: string
          is_muted: boolean
          joined_at: string
          left_at: string | null
          role: Database["public"]["Enums"]["room_member_role"]
          room_id: string
          status: Database["public"]["Enums"]["room_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          can_control_playback?: boolean
          can_invite?: boolean
          can_moderate?: boolean
          created_at?: string
          id?: string
          is_muted?: boolean
          joined_at?: string
          left_at?: string | null
          role?: Database["public"]["Enums"]["room_member_role"]
          room_id: string
          status?: Database["public"]["Enums"]["room_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          can_control_playback?: boolean
          can_invite?: boolean
          can_moderate?: boolean
          created_at?: string
          id?: string
          is_muted?: boolean
          joined_at?: string
          left_at?: string | null
          role?: Database["public"]["Enums"]["room_member_role"]
          room_id?: string
          status?: Database["public"]["Enums"]["room_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_messages: {
        Row: {
          content: string
          content_type: Database["public"]["Enums"]["message_content_type"]
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          moderated_at: string | null
          moderated_by: string | null
          parent_message_id: string | null
          room_id: string
          sender_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          system_code: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          content_type?: Database["public"]["Enums"]["message_content_type"]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          parent_message_id?: string | null
          room_id: string
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          system_code?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          content_type?: Database["public"]["Enums"]["message_content_type"]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          parent_message_id?: string | null
          room_id?: string
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          system_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "room_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          expires_at: string | null
          id: string
          participant_peak: number
          room_id: string
          started_at: string
          started_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          participant_peak?: number
          room_id: string
          started_at?: string
          started_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          participant_peak?: number
          room_id?: string
          started_at?: string
          started_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          chat_retention: Database["public"]["Enums"]["chat_retention"]
          created_at: string
          description: string | null
          ended_at: string | null
          expires_at: string | null
          host_id: string | null
          id: string
          invite_only: boolean
          is_ephemeral: boolean
          join_code: string | null
          max_members: number
          name: string
          owner_id: string
          privacy: Database["public"]["Enums"]["room_privacy"]
          scheduled_start_at: string | null
          status: Database["public"]["Enums"]["room_status"]
          type: Database["public"]["Enums"]["room_type"]
          updated_at: string
        }
        Insert: {
          chat_retention?: Database["public"]["Enums"]["chat_retention"]
          created_at?: string
          description?: string | null
          ended_at?: string | null
          expires_at?: string | null
          host_id?: string | null
          id?: string
          invite_only?: boolean
          is_ephemeral?: boolean
          join_code?: string | null
          max_members?: number
          name: string
          owner_id: string
          privacy?: Database["public"]["Enums"]["room_privacy"]
          scheduled_start_at?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          type?: Database["public"]["Enums"]["room_type"]
          updated_at?: string
        }
        Update: {
          chat_retention?: Database["public"]["Enums"]["chat_retention"]
          created_at?: string
          description?: string | null
          ended_at?: string | null
          expires_at?: string | null
          host_id?: string | null
          id?: string
          invite_only?: boolean
          is_ephemeral?: boolean
          join_code?: string | null
          max_members?: number
          name?: string
          owner_id?: string
          privacy?: Database["public"]["Enums"]["room_privacy"]
          scheduled_start_at?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          type?: Database["public"]["Enums"]["room_type"]
          updated_at?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          category: string
          created_at: string
          details: string | null
          id: string
          reporter_id: string
          status: Database["public"]["Enums"]["report_status"]
          target_message_id: string | null
          target_ref: string | null
          target_room_id: string | null
          target_type: Database["public"]["Enums"]["report_target"]
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          details?: string | null
          id?: string
          reporter_id: string
          status?: Database["public"]["Enums"]["report_status"]
          target_message_id?: string | null
          target_ref?: string | null
          target_room_id?: string | null
          target_type: Database["public"]["Enums"]["report_target"]
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          details?: string | null
          id?: string
          reporter_id?: string
          status?: Database["public"]["Enums"]["report_status"]
          target_message_id?: string | null
          target_ref?: string | null
          target_room_id?: string | null
          target_type?: Database["public"]["Enums"]["report_target"]
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_target_message_id_fkey"
            columns: ["target_message_id"]
            isOneToOne: false
            referencedRelation: "room_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_target_room_id_fkey"
            columns: ["target_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          locale: string
          notify_email: boolean
          notify_push: boolean
          notify_room_activity: boolean
          notify_room_invites: boolean
          reduced_motion: boolean
          theme: string
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          locale?: string
          notify_email?: boolean
          notify_push?: boolean
          notify_room_activity?: boolean
          notify_room_invites?: boolean
          reduced_motion?: boolean
          theme?: string
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          locale?: string
          notify_email?: boolean
          notify_push?: boolean
          notify_room_activity?: boolean
          notify_room_invites?: boolean
          reduced_motion?: boolean
          theme?: string
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_roles: { Args: never; Returns: Json }
      admin_search_users: { Args: { _q: string }; Returns: Json }
      admit_member: {
        Args: {
          _room: Database["public"]["Tables"]["rooms"]["Row"]
          _uid: string
          _via: string
        }
        Returns: Json
      }
      assign_app_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
      authorize_room_channel: { Args: { _room_id: string }; Returns: boolean }
      bootstrap_first_admin: { Args: { _email: string }; Returns: Json }
      can_moderate_room: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: { _action: string; _limit: number; _window_seconds: number }
        Returns: boolean
      }
      create_moderation_action: {
        Args: {
          _action: Database["public"]["Enums"]["moderation_action_type"]
          _reason: string
          _report_id: string
          _room_id: string
          _target_user_id: string
        }
        Returns: Json
      }
      create_room_invite: {
        Args: {
          _expires_in_hours: number
          _max_uses: number
          _room_id: string
          _token_hash: string
        }
        Returns: Json
      }
      current_plan: {
        Args: never
        Returns: Database["public"]["Enums"]["subscription_tier"]
      }
      delete_room_message: { Args: { _message_id: string }; Returns: Json }
      edit_room_message: {
        Args: { _content: string; _message_id: string }
        Returns: Json
      }
      end_room: { Args: { _room_id: string }; Returns: Json }
      export_user_data: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_blocked_between: { Args: { _a: string; _b: string }; Returns: boolean }
      is_room_host: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_room_member: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      join_room_by_code: { Args: { _code: string }; Returns: Json }
      leave_room: { Args: { _room_id: string }; Returns: Json }
      my_staff_context: { Args: never; Returns: Json }
      pick_room_successor: {
        Args: { _excluding: string; _room_id: string }
        Returns: string
      }
      purge_expired_chat: { Args: never; Returns: number }
      purge_user_data: { Args: { _user_id: string }; Returns: Json }
      redeem_room_invite: { Args: { _token_hash: string }; Returns: Json }
      report_message: {
        Args: { _category: string; _details?: string; _message_id: string }
        Returns: Json
      }
      request_account_deletion: { Args: { _reason: string }; Returns: Json }
      revoke_app_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
      revoke_room_invite: { Args: { _invite_id: string }; Returns: Json }
      room_is_joinable: {
        Args: { _room: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: string
      }
      room_member_directory: {
        Args: { _room_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          joined_at: string
          role: Database["public"]["Enums"]["room_member_role"]
          status: Database["public"]["Enums"]["room_member_status"]
          user_id: string
          username: string
        }[]
      }
      send_room_message: {
        Args: {
          _content: string
          _parent_message_id?: string
          _room_id: string
        }
        Returns: Json
      }
      set_member_mute: {
        Args: { _muted: boolean; _room_id: string; _user_id: string }
        Returns: Json
      }
      set_report_status: {
        Args: {
          _note?: string
          _report_id: string
          _status: Database["public"]["Enums"]["report_status"]
        }
        Returns: Json
      }
      shares_room_with: { Args: { _a: string; _b: string }; Returns: boolean }
      staff_get_removed_message: {
        Args: { _message_id: string }
        Returns: Json
      }
      staff_moderation_overview: { Args: never; Returns: Json }
      staff_report_detail: { Args: { _report_id: string }; Returns: Json }
      staff_report_queue: {
        Args: {
          _category?: string
          _from?: string
          _limit?: number
          _offset?: number
          _status?: Database["public"]["Enums"]["report_status"]
          _target_type?: Database["public"]["Enums"]["report_target"]
          _to?: string
        }
        Returns: Json
      }
      toggle_message_reaction: {
        Args: { _message_id: string; _reaction: string }
        Returns: Json
      }
      transfer_room_host: {
        Args: { _room_id: string; _to_user: string }
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "deactivated" | "deleted"
      app_role: "user" | "moderator" | "admin"
      chat_retention: "persistent" | "room_expiry" | "24h" | "7d"
      deletion_status:
        | "requested"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
      entitlement_source: "system" | "grant" | "promo" | "billing"
      entitlement_status: "active" | "expired" | "revoked" | "pending"
      message_content_type: "text" | "system"
      message_reaction: "thumbs_up" | "heart" | "joy" | "wow" | "sad" | "fire"
      message_status: "active" | "deleted" | "moderated"
      moderation_action_type:
        | "warn"
        | "mute"
        | "kick"
        | "ban"
        | "suspend"
        | "content_removed"
        | "dismissed"
      report_status: "open" | "reviewing" | "actioned" | "dismissed"
      report_target: "user" | "room" | "message" | "other"
      room_event_type:
        | "ROOM_CREATED"
        | "ROOM_UPDATED"
        | "USER_JOINED"
        | "USER_LEFT"
        | "HOST_CHANGED"
        | "PLAY"
        | "PAUSE"
        | "SEEK"
        | "CONTENT_CHANGED"
        | "CHAT_MESSAGE"
        | "REACTION"
        | "SCREEN_SHARE_STARTED"
        | "SCREEN_SHARE_STOPPED"
        | "ROOM_ENDED"
      room_member_role: "host" | "co_host" | "moderator" | "member" | "guest"
      room_member_status: "invited" | "joined" | "left" | "kicked" | "banned"
      room_privacy: "private" | "invite_only" | "unlisted" | "public"
      room_status: "draft" | "active" | "paused" | "ended" | "archived"
      room_type:
        | "couple"
        | "friends"
        | "family"
        | "study"
        | "research"
        | "music"
        | "watch"
        | "game"
        | "private"
      subscription_tier: "free" | "pro" | "pro_plus"
      visibility_level: "public" | "members" | "contacts" | "private"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended", "deactivated", "deleted"],
      app_role: ["user", "moderator", "admin"],
      chat_retention: ["persistent", "room_expiry", "24h", "7d"],
      deletion_status: [
        "requested",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
      entitlement_source: ["system", "grant", "promo", "billing"],
      entitlement_status: ["active", "expired", "revoked", "pending"],
      message_content_type: ["text", "system"],
      message_reaction: ["thumbs_up", "heart", "joy", "wow", "sad", "fire"],
      message_status: ["active", "deleted", "moderated"],
      moderation_action_type: [
        "warn",
        "mute",
        "kick",
        "ban",
        "suspend",
        "content_removed",
        "dismissed",
      ],
      report_status: ["open", "reviewing", "actioned", "dismissed"],
      report_target: ["user", "room", "message", "other"],
      room_event_type: [
        "ROOM_CREATED",
        "ROOM_UPDATED",
        "USER_JOINED",
        "USER_LEFT",
        "HOST_CHANGED",
        "PLAY",
        "PAUSE",
        "SEEK",
        "CONTENT_CHANGED",
        "CHAT_MESSAGE",
        "REACTION",
        "SCREEN_SHARE_STARTED",
        "SCREEN_SHARE_STOPPED",
        "ROOM_ENDED",
      ],
      room_member_role: ["host", "co_host", "moderator", "member", "guest"],
      room_member_status: ["invited", "joined", "left", "kicked", "banned"],
      room_privacy: ["private", "invite_only", "unlisted", "public"],
      room_status: ["draft", "active", "paused", "ended", "archived"],
      room_type: [
        "couple",
        "friends",
        "family",
        "study",
        "research",
        "music",
        "watch",
        "game",
        "private",
      ],
      subscription_tier: ["free", "pro", "pro_plus"],
      visibility_level: ["public", "members", "contacts", "private"],
    },
  },
} as const
