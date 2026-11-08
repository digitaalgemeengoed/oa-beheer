-- oa-beheer, migratie 001: mensen, toegang, sessies, audit en instellingen.
--
-- Uitgevoerd door de eigenaar van de database. De app zelf verbindt als
-- oa_beheer_app en mag alleen wat hieronder staat: geen DELETE op accounts of
-- audit, geen wijziging van het hoofdaccount. Die regels gelden ook als de app
-- een fout heeft: de triggers staan in de database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS beheer;
SET search_path = beheer, public;

-- ---------------------------------------------------------------------------
-- Mensen en groepen
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email LIKE '%_@_%'),
  naam            text NOT NULL CHECK (length(naam) BETWEEN 1 AND 200),
  taal            text NOT NULL DEFAULT 'nl' CHECK (taal IN ('nl', 'en')),
  -- De gebruiker in Keycloak, vastgelegd bij de eerste aanmelding met dit e-mailadres.
  keycloak_sub    text UNIQUE,
  status          text NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'geblokkeerd', 'gedeactiveerd')),
  hoofdaccount    boolean NOT NULL DEFAULT false,
  aangemaakt      timestamptz NOT NULL DEFAULT now(),
  aangemaakt_door uuid REFERENCES accounts (id)
);
-- Er is precies één hoofdaccount.
CREATE UNIQUE INDEX een_hoofdaccount ON accounts (hoofdaccount) WHERE hoofdaccount;

CREATE TABLE groepen (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam         text NOT NULL UNIQUE CHECK (length(naam) BETWEEN 1 AND 100),
  omschrijving text NOT NULL DEFAULT '' CHECK (length(omschrijving) <= 1000),
  rechten      text[] NOT NULL DEFAULT '{}',
  niveau       smallint NOT NULL CHECK (niveau BETWEEN 1 AND 4),
  superadmin   boolean NOT NULL DEFAULT false,
  aangemaakt   timestamptz NOT NULL DEFAULT now(),
  CHECK (rechten <@ ARRAY['accounts.view', 'accounts.manage', 'groups.view', 'groups.manage', 'audit.view', 'settings.view', 'settings.manage']::text[])
);

CREATE TABLE lidmaatschappen (
  account uuid NOT NULL REFERENCES accounts (id),
  groep   uuid NOT NULL REFERENCES groepen (id) ON DELETE CASCADE,
  PRIMARY KEY (account, groep)
);

-- Een statuswijziging met reden, die op een later moment kan ingaan.
CREATE TABLE statuswijzigingen (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account     uuid NOT NULL REFERENCES accounts (id),
  status      text NOT NULL CHECK (status IN ('actief', 'geblokkeerd', 'gedeactiveerd')),
  reden       text NOT NULL CHECK (length(reden) BETWEEN 5 AND 1000),
  ingang      timestamptz NOT NULL,
  door        uuid NOT NULL REFERENCES accounts (id),
  aangemaakt  timestamptz NOT NULL DEFAULT now(),
  uitgevoerd  timestamptz
);
CREATE INDEX statuswijzigingen_open ON statuswijzigingen (ingang) WHERE uitgevoerd IS NULL;

-- ---------------------------------------------------------------------------
-- Sessies en inloggen
-- ---------------------------------------------------------------------------

-- Alleen de HMAC van het token staat hier, nooit het token zelf.
CREATE TABLE sessies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account         uuid NOT NULL REFERENCES accounts (id),
  token_hash      bytea NOT NULL UNIQUE,
  apparaat        text NOT NULL CHECK (length(apparaat) <= 200),
  ip              text NOT NULL,
  aangemaakt      timestamptz NOT NULL DEFAULT now(),
  laatst_actief   timestamptz NOT NULL DEFAULT now(),
  -- Voor de noodsessie: einde na 30 minuten, ongeacht activiteit.
  hard_einde      timestamptz NOT NULL,
  nood            boolean NOT NULL DEFAULT false,
  beeindigd       timestamptz,
  reden_einde     text
);
CREATE INDEX sessies_account ON sessies (account) WHERE beeindigd IS NULL;

