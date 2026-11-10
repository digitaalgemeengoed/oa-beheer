-- Classificatie: het classificatiemodel inzien en beheren, en (apart) afwijken
-- van de bewaartermijnen uit de selectielijst.
SET search_path = beheer, public;

ALTER TABLE groepen DROP CONSTRAINT IF EXISTS groepen_rechten_check;
ALTER TABLE groepen ADD CONSTRAINT groepen_rechten_check
  CHECK (rechten <@ ARRAY['accounts.view', 'accounts.manage', 'groups.view', 'groups.manage', 'audit.view', 'settings.view', 'settings.manage', 'metadata.view', 'metadata.manage', 'anonimiseren.view', 'classificatie.view', 'classificatie.manage', 'bewaartermijn.afwijken']::text[]);
