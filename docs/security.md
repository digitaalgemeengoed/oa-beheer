# Beveiliging van het beheerportaal

Het fundament van het beheerportaal van de Office Assistent: mensen, toegang, beveiliging en audit. Het ontwerp volgt OWASP ASVS niveau 2 en de OWASP Top 10, en blijft eenvoudig genoeg voor één beheerder zonder systeembeheerervaring.

Adres: `oa-admin.<domein>`, achter Caddy (TLS). Stack: Node 22, Fastify, `pg` met alleen geparametriseerde SQL (geen ORM), PostgreSQL 16, React met NL Design System, Argon2id. Eén image met backend en frontend.

## Afwijkingen van de oorspronkelijke opdracht

| Opdracht | Gebouwd | Waarom |
|---|---|---|
| Python, FastAPI, Vue | TypeScript, Fastify, React met NL Design System | Eén stack met de rest van de Office Assistent (OA-ADR-001); minder onderhoud voor Open WebConcept. |
| Eigen wachtwoorden, uitnodigingslink om een wachtwoord te kiezen, code per e-mail één keer per dag per apparaat, wachtwoordherstel per e-mail | Inloggen via Keycloak (OIDC) met tweede factor in Keycloak; het portaal vraagt bij elke aanmelding opnieuw wachtwoord en code (`prompt=login`); de uitnodiging is een e-mail met het adres | De mensen van de gemeente staan al in Keycloak (OA-ADR-004: identiteit uit Keycloak, rechten in het portaal). Eén plek voor wachtwoorden en tweede factor. Strenger dan één code per dag. |
| Pogingen beperkt per e-mail en per adres | Voor het noodaccount per netwerkadres; voor gewone accounts doet Keycloak dat (brute-force-detectie in de realm) | Het portaal ziet geen wachtwoorden meer. |
| `admin.haarlem.dev` | `oa-admin.<domein>` (`oa-admin.haarlem.dev`) | Op verzoek. |
| Op een eigen server | Op VPS 1, naast de integratielaag, met een eigen database | Op verzoek; de database is niet van buiten bereikbaar. |

Wat het portaal **niet** van Keycloak overneemt: groepen, rechten, niveau en status. Die staan alleen in het portaal, worden bij elke aanvraag gelezen, en een account dat hier geblokkeerd is, komt er niet in, ook al werkt het in Keycloak.

## Mensen en toegang

- Een account maakt een beheerder aan (e-mailadres, naam, taal, groepen, reden). Aanmelden op eigen initiatief bestaat niet. Bij de eerste aanmelding via Keycloak met een **geverifieerd** e-mailadres wordt de Keycloak-gebruiker (`sub`) aan het account gekoppeld; daarna telt alleen die koppeling.
- **Groepen** dragen rechten (`accounts.view`, `accounts.manage`, `groups.view`, `groups.manage`, `audit.view`, `settings.view`, `settings.manage`) en een niveau van 1 tot 4. Rechten tellen op; het niveau is het hoogste van de groepen. Een groep kan **superadmin** zijn.
- **Rechten en status** komen bij elke aanvraag vers uit de database: een wijziging werkt meteen.
- **Regels** (`backend/src/regels.ts`, met tests):
  - niemand wijzigt zijn eigen groepen of status, of het hoofdaccount;
  - een superadmin beheert iedereen behalve zichzelf en het hoofdaccount;
  - anderen beheren alleen accounts met een lager niveau dan hun eigen, en geven alleen groepen onder hun niveau, zonder superadmin;
  - een recht over accounts, groepen of de audit geeft alleen door wie het zelf heeft;
  - een groep wijzigen of verwijderen kan alleen wie er niet zelf in zit en alle leden mag beheren (anders is een groep een omweg).
- **Status**: actief, geblokkeerd, gedeactiveerd. Elke wijziging heeft een reden en kan later ingaan. Geplande wijzigingen worden uitgevoerd vóór elke toegangscontrole en elke 30 seconden. Blokkeren of deactiveren beëindigt alle sessies. Accounts worden nooit verwijderd (trigger), zodat de audit leesbaar blijft.
- **Dashboard** naar niveau en rechten; **profiel** met naam, taal, een link naar Keycloak voor wachtwoord en tweede factor, en de eigen apparaten met afmelden per apparaat.

## Inloggen

