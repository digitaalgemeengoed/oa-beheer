# Wijzigingen

## 0.2.0 — 2026-11-09

**Metadatamodel.** Een nieuwe pagina waar informatiebeheer instelt welke metadata medewerkers invullen:

- Basismodel kiezen: MDTO, RGBZ of TMLO, met uitleg. TOOI levert de waardelijsten.
- Per veld: aan of uit, verplicht, label, hulptekst, waardelijst, volgorde. Bij elk veld het element in het model, de betekenis voor de assistent en of het model het verplicht noemt.
- Eigen velden (tekst, lange tekst, datum, keuzelijst, getal), met eigen keuzes.
- Doorlopend getoetst door het platform: fouten (geen titel, twee velden met dezelfde betekenis …) en waarschuwingen (een veld dat het model verplicht noemt, geen Woo-categorie).
- Voorbeeld van het paneel, en in gewone taal wat er verandert ten opzichte van de versie in gebruik. Wat je opstelt blijft als concept bewaard.
- Publiceren met reden: een nieuwe versie van het objecttype in het platform, in de audit. Overzicht van de versies; een oudere als begin nemen.
- Rechten `metadata.view` en `metadata.manage` (migratie 002). Instellingen `PLATFORM_URL`, `PLATFORM_DIENSTSLEUTEL` en `GEMEENTE`; zonder staat de pagina uit.
