-- A bound on the synced settings (user_settings.data, 0001_accounts_sync.sql).
-- The app writes this row itself (RLS), so only the database can refuse a row
-- that keeps growing. The settings hold the language, the theme and "Ma santé"
-- (emergency card, appointments, relatives, vaccines, home pharmacy): a real
-- account stays far below, 400 vaccines with full notes are about 250 kB. Over
-- the bound, the write is refused and the device keeps its settings.
-- "not valid": a row already above it stays as it is, only its next write is
-- checked. Dropped then added again, so the file can run twice.
alter table public.user_settings drop constraint if exists user_settings_data_size;
alter table public.user_settings add constraint user_settings_data_size check (octet_length(data::text) <= 1000000) not valid;
