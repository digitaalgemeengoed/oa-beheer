# Uitrol van het beheerportaal

In de Office Assistent draait het portaal op VPS 1, naast de integratielaag; de uitrol staat in [`oa-uitrol`](https://github.com/digitaalgemeengoed/oa-uitrol) (`vps1-toegang.yml`, `server/beheer.sh`, `server/keycloak-beheer.sh`, INRICHTING.md). Deze map is een zelfstandig voorbeeld.

| Bestand | Wat |
|---|---|
| `compose.voorbeeld.yml` | database (niet gepubliceerd), migratie, portaal (alleen-lezen, zonder rechten, gewone gebruiker), Caddy |
| `Caddyfile.fragment` | het blok `oa-admin.{$DOMEIN}` |
| `.env.voorbeeld` | de instellingen; vul nieuwe geheimen in |

## Volgorde

1. DNS: `oa-admin.<domein>` naar de server.
2. `docker compose -f compose.voorbeeld.yml up -d --build`. De migratie maakt de tabellen, de app-rol en het hoofdaccount `beheerder@<domein>`.
3. Het noodaccount instellen; het wachtwoord en het TOTP-geheim verschijnen één keer:
   `docker compose -f compose.voorbeeld.yml run --rm beheer-migreer node backend/dist/cli.js nood-instellen`
4. Inloggen op `https://oa-admin.<domein>/emergency`. Maak een groep met superadmin en een account voor jezelf (het e-mailadres van je Keycloak-gebruiker, geverifieerd).
5. In Keycloak een vertrouwelijke client `oa-beheer`: redirect `https://oa-admin.<domein>/api/auth/terug`, na uitloggen `https://oa-admin.<domein>/`, de AMR-mapper, en op de OTP-stap de referentiewaarde `otp`. Zet `BEHEER_OIDC_ISSUER` en `BEHEER_OIDC_SECRET` en start opnieuw.
6. Optioneel SMTP voor de e-mails (uitnodiging, noodgebruik, dagelijkse hash).

Zonder Keycloak-instellingen werkt alleen `/emergency`; zonder SMTP gaat er geen e-mail uit.

## Back-up

`docker compose exec beheer-db pg_dump -U oa_beheer_eigenaar oa_beheer > beheer-$(date -I).sql`. De audit zit erin; met `ADMIN_SECRET` erbij is ook het TOTP-geheim van het noodaccount te ontsleutelen, dus bewaar die twee niet op dezelfde plek.
