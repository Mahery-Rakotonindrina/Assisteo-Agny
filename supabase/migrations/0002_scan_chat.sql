-- Follow-up conversation about a scan, synced with the rest of the entry.
-- [{ "role": "user" | "assistant", "content": "...", "at": <epoch ms> }, ...]
alter table public.analyses add column if not exists chat jsonb not null default '[]'::jsonb;