- Authorization code flow met **PKCE**, **nonce** en `state`; `prompt=login` en `max_age=0`, zodat Keycloak altijd opnieuw om wachtwoord en code vraagt. Het id_token wordt getoetst op handtekening (JWKS), uitgever, doelgroep, leeftijd (5 minuten) en nonce. Tokens worden niet bewaard.
- De aanmelding is aan de browser gebonden met een kortlevend cookie `__Host-oa_beheer_inlog` (Strict). Keycloak (`id.<domein>`) is dezelfde site als het portaal, dus dat cookie komt bij de terugkeer mee. State, verifier en nonce staan als HMAC-sleutel in de database, tien minuten geldig, één keer bruikbaar.
- **Tweede factor**: met `mfa.vereist` (standaard aan) moet het token in `amr` een tweede factor melden (`otp`, `mfa`, `hwk`, `swk` of `webauthn`). Daarvoor heeft de Keycloak-client de AMR-mapper nodig, en de OTP-stap een referentiewaarde `otp` (zie `server/keycloak-beheer.sh` in `oa-uitrol`). **Nog niet getest tegen een echte Keycloak.** Meldt Keycloak geen `amr`, dan komt niemand via Keycloak binnen; zet de instelling dan via het noodaccount uit tot de configuratie klopt.
- Elke mislukte aanmelding geeft de gebruiker dezelfde melding; de reden staat alleen in de audit. Een onbekend e-mailadres verraadt dus niets.
- **Sessies**: willekeurige tokens van 32 bytes; in de database alleen de HMAC-SHA-256 (sleutel afgeleid van `ADMIN_SECRET`). Cookie `__Host-oa_beheer`: `HttpOnly`, `Secure`, `SameSite=Strict`, pad `/`.
- **Einde van een sessie**: na `sessie.inactief_minuten` (standaard 30) zonder activiteit; om middernacht in de tijdzone van `sessie.dag_tijdzone` (ook rond zomer- en wintertijd); bij uitloggen; bij blokkeren of deactiveren; per apparaat vanuit het profiel; voor iedereen door een beheerder ("overal uitloggen").

## Het hoofdaccount (noodtoegang)

- Bestaat altijd en werkt altijd. Triggers in de database weigeren verwijderen, een andere status, een ander e-mailadres, een Keycloak-koppeling, groepen en statuswijzigingen; er kan maar één hoofdaccount zijn. Dat geldt ook voor de eigenaar van de database.
- Eigen, niet gelinkte pagina `/emergency`. Werkt niet via Keycloak en heeft geen e-mail nodig (e-mail kan juist de reden zijn). Vraagt een wachtwoord, een TOTP-code en een reden van minstens tien tekens.
- Wachtwoord: gegenereerd, 32 tekens (192 bits), opgeslagen als Argon2id (19 MiB, 2 rondes). TOTP-geheim: AES-256-GCM, sleutel afgeleid van `ADMIN_SECRET`. Elke TOTP-code werkt één keer. Beide kunnen **alleen** op de opdrachtregel van de server worden gezet: `node backend/dist/cli.js nood-instellen` (als eigenaar van de database; de app-rol mag het niet).
- Ook zonder ingesteld wachtwoord kost een poging even lang (Argon2 tegen een nep-hash).
- Pogingen tellen **alleen per netwerkadres**, zodat niemand het account op slot kan raden. Optioneel een lijst met toegestane adressen of CIDR-blokken (`nood.toegestane_adressen`).
- Elk gebruik gaat in de audit, met reden, en per e-mail naar de superadmins, in hun taal. De sessie eindigt na 30 minuten, ook bij activiteit. Bovenaan elke pagina staat een rode balk met het eindtijdstip.

## Audit

- Elke aanmelding, wijziging en aanvraag van een ingelogde persoon wordt vastgelegd, ook wat iemand alleen bekeek: wie, wat, wanneer, netwerkadres, resultaat. Dat gebeurt **voordat** het antwoord vertrekt; mislukt het vastleggen, dan is er geen antwoord. Wachtwoorden, codes, tokens en cookies komen er niet in (velden met zulke namen worden eruit gefilterd).
- **Hashketen**: elke gebeurtenis bevat de hash van de vorige; de database berekent de hash (SHA-256 over de vorige hash en een vaste tekstvorm van de rij), met één schrijver tegelijk. Triggers weigeren UPDATE, DELETE en TRUNCATE; de app-rol heeft ook geen recht daarop.
- **Controle**: `audit_controleer()` (pagina Audit → Keten controleren) geeft de eerste gebroken schakel.
- **Bewaartermijn**: `audit.bewaartermijn_dagen` (standaard 365). Dagelijks na 06:00 verwijdert `audit_opruimen()` alleen het oudste deel, vanaf het begin, en bewaart de hash van de laatst verwijderde gebeurtenis als **anker**; de keten blijft vanaf daar controleerbaar. De audit bevat persoonsgegevens (e-mail, netwerkadres); leg de termijn vast in het register van verwerkingen.
- **Dagelijkse hash per e-mail** naar `audit.dagelijkse_hash_aan`, met de uitkomst van de controle.
- **Grens**: wie volledige macht over de database heeft (eigenaar of superuser), kan de triggers uitschakelen en de hele keten opnieuw berekenen. De controle ziet dat dan niet. Alleen een hash die buiten de database is bewaard, zoals de dagelijkse e-mail, toont dat de keten is herschreven. Bewaar die e-mails buiten de server.

