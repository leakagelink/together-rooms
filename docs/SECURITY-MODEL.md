# SyncTogether — Chat Security & Data Privacy Model (Phase 3.1)

## Table grant matrix

Verified with `aclexplode(pg_class.relacl)`.

| Table                        | anon | authenticated                                           | staff (authenticated + role)           | service_role |
| ---------------------------- | ---- | ------------------------------------------------------- | -------------------------------------- | ------------ |
| `room_messages`              | none | SELECT (RLS: joined member / host)                      | same as authenticated                  | ALL          |
| `message_reactions`          | none | SELECT (RLS: joined member / host)                      | same as authenticated                  | ALL          |
| `user_reports`               | none | SELECT own, INSERT own (RLS `reporter_id = auth.uid()`) | SELECT all via `is_staff()`            | ALL          |
| `message_moderation_archive` | none | none (RLS enabled, zero policies)                       | only via `staff_get_removed_message()` | ALL          |

INSERT / UPDATE / DELETE on `room_messages` and `message_reactions` are granted to
**no** end-user role. All writes are owned by SECURITY DEFINER RPCs:

| Operation                  | Owning RPC                                           |
| -------------------------- | ---------------------------------------------------- |
| send message               | `send_room_message`                                  |
| edit message               | `edit_room_message` (15-minute window)               |
| delete / moderate message  | `delete_room_message`                                |
| react / replace / un-react | `toggle_message_reaction`                            |
| mute member                | `set_member_mute`                                    |
| report message             | `report_message`                                     |
| read removed plaintext     | `staff_get_removed_message` (staff only, audited)    |
| retention purge            | `purge_expired_chat` (pg_cron only, no user EXECUTE) |

## Guard trigger model

`guard_room_messages`, `guard_message_reactions` and `guard_room_members` allow a
write only when execution is trusted:

```
app.<ctx> = '1'   -- set with set_config(..., is_local => true) inside the owning RPC
OR current_user IN ('postgres','supabase_admin','service_role')
```

`auth.uid() IS NULL` is **no longer** a bypass. An anonymous PostgREST caller runs as
`anon` (no grants, no ctx flag) and a signed-in caller runs as `authenticated`
(no write grants, no ctx flag) — both are rejected with SQLSTATE 42501.

## Removed-message privacy

`room_messages.original_content` has been dropped. Removed text is copied into
`message_moderation_archive` before the row is blanked (`content = ''`). The archive is
not in the `supabase_realtime` publication, so `REPLICA IDENTITY FULL` payloads for
`room_messages` cannot carry it either.

## Blocking semantics (authoritative)

Blocking **does**:

- prevent the blocked user from being admitted to a room you are in (`admit_member`)
- prevent you being admitted to a room they are in
- hide username/avatar from each other in the room member directory
- prevent private/profile-level reach outside shared rooms

Blocking **does not**:

- remove either party from a room they already share
- retract or hide chat history in that shared room

UI copy states this explicitly. To end an existing shared-room conversation the user
must leave the room or a moderator must remove the other party.

## Moderation workflow

Implemented (data plane): report status lifecycle (`open/reviewing/actioned/dismissed`),
staff-only report reads, `set_report_status`, `create_moderation_action`,
`staff_get_removed_message` with audit logging, in-room mute and message removal by
room hosts/moderators, reporter identity never exposed to the reported user.

**NOT IMPLEMENTED:** a staff review UI. Report triage currently requires backend access.

## Retention

`pg_cron` job `synctogether-purge-expired-chat` runs `SELECT public.purge_expired_chat();`
hourly at minute 7. `purge_expired_chat` has no EXECUTE grant for `anon` or
`authenticated`, so it cannot be user-invoked.

---

# Phase 3.2 — Moderation operations, roles & realtime revocation

## Role model

Roles live only in `public.user_roles` (`app_role`: `user`, `moderator`, `admin`).
They are never stored on `profiles`, and no end-user role holds INSERT/UPDATE/DELETE
on `user_roles` — every change goes through `assign_app_role` / `revoke_app_role`,
which require `has_role(auth.uid(),'admin')`.

| Table                | anon | authenticated                  | service_role |
| -------------------- | ---- | ------------------------------ | ------------ |
| `user_roles`         | none | SELECT (RLS: own rows / staff) | ALL          |
| `audit_logs`         | none | SELECT (RLS: staff)            | ALL          |
| `moderation_actions` | none | SELECT (RLS: staff)            | ALL          |

`bootstrap_first_admin(_email)` is operator-only: EXECUTE is revoked from
`PUBLIC`, `anon` and `authenticated`, and the function aborts if any admin
already exists. It is the only path that creates the first admin.

Guard rails on role changes: an admin cannot revoke their own admin role, and the
last remaining admin cannot be revoked.

## Staff surface

| Capability                           | RPC                                                                            | Required role                         |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| staff flags for UI                   | `my_staff_context`                                                             | any signed-in user (returns booleans) |
| queue with filters + pagination      | `staff_report_queue`                                                           | staff                                 |
| report detail, actions, audit        | `staff_report_detail`                                                          | staff                                 |
| counters + recent actions            | `staff_moderation_overview`                                                    | staff                                 |
| status transitions + note            | `set_report_status`                                                            | staff                                 |
| record a moderation action           | `create_moderation_action`                                                     | staff                                 |
| reveal removed plaintext             | `staff_get_removed_message`                                                    | staff, audited                        |
| list / search / grant / revoke roles | `admin_list_roles`, `admin_search_users`, `assign_app_role`, `revoke_app_role` | admin                                 |

`/admin`, `/admin/reports/$reportId` and `/admin/roles` render behind
`StaffGate`, which is **presentation only**. Authorization is re-checked in
Postgres by every RPC above, so calling the endpoints directly as a normal user
returns `forbidden` (covered by MOD-T3 … MOD-T15).

Privacy invariants preserved by the console:

- the reporter's identity is never returned to the reported user, and is not
  rendered in the review screen;
- removed-message plaintext is never included in queue or detail payloads — it
  is fetched only through the audited reveal RPC and held in component state,
  never in the query cache;
- every status change, action and reveal writes an `audit_logs` row attributed
  to the acting staff member.

## Realtime membership revocation

Verified by `scripts/security/realtime-revocation.test.ts` (REV-T1 … REV-T5)
against a socket that stays connected across the revocation:

- REV-T1 — a joined member receives `postgres_changes` rows for the room.
- REV-T2 — membership is revoked server-side; the socket is not torn down.
- REV-T3/T4 — inserts, updates and reactions produced _after_ revocation are
  **not** delivered to the removed subscriber. Supabase Realtime re-evaluates
  RLS per change against current database state, so revocation takes effect on
  the existing connection without any transport-level invalidation.
- REV-T5 — the removed member cannot re-authorize a new subscription
  (`authorize_room_channel` returns false) and REST reads return zero rows.

Conclusion: RLS is the revocation boundary for realtime as well as REST. No
socket-kill mechanism is required, and none is relied upon.
