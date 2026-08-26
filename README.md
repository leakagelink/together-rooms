# Sync Together

# SYNCTOGETHER — PHASE 1

## Production Foundation, Architecture, Security & Compliance Framework

We are building a production-grade application called:

SYNC TOGETHER

Tagline:

"Watch. Listen. Study. Connect. Together."

Product vision:

SyncTogether is a private, user-controlled real-time room platform where couples, friends, families, students and other users can create rooms and experience supported content and activities together.

The long-term product will support:

- Watch Together

- Listen Together

- Study Together

- Research Together

- AI Room Assistant

- Voice & Video Rooms

- Co-browsing

- Shared Workspace

- Advanced Chat

- Private/Incognito Rooms

- Family-oriented rooms

- Couple-oriented rooms

- Games Together

- Translation

- Scheduled Rooms

- One-tap invitations

- Public and private rooms

- AI room summaries

- User profiles

- Smart notifications

- AdMob monetization

- Google Play subscriptions

IMPORTANT:

This is PHASE 1 ONLY.

Do NOT attempt to implement every future feature in this phase.

Do NOT use fake APIs, fake authentication, fake payments, fake AI responses, fake realtime behavior or placeholder production logic.

Do NOT claim that a feature is complete if it is only mocked.

The goal of Phase 1 is to create a clean, scalable, secure production foundation so later phases can be built without major architectural rewrites.

==================================================

1. PRODUCT PRINCIPLES

==================================================

Build SyncTogether around these principles:

1. Privacy-first

2. User-controlled data

3. Temporary/private sessions where applicable

4. No permanent hosting of user media by default

5. Secure-by-default architecture

6. Least-privilege permissions

7. Clear user consent

8. Strong UGC moderation architecture

9. Copyright-conscious content architecture

10. Google Play policy-conscious implementation

11. AdMob policy-conscious future architecture

12. Scalable realtime room architecture

13. Mobile-first responsive UI

14. Accessibility

15. Performance

16. Observability

17. Maintainability

18. Clear separation between frontend, backend and third-party providers

Do not build anything that is intended to bypass DRM, copyright restrictions, platform restrictions, content protection or third-party service terms.

==================================================

2. TECHNICAL ARCHITECTURE

==================================================

Use a production-appropriate architecture.

Preferred stack if compatible with the existing Lovable project:

Frontend:

- React

- TypeScript

- Vite

- Tailwind CSS

- Component-based architecture

Backend/data:

- Supabase

- PostgreSQL

- Supabase Auth

- Supabase Realtime

- Supabase Storage only where actually required

Use Row Level Security (RLS) everywhere appropriate.

Do not expose service-role keys or privileged secrets in frontend code.

Use environment variables for all secrets.

Create a provider abstraction strategy so future integrations do not tightly couple the core application to one provider.

Future providers may include:

- YouTube

- Search provider

- AI provider

- Voice/video provider

- Music provider

- Analytics

- Payments

- Ads

Do not integrate these providers yet unless required for the Phase 1 foundation.

==================================================

3. DATABASE FOUNDATION

==================================================

Design a normalized PostgreSQL schema that can support future features.

At minimum design the architecture for:

users

profiles

rooms

room_members

room_roles

room_permissions

room_invites

room_sessions

room_events

user_blocks

user_reports

moderation_actions

notifications

device_sessions

privacy_settings

user_settings

audit_logs

Future-compatible entities should be planned without prematurely implementing unnecessary functionality.

Each table must have:

- UUID primary keys where appropriate

- created_at

- updated_at where appropriate

- appropriate foreign keys

- indexes

- constraints

- safe deletion behavior

- ownership rules

Do NOT create insecure public tables.

==================================================

4. ROOM ENGINE FOUNDATION

==================================================

The core product is a room engine.

Design the room architecture so that future room types can support:

- Couple

- Friends

- Family

- Study

- Research

- Music

- Watch

- Game

- Private

A room must support:

- owner/host

- members

- roles

- permissions

- room status

- privacy mode

- invite-only mode

- temporary/ephemeral mode

- future content synchronization

- future realtime events

Do not implement actual video/music synchronization yet.

Create the architecture for a future event system such as:

ROOM_CREATED

ROOM_UPDATED

USER_JOINED

USER_LEFT

HOST_CHANGED

PLAY

PAUSE

SEEK

CONTENT_CHANGED

CHAT_MESSAGE

REACTION

SCREEN_SHARE_STARTED

SCREEN_SHARE_STOPPED

ROOM_ENDED

But only implement the events actually needed in Phase 1.

==================================================

5. AUTHENTICATION

==================================================

Implement production-ready authentication foundation.

Support:

- email/password if appropriate

- secure session handling

- logout

- password recovery

- email verification if supported

- protected routes

Do not store passwords manually.

Use Supabase Auth.

Design the system so Google/Apple sign-in can be added later without rewriting user identity architecture.

==================================================

6. USER PROFILE

==================================================

Create the foundation for:

- username

- display name

- avatar

- bio

- account status

- privacy settings

