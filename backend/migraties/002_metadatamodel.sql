-- Metadatamodel: de rechten om het in te zien en te beheren, en het concept
-- dat een beheerder aan het opstellen is. Het gepubliceerde model staat in het
-- platform (als versie van het objecttype); hier alleen het werk in uitvoering.
SET search_path = beheer, public;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'beheer.groepen'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%accounts.view%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE beheer.groepen DROP CONSTRAINT %I', c); END IF;
END $$;

ALTER TABLE groepen ADD CONSTRAINT groepen_rechten_check
  CHECK (rechten <@ ARRAY['accounts.view', 'accounts.manage', 'groups.view', 'groups.manage', 'audit.view', 'settings.view', 'settings.manage', 'metadata.view', 'metadata.manage']::text[]);

CREATE TABLE metadatamodel_concept (
  objecttype     text PRIMARY KEY CHECK (objecttype ~ '^[a-z][a-z0-9-]{1,60}$'),
  config         jsonb NOT NULL,
  gewijzigd      timestamptz NOT NULL DEFAULT now(),
  gewijzigd_door uuid REFERENCES accounts (id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON metadatamodel_concept TO oa_beheer_app;
