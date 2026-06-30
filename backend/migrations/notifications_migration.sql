-- Web Push: device subscriptions + per-event dedup flags + per-user prefs.
create table if not exists push_subscriptions (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Dedup: stamped when an important-event push is sent.
alter table events add column if not exists notified_at timestamptz;
-- Dedup: set true when the 24h deadline reminder is sent.
alter table events add column if not exists deadline_reminded boolean not null default false;

-- Per-user notification toggles: master + 3 per-type.
alter table profiles add column if not exists notification_prefs jsonb
    default '{"master": true, "important": true, "reminders": true, "digest": true}'::jsonb;