## Webbeveiliging

- Op elk antwoord: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, plus `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` en `Permissions-Policy`. Op de API ook `Cache-Control: no-store`. Caddy voegt HSTS toe.
- De frontend heeft geen inline scripts of stijlen. De vinkjes van NL Design System (een `data:`-afbeelding) worden als eigen bestand geleverd, zodat de CSP niet versoepeld hoeft te worden.
- Aanvragen voor een andere hostnaam: `421`.
- Elke wijzigende aanvraag (niet GET of HEAD) moet de eigen `Origin` en `Content-Type: application/json` hebben. Dat houdt aanvragen van andere sites tegen zonder CSRF-tokens; samen met `SameSite=Strict`.
- Aanvragen zijn hoogstens 64 KB. Alle invoer wordt op de server getoetst met JSON Schema; onbekende velden worden geweigerd. Fouten zijn algemeen, zonder stacktraces. Het verzoeklog bevat geen querystrings (daar staan de codes van Keycloak in), en cookies en Authorization worden gemaskeerd.
- **Geheimen** komen uit de omgeving. Het portaal start niet met een ontbrekend, te kort (`ADMIN_SECRET` minstens 32 tekens) of voorbeeldgeheim. Geen geheim komt in een log, een URL of de browser.
- Netwerkadressen: Caddy staat ervoor. Alleen adressen uit private netwerken gelden als proxy voor `X-Forwarded-For`.
- De container draait als gewone gebruiker. De database wordt niet gepubliceerd: alleen het portaal bereikt hem, binnen het compose-netwerk.
- **E-mail** via SMTP, met platte tekst en html, in de taal van de ontvanger. Zonder SMTP-instellingen worden berichten niet verstuurd; het log noemt dan alleen het onderwerp.

## Database

- Een eigen database `oa_beheer`, schema `beheer`. Migraties draaien als eigenaar. De app verbindt als `oa_beheer_app`, met alleen de rechten die nodig zijn: geen DELETE op accounts en audit, geen schrijfrecht op het noodgeheim, alleen bepaalde kolommen van instellingen.
- Moet het portaal later gegevens uit een ander systeem lezen (bijvoorbeeld opendop-mini), dan alleen via `SECURITY DEFINER`-functies in een apart schema, toegekend aan een rol die verder niets kan.

## Instellingen

Type, bereik en standaard staan in de migratie. Wijzigen kan alleen met `settings.manage` en een reden; de oude en de nieuwe waarde gaan in de audit. Elke instantie leest instellingen opnieuw binnen 30 seconden.

| Instelling | Standaard | Bereik |
|---|---|---|
| `sessie.inactief_minuten` | 30 | 5–120 |
| `sessie.dag_tijdzone` | Europe/Amsterdam | geldige tijdzone |
| `pogingen.maximum` | 5 | 3–20 |
| `pogingen.venster_minuten` | 15 | 5–1440 |
| `nood.toegestane_adressen` | leeg (overal) | adressen of CIDR |
| `mfa.vereist` | ja | ja/nee |
| `audit.bewaartermijn_dagen` | 365 | 30–3650 |
| `audit.dagelijkse_hash_aan` | leeg | e-mailadressen |

## Testen

`npm test` in `backend/`: 36 tests tegen een echte PostgreSQL en een nagebootste Keycloak (configuratie, koppen, host, herkomst, omvang, foutmeldingen, triggers, hashketen en anker, inloggen met PKCE en nonce, tweede factor, inactiviteit, middernacht, geplande blokkade, noodaccount met TOTP, hergebruik, pogingen en adreslijst, beheerregels, groepen, profiel, audit en instellingen). De frontend is getest in Chromium met de strikte CSP, ook op telefoonbreedte.

**Nog niet getest:** tegen een echte Keycloak (vooral de `amr`-claim) en een echte SMTP-server, en de container zelf op de server.

## Nog te doen

- Back-channel logout van Keycloak, zodat uitloggen of blokkeren in Keycloak ook de sessies hier beëindigt (nu begrensd door inactiviteit en middernacht).
- Sessies in het geheugen van één proces zijn hier niet nodig (ze staan in de database), maar meer instanties vragen om een gedeelde planner.
- De beheerpagina's voor de Office Assistent zelf (objecttypen, delegaties per gemeente, OA-ADR-004), bovenop dit fundament.