Do not collect unnecessary personal data.

Do not request contacts, location, microphone, camera, photos or files in Phase 1 unless absolutely necessary.

Follow least-privilege principles.

==================================================

7. PRIVACY ARCHITECTURE

==================================================

Design privacy settings for:

- profile visibility

- room visibility

- invite permissions

- messaging permissions

- activity visibility

- notification preferences

- data retention preferences where applicable

Create a clear privacy architecture.

Do not claim "zero data collection".

The system should only collect data necessary for the stated functionality.

Prepare the architecture for:

- data deletion

- account deletion

- user data export where applicable

- retention controls

- consent management

==================================================

8. PRIVATE / EPHEMERAL ROOM FOUNDATION

==================================================

Create the architecture for private and temporary rooms.

Private room:

- invite-only

- not publicly discoverable

Ephemeral room:

- designed for temporary sessions

- no permanent media hosting by default

- temporary room/session data can expire according to defined retention rules

IMPORTANT:

Do not claim that encryption automatically makes copyrighted material legal.

Do not build any copyright circumvention mechanism.

Future personal media sharing must be:

- user initiated

- user controlled

- temporary by default

- encrypted in transit

- no permanent media hosting by default

- permission controlled

==================================================

9. SECURITY

==================================================

Implement security best practices.

Requirements:

- HTTPS-only assumptions

- secure authentication

- RLS

- authorization checks

- input validation

- output encoding where appropriate

- rate limiting architecture

- abuse prevention architecture

- secure error handling

- no secret keys in frontend

- no sensitive data in logs

- safe database policies

- protection against unauthorized room access

- protection against ID enumeration

- secure invite tokens

- token expiration where appropriate

- audit logging for sensitive actions

Do not expose internal database errors to users.

==================================================

10. UGC / MODERATION FOUNDATION

==================================================

Because future versions will contain:

- chat

- profiles

- public rooms

- comments

- shared links

- media

- voice/video

- research content

prepare the moderation architecture now.

Create support for:

- report user

- report room

- report message

- block user

- mute user

- moderator role

- host moderation

- ban/kick architecture

- abuse reporting

- moderation status

- moderation audit logs

Do not build an unsafe public social feed.

Public discovery should remain disabled in Phase 1.

==================================================

11. COPYRIGHT / CONTENT PROVIDER ARCHITECTURE

==================================================

The product must NOT:

- host pirated movies

- provide unauthorized movie downloads

- bypass DRM

- scrape protected media

- re-stream copyrighted content without authorization

- advertise itself as a way to watch pirated movies

- bypass YouTube or other provider restrictions

Future integrations must use official APIs, SDKs, players or other authorized mechanisms where required.

Create a provider abstraction such as:

ContentProvider

PlaybackProvider

SearchProvider

MusicProvider

AIProvider

Do not implement unauthorized provider behavior.

==================================================

12. ANALYTICS / OBSERVABILITY

==================================================

Prepare analytics architecture.

Track only data necessary for product operation and analytics.

Future events may include:

app_opened

signup_completed

room_created

room_joined

room_left

invite_created

invite_accepted

feature_used

subscription_started

subscription_cancelled

Do not collect unnecessary sensitive content.

Do not log:

- passwords

- auth tokens

- private room content

- private messages

- private media

- sensitive personal information

unless explicitly required and properly protected.

==================================================

13. ERROR / LOADING / EMPTY STATES

==================================================

Every production screen must have:

- loading state

- empty state

- error state

- retry state

- offline/connection state where applicable

Do not leave broken blank screens.

==================================================

14. UI FOUNDATION

==================================================

Create a modern premium UI for SyncTogether.

Brand:

SyncTogether

Tagline:

Watch. Listen. Study. Connect. Together.

Design direction:

- modern

- clean

- social

- premium

- privacy-focused

- mobile-first

- accessible

- fast

Do not overuse gradients or unnecessary animations.

Create reusable components.

Prepare dark/light theme architecture if practical.

==================================================

15. ACCESSIBILITY

==================================================

Prepare for:

- readable contrast

- scalable text

- screen reader labels

- keyboard navigation where applicable

- accessible buttons

- clear focus states

- touch-friendly controls

==================================================

16. SEO FOUNDATION

==================================================

Even though the main product is an app, prepare the web presence for SEO.

Create architecture for future pages targeting legitimate search intent such as:

- watch together

- watch videos together

- study together online

- listen together

- online study rooms

- private watch rooms

- research together

- virtual movie night

- watch YouTube together

Do NOT keyword stuff.

Do NOT create doorway pages.

Prepare:

- semantic HTML

- title/meta architecture

- canonical URL architecture

- Open Graph

- Twitter/X metadata

- sitemap architecture

- robots.txt architecture

- structured data architecture where appropriate

- clean URLs

Do not create hundreds of thin SEO pages.

==================================================

17. ASO FOUNDATION

==================================================

Prepare future Play Store listing strategy around:

Brand:

SyncTogether

Possible positioning:

Watch. Listen. Study. Connect. Together.

Do not keyword stuff the app name.

