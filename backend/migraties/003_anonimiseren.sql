-- Anonimiseren: het recht om de kwaliteit te bekijken (tabblad Kwaliteit).
SET search_path = beheer, public;

ALTER TABLE groepen DROP CONSTRAINT IF EXISTS groepen_rechten_check;
ALTER TABLE groepen ADD CONSTRAINT groepen_rechten_check
  CHECK (rechten <@ ARRAY['accounts.view', 'accounts.manage', 'groups.view', 'groups.manage', 'audit.view', 'settings.view', 'settings.manage', 'metadata.view', 'metadata.manage', 'anonimiseren.view']::text[]);