-- Lopende aanmeldingen bij Keycloak (state, PKCE, nonce); kort geldig.
CREATE TABLE inlogstaat (
  state_hash bytea PRIMARY KEY,
  verifier   text NOT NULL,
  nonce      text NOT NULL,
  terug      text NOT NULL,
  verloopt   timestamptz NOT NULL
);

-- Mislukte pogingen, als HMAC van e-mail of netwerkadres; na een dag weg.
CREATE TABLE pogingen (
  soort   text NOT NULL,
  sleutel bytea NOT NULL,
  tijd    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pogingen_zoek ON pogingen (soort, sleutel, tijd);

-- Het noodaccount: wachtwoord (Argon2id) en TOTP-geheim (AES-GCM). Alleen
-- de eigenaar schrijft hier, via de opdrachtregel op de server.
CREATE TABLE nood (
  account          uuid PRIMARY KEY REFERENCES accounts (id),
  wachtwoord_hash  text,
  totp_versleuteld bytea,
  totp_laatste     bigint,
  bijgewerkt       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Instellingen: type, bereik en standaard staan hier, niet in de code.
-- ---------------------------------------------------------------------------

CREATE TABLE instellingen (
  sleutel        text PRIMARY KEY,
  type           text NOT NULL CHECK (type IN ('geheel', 'boolean', 'tekst', 'lijst', 'tijdzone')),
  waarde         jsonb NOT NULL,
  standaard      jsonb NOT NULL,
  minimum        numeric,
  maximum        numeric,
  omschrijving   jsonb NOT NULL,
  gewijzigd      timestamptz,
  gewijzigd_door uuid REFERENCES accounts (id)
);

INSERT INTO instellingen (sleutel, type, waarde, standaard, minimum, maximum, omschrijving) VALUES
  ('sessie.inactief_minuten', 'geheel', '30', '30', 5, 120,
   '{"nl": "Na zoveel minuten zonder activiteit moet je opnieuw inloggen.", "en": "Minutes without activity before you must sign in again."}'),
  ('sessie.dag_tijdzone', 'tijdzone', '"Europe/Amsterdam"', '"Europe/Amsterdam"', NULL, NULL,
   '{"nl": "Een sessie eindigt om middernacht in deze tijdzone.", "en": "A session ends at midnight in this time zone."}'),
  ('pogingen.maximum', 'geheel', '5', '5', 3, 20,
   '{"nl": "Aantal mislukte pogingen per e-mailadres of netwerkadres binnen het venster.", "en": "Failed attempts allowed per email or network address within the window."}'),
  ('pogingen.venster_minuten', 'geheel', '15', '15', 5, 1440,
   '{"nl": "Venster voor het tellen van mislukte pogingen, in minuten.", "en": "Window for counting failed attempts, in minutes."}'),
  ('nood.toegestane_adressen', 'lijst', '[]', '[]', NULL, NULL,
   '{"nl": "Netwerkadressen (of CIDR-blokken) van waar het noodaccount mag inloggen. Leeg = overal.", "en": "Network addresses (or CIDR blocks) from which the master account may sign in. Empty = anywhere."}'),
  ('mfa.vereist', 'boolean', 'true', 'true', NULL, NULL,
   '{"nl": "Inloggen via Keycloak vereist tweestapsverificatie (OTP).", "en": "Signing in through Keycloak requires two-factor authentication (OTP)."}'),
  ('audit.bewaartermijn_dagen', 'geheel', '365', '365', 30, 3650,
   '{"nl": "Hoe lang auditgebeurtenissen bewaard blijven, in dagen. Ze bevatten persoonsgegevens.", "en": "How long audit events are kept, in days. They contain personal data."}'),
  ('audit.dagelijkse_hash_aan', 'lijst', '[]', '[]', NULL, NULL,
   '{"nl": "E-mailadressen die elke dag de laatste hash van de auditketen krijgen.", "en": "Email addresses that receive the latest audit chain hash every day."}');

-- ---------------------------------------------------------------------------
-- Audit: een hashketen die alleen kan groeien
-- ---------------------------------------------------------------------------

CREATE TABLE audit (
  id          bigint PRIMARY KEY,
  tijd        timestamptz NOT NULL,
  account     uuid,
  email       text,
  actie       text NOT NULL CHECK (length(actie) <= 100),
  doel        text CHECK (length(doel) <= 300),
  ip          text,
  resultaat   text NOT NULL CHECK (length(resultaat) <= 50),
  details     jsonb NOT NULL DEFAULT '{}',
  vorige_hash bytea NOT NULL,
  hash        bytea NOT NULL
);
CREATE SEQUENCE audit_id;
CREATE INDEX audit_tijd ON audit (tijd);
CREATE INDEX audit_account ON audit (account, tijd);

-- Na opruimen (bewaartermijn): de hash van de laatst verwijderde gebeurtenis,
-- zodat de keten vanaf daar te controleren blijft.
CREATE TABLE audit_anker (
  id       smallint PRIMARY KEY CHECK (id = 1),
  laatste  bigint NOT NULL,
  hash     bytea NOT NULL,
  tijd     timestamptz NOT NULL
);

-- De vaste tekst waarover de hash gaat.
CREATE FUNCTION audit_tekst(a audit) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', a.id::text,
    to_char(a.tijd AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(a.account::text, ''), coalesce(a.email, ''), a.actie, coalesce(a.doel, ''),
    coalesce(a.ip, ''), a.resultaat, a.details::text)
$$;

CREATE FUNCTION audit_keten() RETURNS trigger LANGUAGE plpgsql SET search_path = beheer, public AS $$
DECLARE
  vorige bytea;
BEGIN
  -- Eén schrijver tegelijk: de keten blijft een rij.
  PERFORM pg_advisory_xact_lock(7240001);
  SELECT hash INTO vorige FROM beheer.audit ORDER BY id DESC LIMIT 1;
  IF vorige IS NULL THEN
    SELECT hash INTO vorige FROM beheer.audit_anker WHERE id = 1;
  END IF;
  NEW.id := nextval('beheer.audit_id');
  NEW.tijd := clock_timestamp();
  NEW.vorige_hash := coalesce(vorige, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  NEW.hash := digest(NEW.vorige_hash || convert_to(beheer.audit_tekst(NEW), 'UTF8'), 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_keten BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION audit_keten();

CREATE FUNCTION audit_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('beheer.opruimen', true) = 'aan' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'De auditketen kan niet worden gewijzigd of verwijderd' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_geen_update BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION audit_onveranderlijk();
CREATE TRIGGER audit_geen_truncate BEFORE TRUNCATE ON audit EXECUTE FUNCTION audit_onveranderlijk();

-- Controle van de keten; geeft de eerste gebroken schakel, of NULL.
CREATE FUNCTION audit_controleer() RETURNS TABLE (gebroken_bij bigint, gecontroleerd bigint, laatste_hash text)
LANGUAGE plpgsql STABLE SET search_path = beheer, public AS $$
DECLARE
  r beheer.audit;
  vorige bytea;
  n bigint := 0;
BEGIN
  SELECT hash INTO vorige FROM beheer.audit_anker WHERE id = 1;
  vorige := coalesce(vorige, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  FOR r IN SELECT * FROM beheer.audit ORDER BY id LOOP
    n := n + 1;
    IF r.vorige_hash <> vorige OR r.hash <> digest(r.vorige_hash || convert_to(beheer.audit_tekst(r), 'UTF8'), 'sha256') THEN
      RETURN QUERY SELECT r.id, n, encode(vorige, 'hex');
      RETURN;
    END IF;
    vorige := r.hash;
  END LOOP;
  RETURN QUERY SELECT NULL::bigint, n, encode(vorige, 'hex');
END $$;

-- Opruimen na de bewaartermijn. Draait als eigenaar (SECURITY DEFINER); de
-- app heeft zelf geen DELETE op audit. Verwijdert alleen van het begin af.
CREATE FUNCTION audit_opruimen(dagen integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = beheer, public AS $$
DECLARE
  grens timestamptz;
  laatste beheer.audit;
  n bigint;
BEGIN
  IF dagen < 30 THEN RAISE EXCEPTION 'Bewaartermijn te kort'; END IF;
  grens := now() - make_interval(days => dagen);
  SELECT * INTO laatste FROM beheer.audit WHERE tijd < grens ORDER BY id DESC LIMIT 1;
  IF laatste.id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(7240001);
  INSERT INTO beheer.audit_anker (id, laatste, hash, tijd) VALUES (1, laatste.id, laatste.hash, now())
    ON CONFLICT (id) DO UPDATE SET laatste = EXCLUDED.laatste, hash = EXCLUDED.hash, tijd = EXCLUDED.tijd;
  PERFORM set_config('beheer.opruimen', 'aan', true);
  DELETE FROM beheer.audit WHERE id <= laatste.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('beheer.opruimen', 'uit', true);
  INSERT INTO beheer.audit (actie, resultaat, details)
    VALUES ('audit.opgeruimd', 'ok', jsonb_build_object('verwijderd', n, 'tot_en_met', laatste.id, 'bewaartermijn_dagen', dagen));
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Het hoofdaccount: bestaat altijd en werkt altijd
-- ---------------------------------------------------------------------------

CREATE FUNCTION accounts_bewaken() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Accounts worden nooit verwijderd' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.hoofdaccount AND (NOT NEW.hoofdaccount OR NEW.status <> 'actief' OR NEW.email <> OLD.email OR NEW.keycloak_sub IS DISTINCT FROM OLD.keycloak_sub) THEN
    RAISE EXCEPTION 'Het hoofdaccount kan niet worden gewijzigd' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.hoofdaccount AND NOT OLD.hoofdaccount THEN
    RAISE EXCEPTION 'Een account wordt geen hoofdaccount' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_bewaken BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_bewaken();

CREATE FUNCTION niet_voor_hoofdaccount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM beheer.accounts WHERE id = NEW.account AND hoofdaccount) THEN
    RAISE EXCEPTION 'Het hoofdaccount heeft geen groepen en geen statuswijzigingen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lidmaatschap_niet_hoofd BEFORE INSERT OR UPDATE ON lidmaatschappen FOR EACH ROW EXECUTE FUNCTION niet_voor_hoofdaccount();
CREATE TRIGGER status_niet_hoofd BEFORE INSERT OR UPDATE ON statuswijzigingen FOR EACH ROW EXECUTE FUNCTION niet_voor_hoofdaccount();

-- ---------------------------------------------------------------------------
-- De rol van de app: alleen wat nodig is
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oa_beheer_app') THEN
    CREATE ROLE oa_beheer_app LOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA beheer TO oa_beheer_app;
GRANT SELECT ON ALL TABLES IN SCHEMA beheer TO oa_beheer_app;
GRANT INSERT, UPDATE ON accounts, groepen, statuswijzigingen, sessies TO oa_beheer_app;
GRANT INSERT, DELETE ON lidmaatschappen, inlogstaat, pogingen TO oa_beheer_app;
GRANT DELETE ON groepen TO oa_beheer_app;
GRANT UPDATE (waarde, gewijzigd, gewijzigd_door) ON instellingen TO oa_beheer_app;
GRANT UPDATE (totp_laatste) ON nood TO oa_beheer_app;
GRANT INSERT ON audit TO oa_beheer_app;
GRANT USAGE ON SEQUENCE audit_id TO oa_beheer_app;
GRANT EXECUTE ON FUNCTION audit_controleer(), audit_opruimen(integer) TO oa_beheer_app;
REVOKE ALL ON FUNCTION audit_opruimen(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_opruimen(integer) TO oa_beheer_app;