Future ASO should target legitimate user intent around:

- watch together

- study together

- listen together

- private rooms

- watch videos with friends

Do not claim functionality that is not actually implemented.

==================================================

18. GOOGLE PLAY POLICY READINESS

==================================================

Design the application so that future release preparation can include:

- Privacy Policy

- Terms of Service

- Community Guidelines

- UGC reporting

- blocking

- moderation

- account deletion

- data deletion

- Data Safety disclosure

- Ads declaration

- target audience declaration

- app access instructions

- permissions disclosure

- content rating

- subscription disclosures

Do not fabricate compliance.

Compliance must be verified against current Google Play policies before release.

==================================================

19. ADMOB READINESS

==================================================

Do NOT integrate production AdMob ads in Phase 1.

Prepare the architecture for future AdMob integration.

Future ads must:

- use official Google Mobile Ads SDK

- be clearly distinguishable from app content

- not encourage clicks

- not create accidental clicks

- not interfere with core controls

- not appear deceptively

- use appropriate ad formats

- use test ads during development

- respect applicable consent/privacy requirements

Do not place ads inside active synchronized media controls.

Do not place ads where users could accidentally click while attempting:

- play

- pause

- seek

- close

- join

- leave

- chat

==================================================

20. SUBSCRIPTION READINESS

==================================================

Do NOT implement real subscriptions in Phase 1.

Prepare architecture for:

Free

Pro

Pro+

Future digital subscriptions on Google Play must use Google Play Billing where required.

Subscription UI must eventually clearly communicate:

- price

- billing period

- auto-renewal

- benefits

- cancellation

- applicable terms

Do not create deceptive subscription flows.

==================================================

21. PERMISSIONS STRATEGY

==================================================

Use permissions only when the user invokes the feature that requires them.

Future permissions may include:

- microphone

- camera

- notifications

- photos/media

- screen capture

Do not request all permissions on first launch.

Use contextual permission requests.

Provide alternatives when practical.

==================================================

22. PERFORMANCE

==================================================

Design for scalability.

Avoid:

- unnecessary realtime listeners

- excessive database queries

- N+1 queries

- unnecessary polling

- large initial bundles

- storing large media unnecessarily

- sending media through the core API

Future realtime synchronization should transmit lightweight state/events rather than video/audio streams whenever possible.

==================================================

23. DOCUMENTATION

==================================================

Create/update project documentation containing:

- architecture

- database schema

- security model

- authentication model

- room model

- environment variables

- setup instructions

- deployment instructions

- known limitations

- future integration points

- policy-sensitive areas

- technical decisions

- assumptions

==================================================

24. PHASE 1 UI

==================================================

Build only the foundation screens required to validate the architecture:

- Landing/home

- Sign up

- Login

- Forgot password

- Profile

- Settings

- Privacy settings

- Create room shell

- Join room shell

- Room shell

- Report/block UI foundation

- Terms placeholder route

- Privacy Policy placeholder route

Do not create fake working functionality.

Clearly label unfinished future functionality internally if necessary.

==================================================

25. CRITICAL REQUIREMENT — PHASE REPORT

==================================================

At the end of Phase 1, DO NOT simply say "Phase 1 completed."

Generate a detailed TECHNICAL + POLICY + PRODUCT IMPLEMENTATION REPORT for me.

The report MUST contain:

A. Executive summary

B. Exact features implemented

C. Exact features NOT implemented

D. Exact files/components/pages created or modified

E. Database tables created/modified

F. Database relationships

G. RLS policies created

H. Authentication implementation

I. Authorization implementation

J. Security controls implemented

K. Permissions requested or NOT requested

L. API integrations used

M. Environment variables required

   - Do NOT reveal secret values

   - List only variable names

N. Dependencies/packages added

O. Routes/pages created

P. Realtime architecture implemented

Q. Error handling implemented

R. Analytics implemented

S. SEO work completed

T. ASO preparation completed

U. Google Play policy considerations addressed

V. AdMob readiness work completed

W. Subscription/Billing readiness completed

X. Privacy/data handling architecture

Y. UGC/moderation architecture

Z. Copyright/content-provider safeguards

AA. Performance considerations

AB. Known bugs

AC. Known limitations

AD. Security concerns still remaining

AE. Policy risks still remaining

AF. Technical debt

AG. Recommended next phase

AH. Exact items that must be verified in Phase 2

AI. A list of every assumption you made

AJ. A list of anything you were unable to implement

AK. A list of anything you implemented differently from this specification and WHY

AL. A complete "Next Prompt Input" section summarizing the current project state in a copy-paste-friendly format.

IMPORTANT:

Do not hide missing work.

Do not mark mock functionality as production-ready.

Do not claim Play Store or AdMob approval.

Do not claim legal compliance as guaranteed.

Be completely transparent.

At the end write:

"PHASE 1 REPORT COMPLETE — READY FOR AUDIT"

Do not proceed automatically to Phase 2.

Wait for my audit and next instructions.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://together-rooms.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/03887689-961a-4c3f-93c0-0943ce977760).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
