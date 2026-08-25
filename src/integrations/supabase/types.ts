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
      ad_config: {
        Row: {
          config: Json
          id: boolean
          updated_at: string
        }
        Insert: {
          config: Json
          id?: boolean
          updated_at?: string
        }
        Update: {
          config?: Json
          id?: boolean
          updated_at?: string
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
      call_signals: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          recipient_id: string
          room_id: string
          sender_id: string
          session_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          payload?: Json
          recipient_id: string
          room_id: string
          sender_id: string
          session_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          recipient_id?: string
          room_id?: string
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_signals_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_signals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      call_transport_grants: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          relay_allowed: boolean
          revoked_at: string | null
          room_id: string
          session_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          issued_at?: string
          relay_allowed?: boolean
          revoked_at?: string | null
          room_id: string
          session_id: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          relay_allowed?: boolean
          revoked_at?: string | null
          room_id?: string
          session_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_transport_grants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transport_grants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_call_sessions"
            referencedColumns: ["id"]
          },
        ]
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
          cancel_at_period_end: boolean
          created_at: string
          entitlement_key: string
          event_seq: number
          expires_at: string | null
          grace_until: string | null
          id: string
          last_event_at: string | null
          plan: Database["public"]["Enums"]["subscription_tier"]
          product_id: string | null
          purchase_token_hash: string | null
          source: Database["public"]["Enums"]["entitlement_source"]
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          entitlement_key?: string
          event_seq?: number
          expires_at?: string | null
          grace_until?: string | null
          id?: string
          last_event_at?: string | null
          plan?: Database["public"]["Enums"]["subscription_tier"]
          product_id?: string | null
          purchase_token_hash?: string | null
          source?: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          entitlement_key?: string
          event_seq?: number
          expires_at?: string | null
          grace_until?: string | null
          id?: string
          last_event_at?: string | null
          plan?: Database["public"]["Enums"]["subscription_tier"]
          product_id?: string | null
          purchase_token_hash?: string | null
          source?: Database["public"]["Enums"]["entitlement_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      local_media_signals: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          recipient_id: string
          room_id: string
          sender_id: string
          session_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          payload?: Json
          recipient_id: string
          room_id: string
          sender_id: string
          session_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          recipient_id?: string
          room_id?: string
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_media_signals_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "local_media_signals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_local_media_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      local_media_transport_grants: {
        Row: {
          created_at: string
          expires_at: string
          grant_role: string
          id: string
          issued_at: string
          relay_allowed: boolean
          revoked_at: string | null
          room_id: string
          session_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          grant_role: string
          id?: string
          issued_at?: string
          relay_allowed?: boolean
          revoked_at?: string | null
          room_id: string
          session_id: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          grant_role?: string
          id?: string
          issued_at?: string
          relay_allowed?: boolean
          revoked_at?: string | null
          room_id?: string
          session_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_media_transport_grants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "local_media_transport_grants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_local_media_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      media_metadata_cache: {
        Row: {
          embeddable: boolean
          expires_at: string
          id: string
          made_for_kids: boolean
          media_id: string
          privacy_status: string | null
          provider: string
          recorded_at: string
          source: string
          status: string
          thumbnail_url: string | null
          title: string | null
        }
        Insert: {
          embeddable?: boolean
          expires_at?: string
          id?: string
          made_for_kids?: boolean
          media_id: string
          privacy_status?: string | null
          provider: string
          recorded_at?: string
          source?: string
          status?: string
          thumbnail_url?: string | null
          title?: string | null
        }
        Update: {
          embeddable?: boolean
          expires_at?: string
          id?: string
          made_for_kids?: boolean
          media_id?: string
          privacy_status?: string | null
          provider?: string
          recorded_at?: string
          source?: string
          status?: string
          thumbnail_url?: string | null
          title?: string | null
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
      plan_limits: {
        Row: {
          limits: Json
          plan_key: string
          updated_at: string
        }
        Insert: {
          limits: Json
          plan_key: string
          updated_at?: string
        }
        Update: {
          limits?: Json
          plan_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      play_rtdn_messages: {
        Row: {
          attempts: number
          detail: Json
          event_seq: number
          kind: string
          message_id: string
          notification_type: number | null
          outcome: string
          processed_at: string | null
          publish_time: string | null
          purchase_token_hash: string | null
          received_at: string
        }
        Insert: {
          attempts?: number
          detail?: Json
          event_seq?: number
          kind: string
          message_id: string
          notification_type?: number | null
          outcome?: string
          processed_at?: string | null
          publish_time?: string | null
          purchase_token_hash?: string | null
          received_at?: string
        }
        Update: {
          attempts?: number
          detail?: Json
          event_seq?: number
          kind?: string
          message_id?: string
          notification_type?: number | null
          outcome?: string
          processed_at?: string | null
          publish_time?: string | null
          purchase_token_hash?: string | null
          received_at?: string
        }
        Relationships: []
      }
      playlist_items: {
        Row: {
          created_at: string
          id: string
          playlist_id: string
          position: number
          provider: Database["public"]["Enums"]["playback_provider"]
          provider_media_id: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          playlist_id: string
          position: number
          provider?: Database["public"]["Enums"]["playback_provider"]
          provider_media_id: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          playlist_id?: string
          position?: number
          provider?: Database["public"]["Enums"]["playback_provider"]
          provider_media_id?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_items_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          room_id: string | null
          updated_at: string
          version: number
          visibility: Database["public"]["Enums"]["playlist_visibility"]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          room_id?: string | null
          updated_at?: string
          version?: number
          visibility?: Database["public"]["Enums"]["playlist_visibility"]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          room_id?: string | null
          updated_at?: string
          version?: number
          visibility?: Database["public"]["Enums"]["playlist_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "playlists_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
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
      room_call_participants: {
        Row: {
          camera_enabled: boolean
          connection_state: Database["public"]["Enums"]["call_connection_state"]
          created_at: string
          id: string
          joined_at: string
          last_seen_at: string
          left_at: string | null
          mic_enabled: boolean
          room_id: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          camera_enabled?: boolean
          connection_state?: Database["public"]["Enums"]["call_connection_state"]
          created_at?: string
          id?: string
          joined_at?: string
          last_seen_at?: string
          left_at?: string | null
          mic_enabled?: boolean
          room_id: string
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          camera_enabled?: boolean
          connection_state?: Database["public"]["Enums"]["call_connection_state"]
          created_at?: string
          id?: string
          joined_at?: string
          last_seen_at?: string
          left_at?: string | null
          mic_enabled?: boolean
          room_id?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_call_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_call_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      room_call_sessions: {
        Row: {
          allow_relay: boolean
          call_mode: Database["public"]["Enums"]["call_mode"]
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          max_participants: number
          room_id: string
          session_status: Database["public"]["Enums"]["call_session_status"]
          started_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          allow_relay?: boolean
          call_mode?: Database["public"]["Enums"]["call_mode"]
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          max_participants?: number
          room_id: string
          session_status?: Database["public"]["Enums"]["call_session_status"]
          started_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          allow_relay?: boolean
          call_mode?: Database["public"]["Enums"]["call_mode"]
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          max_participants?: number
          room_id?: string
          session_status?: Database["public"]["Enums"]["call_session_status"]
          started_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_call_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_call_settings: {
        Row: {
          admission: Database["public"]["Enums"]["call_admission"]
          allow_relay: boolean
          control_mode: Database["public"]["Enums"]["room_queue_mode"]
          created_at: string
          max_video_participants: number
          max_voice_participants: number
          room_id: string
          updated_at: string
        }
        Insert: {
          admission?: Database["public"]["Enums"]["call_admission"]
          allow_relay?: boolean
          control_mode?: Database["public"]["Enums"]["room_queue_mode"]
          created_at?: string
          max_video_participants?: number
          max_voice_participants?: number
          room_id: string
          updated_at?: string
        }
        Update: {
          admission?: Database["public"]["Enums"]["call_admission"]
          allow_relay?: boolean
          control_mode?: Database["public"]["Enums"]["room_queue_mode"]
          created_at?: string
          max_video_participants?: number
          max_voice_participants?: number
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_call_settings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
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
      room_focus_timer: {
        Row: {
          created_at: string
          duration_seconds: number
          ends_at: string | null
          phase: Database["public"]["Enums"]["focus_timer_phase"]
          remaining_seconds: number | null
          room_id: string
          sessions_completed: number
          started_at: string | null
          status: Database["public"]["Enums"]["focus_timer_status"]
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          ends_at?: string | null
          phase?: Database["public"]["Enums"]["focus_timer_phase"]
          remaining_seconds?: number | null
          room_id: string
          sessions_completed?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["focus_timer_status"]
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          ends_at?: string | null
          phase?: Database["public"]["Enums"]["focus_timer_phase"]
          remaining_seconds?: number | null
          room_id?: string
          sessions_completed?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["focus_timer_status"]
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_focus_timer_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
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
      room_local_media_sessions: {
        Row: {
          controller_id: string | null
          created_at: string
          current_index: number
          duration_seconds: number | null
          ended_at: string | null
          expires_at: string
          id: string
          item_count: number
          media_kind: Database["public"]["Enums"]["local_media_kind"]
          mime_type: string | null
          owner_id: string
          owner_seen_at: string
          playback_started_at: string | null
          playback_status: Database["public"]["Enums"]["playback_status"]
          position_seconds: number
          room_id: string
          status: Database["public"]["Enums"]["local_media_session_status"]
          transport_state: Database["public"]["Enums"]["local_media_transport_state"]
          updated_at: string
          version: number
        }
        Insert: {
          controller_id?: string | null
          created_at?: string
          current_index?: number
          duration_seconds?: number | null
          ended_at?: string | null
          expires_at?: string
          id?: string
          item_count?: number
          media_kind: Database["public"]["Enums"]["local_media_kind"]
          mime_type?: string | null
          owner_id: string
          owner_seen_at?: string
          playback_started_at?: string | null
          playback_status?: Database["public"]["Enums"]["playback_status"]
          position_seconds?: number
          room_id: string
          status?: Database["public"]["Enums"]["local_media_session_status"]
          transport_state?: Database["public"]["Enums"]["local_media_transport_state"]
          updated_at?: string
          version?: number
        }
        Update: {
          controller_id?: string | null
          created_at?: string
          current_index?: number
          duration_seconds?: number | null
          ended_at?: string | null
          expires_at?: string
          id?: string
          item_count?: number
          media_kind?: Database["public"]["Enums"]["local_media_kind"]
          mime_type?: string | null
          owner_id?: string
          owner_seen_at?: string
          playback_started_at?: string | null
          playback_status?: Database["public"]["Enums"]["playback_status"]
          position_seconds?: number
          room_id?: string
          status?: Database["public"]["Enums"]["local_media_session_status"]
          transport_state?: Database["public"]["Enums"]["local_media_transport_state"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_local_media_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_local_media_settings: {
        Row: {
          allow_relay: boolean
          created_at: string
          room_id: string
          share_mode: Database["public"]["Enums"]["room_queue_mode"]
          updated_at: string
        }
        Insert: {
          allow_relay?: boolean
          created_at?: string
          room_id: string
          share_mode?: Database["public"]["Enums"]["room_queue_mode"]
          updated_at?: string
        }
        Update: {
          allow_relay?: boolean
          created_at?: string
          room_id?: string
          share_mode?: Database["public"]["Enums"]["room_queue_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_local_media_settings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_media_queue: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          played_at: string | null
          policy_check_result: Json | null
          position: number
          provider: Database["public"]["Enums"]["playback_provider"]
          provider_media_id: string
          room_id: string
          status: Database["public"]["Enums"]["queue_item_status"]
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          played_at?: string | null
          policy_check_result?: Json | null
          position: number
          provider?: Database["public"]["Enums"]["playback_provider"]
          provider_media_id: string
          room_id: string
          status?: Database["public"]["Enums"]["queue_item_status"]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          played_at?: string | null
          policy_check_result?: Json | null
          position?: number
          provider?: Database["public"]["Enums"]["playback_provider"]
          provider_media_id?: string
          room_id?: string
          status?: Database["public"]["Enums"]["queue_item_status"]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_media_queue_room_id_fkey"
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
      room_note_revisions: {
        Row: {
          content_length: number
          created_at: string
          id: string
          note_id: string
          revision: number
          room_id: string
          updated_by: string | null
        }
        Insert: {
          content_length?: number
          created_at?: string
          id?: string
          note_id: string
          revision: number
          room_id: string
          updated_by?: string | null
        }
        Update: {
          content_length?: number
          created_at?: string
          id?: string
          note_id?: string
          revision?: number
          room_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_note_revisions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "room_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_note_revisions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          revision: number
          room_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          revision?: number
          room_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          revision?: number
          room_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_notes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_playback_state: {
        Row: {
          controlled_by: string | null
          created_at: string
          playback_started_at: string | null
          playback_status: Database["public"]["Enums"]["playback_status"]
          policy_check_result: Json | null
          position_seconds: number
          provider: Database["public"]["Enums"]["playback_provider"] | null
          provider_media_id: string | null
          room_id: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          controlled_by?: string | null
          created_at?: string
          playback_started_at?: string | null
          playback_status?: Database["public"]["Enums"]["playback_status"]
          policy_check_result?: Json | null
          position_seconds?: number
          provider?: Database["public"]["Enums"]["playback_provider"] | null
          provider_media_id?: string | null
          room_id: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          controlled_by?: string | null
          created_at?: string
          playback_started_at?: string | null
          playback_status?: Database["public"]["Enums"]["playback_status"]
          policy_check_result?: Json | null
          position_seconds?: number
          provider?: Database["public"]["Enums"]["playback_provider"] | null
          provider_media_id?: string | null
          room_id?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_playback_state_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_queue_settings: {
        Row: {
          created_at: string
          queue_mode: Database["public"]["Enums"]["room_queue_mode"]
          queue_version: number
          repeat_mode: Database["public"]["Enums"]["room_repeat_mode"]
          room_id: string
          shuffle_enabled: boolean
          shuffle_seed: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          queue_mode?: Database["public"]["Enums"]["room_queue_mode"]
          queue_version?: number
          repeat_mode?: Database["public"]["Enums"]["room_repeat_mode"]
          room_id: string
          shuffle_enabled?: boolean
          shuffle_seed?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          queue_mode?: Database["public"]["Enums"]["room_queue_mode"]
          queue_version?: number
          repeat_mode?: Database["public"]["Enums"]["room_repeat_mode"]
          room_id?: string
          shuffle_enabled?: boolean
          shuffle_seed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_queue_settings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_resources: {
        Row: {
          added_by: string | null
          created_at: string
          description: string | null
          favicon_url: string | null
          host: string | null
          id: string
          normalized_url: string | null
          pinned: boolean
          provider_media_id: string | null
          resource_type: Database["public"]["Enums"]["resource_kind"]
          room_id: string
          status: Database["public"]["Enums"]["resource_status"]
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          host?: string | null
          id?: string
          normalized_url?: string | null
          pinned?: boolean
          provider_media_id?: string | null
          resource_type?: Database["public"]["Enums"]["resource_kind"]
          room_id: string
          status?: Database["public"]["Enums"]["resource_status"]
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          host?: string | null
          id?: string
          normalized_url?: string | null
          pinned?: boolean
          provider_media_id?: string | null
          resource_type?: Database["public"]["Enums"]["resource_kind"]
          room_id?: string
          status?: Database["public"]["Enums"]["resource_status"]
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_resources_room_id_fkey"
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
      room_study_settings: {
        Row: {
          created_at: string
          focus_mode: Database["public"]["Enums"]["research_focus_mode"]
          focus_version: number
          focused_resource_id: string | null
          note_mode: Database["public"]["Enums"]["research_permission_mode"]
          private_research_mode: boolean
          resource_mode: Database["public"]["Enums"]["research_permission_mode"]
          room_id: string
          timer_mode: Database["public"]["Enums"]["research_permission_mode"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          focus_mode?: Database["public"]["Enums"]["research_focus_mode"]
          focus_version?: number
          focused_resource_id?: string | null
          note_mode?: Database["public"]["Enums"]["research_permission_mode"]
          private_research_mode?: boolean
          resource_mode?: Database["public"]["Enums"]["research_permission_mode"]
          room_id: string
          timer_mode?: Database["public"]["Enums"]["research_permission_mode"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          focus_mode?: Database["public"]["Enums"]["research_focus_mode"]
          focus_version?: number
          focused_resource_id?: string | null
          note_mode?: Database["public"]["Enums"]["research_permission_mode"]
          private_research_mode?: boolean
          resource_mode?: Database["public"]["Enums"]["research_permission_mode"]
          room_id?: string
          timer_mode?: Database["public"]["Enums"]["research_permission_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_study_settings_focus_fk"
            columns: ["focused_resource_id"]
            isOneToOne: false
            referencedRelation: "room_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_study_settings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          room_id: string
          status: Database["public"]["Enums"]["study_task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          room_id: string
          status?: Database["public"]["Enums"]["study_task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          room_id?: string
          status?: Database["public"]["Enums"]["study_task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_tasks_room_id_fkey"
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
      subscription_events: {
        Row: {
          applied: boolean
          created_at: string
          dedupe_key: string
          event_seq: number
          event_time: string
          event_type: string
          id: string
          metadata: Json
          outcome: string
          product_id: string | null
          provider: string
          purchase_token_hash: string | null
          user_id: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          dedupe_key: string
          event_seq?: number
          event_time?: string
          event_type: string
          id?: string
          metadata?: Json
          outcome?: string
          product_id?: string | null
          provider?: string
          purchase_token_hash?: string | null
          user_id: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          dedupe_key?: string
          event_seq?: number
          event_time?: string
          event_type?: string
          id?: string
          metadata?: Json
          outcome?: string
          product_id?: string | null
          provider?: string
          purchase_token_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscription_products: {
        Row: {
          base_plan_id: string | null
          created_at: string
          entitlement_key: string
          id: string
          is_active: boolean
          offer_id: string | null
          period: string
          plan: Database["public"]["Enums"]["subscription_tier"]
          platform: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_plan_id?: string | null
          created_at?: string
          entitlement_key?: string
          id: string
          is_active?: boolean
          offer_id?: string | null
          period?: string
          plan?: Database["public"]["Enums"]["subscription_tier"]
          platform?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_plan_id?: string | null
          created_at?: string
          entitlement_key?: string
          id?: string
          is_active?: boolean
          offer_id?: string | null
          period?: string
          plan?: Database["public"]["Enums"]["subscription_tier"]
          platform?: string
          sort_order?: number
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
      add_playlist_item: {
        Args: { _media_id: string; _playlist_id: string; _provider: string }
        Returns: Json
      }
      add_room_resource: {
        Args: {
          _description?: string
          _host?: string
          _normalized_url?: string
          _provider_media_id?: string
          _resource_type: string
          _room_id: string
          _title: string
          _url?: string
        }
        Returns: Json
      }
      add_to_queue: {
        Args: { _media_id: string; _provider: string; _room_id: string }
        Returns: Json
      }
      admin_grant_entitlement: {
        Args: {
          _expires_at?: string
          _reason: string
          _revoke?: boolean
          _user_id: string
        }
        Returns: Json
      }
      admin_list_roles: { Args: never; Returns: Json }
      admin_search_users: { Args: { _q: string }; Returns: Json }
      admin_subscription_overview: { Args: { _user_id: string }; Returns: Json }
      admit_member: {
        Args: {
          _room: Database["public"]["Tables"]["rooms"]["Row"]
          _uid: string
          _via: string
        }
        Returns: Json
      }
      advance_queue: {
        Args: { _cause?: string; _expected_version?: number; _room_id: string }
        Returns: Json
      }
      apply_billing_event: {
        Args: {
          _cancel_at_period_end?: boolean
          _event_seq?: number
          _event_time?: string
          _event_type: string
          _expires_at?: string
          _grace_until?: string
          _metadata?: Json
          _product_id?: string
          _provider?: string
          _purchase_token?: string
          _user_id: string
        }
        Returns: Json
      }
      apply_queue_item: {
        Args: {
          _item: Database["public"]["Tables"]["room_media_queue"]["Row"]
          _room_id: string
          _uid: string
        }
        Returns: undefined
      }
      approve_queue_item: { Args: { _item_id: string }; Returns: Json }
      assign_app_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
      authorize_room_channel: { Args: { _room_id: string }; Returns: boolean }
      bootstrap_first_admin: { Args: { _email: string }; Returns: Json }
      bump_queue_version: { Args: { _room_id: string }; Returns: number }
      call_block_conflict: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      call_heartbeat: { Args: { _session_id: string }; Returns: Json }
      call_precheck: {
        Args: {
          _action: string
          _limit: number
          _room_id: string
          _window: number
        }
        Returns: Json
      }
      call_snapshot: { Args: { _room_id: string }; Returns: Json }
      can_control_playback: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      can_control_study: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_queue: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      can_moderate_room: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      clear_queue: {
        Args: { _expected_queue_version?: number; _room_id: string }
        Returns: Json
      }
      clear_room_media: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
      consume_rate_limit: {
        Args: { _action: string; _limit: number; _window_seconds: number }
        Returns: boolean
      }
      control_focus_timer: {
        Args: {
          _action: string
          _duration_seconds?: number
          _expected_version?: number
          _phase?: string
          _room_id: string
        }
        Returns: Json
      }
      control_local_media_playback: {
        Args: {
          _action: string
          _expected_version?: number
          _index?: number
          _position_seconds?: number
          _session_id: string
        }
        Returns: Json
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
      create_playlist: {
        Args: { _description?: string; _name: string }
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
      create_room_note: {
        Args: { _content?: string; _room_id: string; _title: string }
        Returns: Json
      }
      create_room_task: {
        Args: {
          _assigned_to?: string
          _description?: string
          _room_id: string
          _title: string
        }
        Returns: Json
      }
      current_plan: {
        Args: never
        Returns: Database["public"]["Enums"]["subscription_tier"]
      }
      delete_playlist: { Args: { _playlist_id: string }; Returns: Json }
      delete_room_message: { Args: { _message_id: string }; Returns: Json }
      delete_room_note: { Args: { _note_id: string }; Returns: Json }
      delete_room_task: { Args: { _task_id: string }; Returns: Json }
      edit_room_message: {
        Args: { _content: string; _message_id: string }
        Returns: Json
      }
      emit_playback_system_message: {
        Args: { _code: string; _room_id: string; _text: string }
        Returns: undefined
      }
      end_call_session: {
        Args: { _expected_version?: number; _session_id: string }
        Returns: Json
      }
      end_local_media_session: { Args: { _session_id: string }; Returns: Json }
      end_room: { Args: { _room_id: string }; Returns: Json }
      ensure_call_settings: {
        Args: { _room_id: string }
        Returns: {
          admission: Database["public"]["Enums"]["call_admission"]
          allow_relay: boolean
          control_mode: Database["public"]["Enums"]["room_queue_mode"]
          created_at: string
          max_video_participants: number
          max_voice_participants: number
          room_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "room_call_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_local_media_settings: {
        Args: { _room_id: string }
        Returns: {
          allow_relay: boolean
          created_at: string
          room_id: string
          share_mode: Database["public"]["Enums"]["room_queue_mode"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "room_local_media_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_study_settings: {
        Args: { _room_id: string }
        Returns: {
          created_at: string
          focus_mode: Database["public"]["Enums"]["research_focus_mode"]
          focus_version: number
          focused_resource_id: string | null
          note_mode: Database["public"]["Enums"]["research_permission_mode"]
          private_research_mode: boolean
          resource_mode: Database["public"]["Enums"]["research_permission_mode"]
          room_id: string
          timer_mode: Database["public"]["Enums"]["research_permission_mode"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "room_study_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      entitlement_precheck: { Args: { _feature: string }; Returns: Json }
      entitlement_snapshot: { Args: { _user_id: string }; Returns: Json }
      export_user_data: { Args: never; Returns: Json }
      fetch_call_signals: {
        Args: { _session_id: string; _token: string }
        Returns: Json
      }
      fetch_local_media_signals: {
        Args: { _session_id: string; _token: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_blocked_between: { Args: { _a: string; _b: string }; Returns: boolean }
      is_premium: { Args: { _user_id: string }; Returns: boolean }
      is_room_host: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_room_member: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      issue_call_transport_grant: {
        Args: { _session_id: string }
        Returns: Json
      }
      issue_local_media_transport_grant: {
        Args: { _session_id: string }
        Returns: Json
      }
      join_call_session: {
        Args: { _camera?: boolean; _mic?: boolean; _session_id: string }
        Returns: Json
      }
      join_room_by_code: { Args: { _code: string }; Returns: Json }
      leave_call_session: { Args: { _session_id: string }; Returns: Json }
      leave_room: { Args: { _room_id: string }; Returns: Json }
      local_media_owner_heartbeat: {
        Args: { _session_id: string }
        Returns: Json
      }
      local_media_precheck: {
        Args: {
          _action: string
          _limit: number
          _room_id: string
          _window: number
        }
        Returns: Json
      }
      local_media_snapshot: { Args: { _room_id: string }; Returns: Json }
      lock_queue_settings: {
        Args: { _room_id: string }
        Returns: {
          created_at: string
          queue_mode: Database["public"]["Enums"]["room_queue_mode"]
          queue_version: number
          repeat_mode: Database["public"]["Enums"]["room_repeat_mode"]
          room_id: string
          shuffle_enabled: boolean
          shuffle_seed: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "room_queue_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_playlist_item: {
        Args: {
          _expected_version?: number
          _item_id: string
          _target_index: number
        }
        Returns: Json
      }
      move_queue_item: {
        Args: {
          _expected_queue_version: number
          _item_id: string
          _target_index: number
        }
        Returns: Json
      }
      my_entitlement: { Args: never; Returns: Json }
      my_staff_context: { Args: never; Returns: Json }
      my_subscription_events: { Args: { _limit?: number }; Returns: Json }
      pause_room_media: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
      pick_next_queue_item: {
        Args: { _exclude: string; _room_id: string }
        Returns: {
          added_by: string | null
          created_at: string
          id: string
          played_at: string | null
          policy_check_result: Json | null
          position: number
          provider: Database["public"]["Enums"]["playback_provider"]
          provider_media_id: string
          room_id: string
          status: Database["public"]["Enums"]["queue_item_status"]
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "room_media_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pick_room_successor: {
        Args: { _excluding: string; _room_id: string }
        Returns: string
      }
      play_room_media: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
      playback_current_position: {
        Args: {
          _state: Database["public"]["Tables"]["room_playback_state"]["Row"]
        }
        Returns: number
      }
      playback_precheck: {
        Args: {
          _action: string
          _expected_version: number
          _limit: number
          _room_id: string
          _window_seconds: number
        }
        Returns: Json
      }
      post_call_signal: {
        Args: {
          _kind: string
          _payload: Json
          _recipient_id: string
          _session_id: string
          _token: string
        }
        Returns: Json
      }
      post_local_media_signal: {
        Args: {
          _kind: string
          _payload: Json
          _recipient_id: string
          _session_id: string
          _token: string
        }
        Returns: Json
      }
      previous_queue_item: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
      purge_expired_chat: { Args: never; Returns: number }
      purge_user_data: { Args: { _user_id: string }; Returns: Json }
      queue_precheck: {
        Args: {
          _action: string
          _expected_queue_version?: number
          _limit: number
          _room_id: string
          _window_seconds: number
        }
        Returns: Json
      }
      queue_snapshot: { Args: { _room_id: string }; Returns: Json }
      reap_local_media_owner_absence: {
        Args: { _session_id: string }
        Returns: Json
      }
      redeem_call_transport_grant: {
        Args: { _session_id: string; _token: string }
        Returns: Json
      }
      redeem_local_media_transport_grant: {
        Args: { _session_id: string; _token: string }
        Returns: Json
      }
      redeem_room_invite: { Args: { _token_hash: string }; Returns: Json }
      reject_queue_item: { Args: { _item_id: string }; Returns: Json }
      remove_from_queue: { Args: { _item_id: string }; Returns: Json }
      remove_playlist_item: { Args: { _item_id: string }; Returns: Json }
      remove_room_resource: { Args: { _resource_id: string }; Returns: Json }
      report_message: {
        Args: { _category: string; _details?: string; _message_id: string }
        Returns: Json
      }
      request_account_deletion: { Args: { _reason: string }; Returns: Json }
      restart_current_item: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
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
      room_playback_snapshot: { Args: { _room_id: string }; Returns: Json }
      seek_room_media: {
        Args: {
          _expected_version?: number
          _position_seconds: number
          _room_id: string
        }
        Returns: Json
      }
      send_room_message: {
        Args: {
          _content: string
          _parent_message_id?: string
          _room_id: string
        }
        Returns: Json
      }
      set_call_media_state: {
        Args: {
          _camera?: boolean
          _connection_state?: string
          _mic?: boolean
          _session_id: string
        }
        Returns: Json
      }
      set_call_settings: {
        Args: {
          _allow_relay?: boolean
          _control_mode?: string
          _max_video?: number
          _max_voice?: number
          _room_id: string
        }
        Returns: Json
      }
      set_focused_resource: {
        Args: {
          _expected_version?: number
          _resource_id: string
          _room_id: string
        }
        Returns: Json
      }
      set_local_media_settings: {
        Args: { _allow_relay?: boolean; _room_id: string; _share_mode?: string }
        Returns: Json
      }
      set_member_mute: {
        Args: { _muted: boolean; _room_id: string; _user_id: string }
        Returns: Json
      }
      set_queue_mode: {
        Args: { _mode: string; _room_id: string }
        Returns: Json
      }
      set_repeat_mode: {
        Args: { _mode: string; _room_id: string }
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
      set_resource_pinned: {
        Args: { _pinned: boolean; _resource_id: string }
        Returns: Json
      }
      set_resource_status: {
        Args: { _resource_id: string; _status: string }
        Returns: Json
      }
      set_room_capacity: {
        Args: { _max_members: number; _room_id: string }
        Returns: Json
      }
      set_room_media: {
        Args: {
          _expected_version?: number
          _media_id: string
          _provider: string
          _room_id: string
        }
        Returns: Json
      }
      set_shuffle_enabled: {
        Args: { _enabled: boolean; _room_id: string }
        Returns: Json
      }
      set_study_settings: {
        Args: {
          _focus_mode?: string
          _note_mode?: string
          _private_research?: boolean
          _resource_mode?: string
          _room_id: string
          _timer_mode?: string
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
      start_call_session: {
        Args: { _call_mode: string; _room_id: string }
        Returns: Json
      }
      start_local_media_session: {
        Args: {
          _duration_seconds?: number
          _item_count?: number
          _media_kind: string
          _mime_type?: string
          _room_id: string
        }
        Returns: Json
      }
      start_queue: {
        Args: { _expected_version?: number; _room_id: string }
        Returns: Json
      }
      start_room_from_playlist: {
        Args: { _playlist_id: string; _room_id: string }
        Returns: Json
      }
      study_precheck: {
        Args: {
          _action: string
          _limit: number
          _room_id: string
          _window_seconds: number
        }
        Returns: Json
      }
      study_session_summary: { Args: { _room_id: string }; Returns: Json }
      sweep_calls: { Args: never; Returns: undefined }
      sweep_local_media: { Args: never; Returns: undefined }
      toggle_message_reaction: {
        Args: { _message_id: string; _reaction: string }
        Returns: Json
      }
      transfer_room_host: {
        Args: { _room_id: string; _to_user: string }
        Returns: Json
      }
      update_playlist: {
        Args: {
          _description?: string
          _name?: string
          _playlist_id: string
          _room_id?: string
          _visibility?: string
        }
        Returns: Json
      }
      update_room_note: {
        Args: {
          _content?: string
          _expected_revision: number
          _note_id: string
          _title?: string
        }
        Returns: Json
      }
      update_room_resource: {
        Args: { _description?: string; _resource_id: string; _title?: string }
        Returns: Json
      }
      update_room_task: {
        Args: {
          _assigned_to?: string
          _clear_assignee?: boolean
          _status?: string
          _task_id: string
        }
        Returns: Json
      }
      upsert_media_metadata_cache: {
        Args: {
          _embeddable?: boolean
          _made_for_kids?: boolean
          _media_id: string
          _privacy_status?: string
          _provider: string
          _source?: string
          _status?: string
          _thumbnail_url?: string
          _title?: string
          _ttl_hours?: number
        }
        Returns: string
      }
      verified_media_snapshot: { Args: { _media_id: string }; Returns: Json }
      verify_call_grant: {
        Args: { _session_id: string; _token: string }
        Returns: string
      }
      verify_local_media_grant: {
        Args: { _session_id: string; _token: string }
        Returns: string
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "deactivated" | "deleted"
      app_role: "user" | "moderator" | "admin"
      call_admission: "open_to_room" | "host_approval"
      call_connection_state:
        | "connecting"
        | "connected"
        | "reconnecting"
        | "failed"
      call_mode: "voice" | "video"
      call_session_status: "starting" | "active" | "ended" | "expired"
      chat_retention: "persistent" | "room_expiry" | "24h" | "7d"
      deletion_status:
        | "requested"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
      entitlement_source:
        | "system"
        | "grant"
        | "promo"
        | "billing"
        | "admin_grant"
        | "play_billing"
      entitlement_status:
        | "active"
        | "expired"
        | "revoked"
        | "pending"
        | "grace_period"
        | "paused"
      focus_timer_phase: "focus" | "short_break" | "long_break" | "custom"
      focus_timer_status: "idle" | "running" | "paused" | "completed"
      local_media_kind: "image" | "video" | "audio"
      local_media_session_status: "active" | "ended" | "expired"
      local_media_transport_state: "direct" | "relay" | "unavailable"
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
      playback_provider: "youtube"
      playback_status: "idle" | "ready" | "playing" | "paused" | "ended"
      playlist_visibility: "private" | "shared_with_room"
      queue_item_status:
        | "suggested"
        | "queued"
        | "playing"
        | "played"
        | "removed"
        | "rejected"
      report_status: "open" | "reviewing" | "actioned" | "dismissed"
      report_target: "user" | "room" | "message" | "other"
      research_focus_mode: "host_sync" | "free_navigation"
      research_permission_mode: "host_only" | "collaborative" | "host_approval"
      resource_kind: "web_link" | "youtube" | "document_reference" | "note"
      resource_status: "pending" | "active" | "archived" | "rejected"
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
      room_queue_mode: "host_only" | "collaborative" | "host_approval"
      room_repeat_mode: "off" | "repeat_one" | "repeat_queue"
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
      study_task_status: "todo" | "in_progress" | "completed"
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
      call_admission: ["open_to_room", "host_approval"],
      call_connection_state: [
        "connecting",
        "connected",
        "reconnecting",
        "failed",
      ],
      call_mode: ["voice", "video"],
      call_session_status: ["starting", "active", "ended", "expired"],
      chat_retention: ["persistent", "room_expiry", "24h", "7d"],
      deletion_status: [
        "requested",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
      entitlement_source: [
        "system",
        "grant",
        "promo",
        "billing",
        "admin_grant",
        "play_billing",
      ],
      entitlement_status: [
        "active",
        "expired",
        "revoked",
        "pending",
        "grace_period",
        "paused",
      ],
      focus_timer_phase: ["focus", "short_break", "long_break", "custom"],
      focus_timer_status: ["idle", "running", "paused", "completed"],
      local_media_kind: ["image", "video", "audio"],
      local_media_session_status: ["active", "ended", "expired"],
      local_media_transport_state: ["direct", "relay", "unavailable"],
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
      playback_provider: ["youtube"],
      playback_status: ["idle", "ready", "playing", "paused", "ended"],
      playlist_visibility: ["private", "shared_with_room"],
      queue_item_status: [
        "suggested",
        "queued",
        "playing",
        "played",
        "removed",
        "rejected",
      ],
      report_status: ["open", "reviewing", "actioned", "dismissed"],
      report_target: ["user", "room", "message", "other"],
      research_focus_mode: ["host_sync", "free_navigation"],
      research_permission_mode: ["host_only", "collaborative", "host_approval"],
      resource_kind: ["web_link", "youtube", "document_reference", "note"],
      resource_status: ["pending", "active", "archived", "rejected"],
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
      room_queue_mode: ["host_only", "collaborative", "host_approval"],
      room_repeat_mode: ["off", "repeat_one", "repeat_queue"],
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
      study_task_status: ["todo", "in_progress", "completed"],
      subscription_tier: ["free", "pro", "pro_plus"],
      visibility_level: ["public", "members", "contacts", "private"],
    },
  },
} as const
