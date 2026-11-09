# Wijzigingen

## 0.3.0 — 2026-11-09

**Anonimiseren → Kwaliteit.** Een nieuwe pagina met een tab Kwaliteit: hoe goed de assistent persoonsgegevens herkent, uit wat medewerkers doen bij het anonimiseren in het document.

- Periode (30, 90 of 365 dagen); bevestigingen gemeten, precisie, gevonden (een bovengrens voor de recall), zelf toegevoegd. Met uitleg ("Hoe lees je dit?").
- Per soort: voorgesteld, bevestigd, gelaten (met reden), zelf toegevoegd, precisie en gevonden.
- Zekerheid van de herkenning: terecht en onterecht per zekerheidsband, te filteren per soort; helpt bij het kiezen van een drempel.
- Vormen die medewerkers zelf toevoegden (gemist) of lieten staan (te veel), met een regexp om te kopiëren, signaalwoorden en lengte. Zeldzame vormen (minder dan 5 bevestigingen) blijven verborgen.
- Gewijzigde grondslag en een vergelijking per versie van de herkenner.
- Recht `anonimiseren.view` (migratie 003).

## 0.2.0 — 2026-11-09

**Metadatamodel.** Een nieuwe pagina waar informatiebeheer instelt welke metadata medewerkers invullen:

- Basismodel kiezen: MDTO, RGBZ of TMLO, met uitleg. TOOI levert de waardelijsten.
- Per veld: aan of uit, verplicht, label, hulptekst, waardelijst, volgorde. Bij elk veld het element in het model, de betekenis voor de assistent en of het model het verplicht noemt.
- Eigen velden (tekst, lange tekst, datum, keuzelijst, getal), met eigen keuzes.
- Doorlopend getoetst door het platform: fouten (geen titel, twee velden met dezelfde betekenis …) en waarschuwingen (een veld dat het model verplicht noemt, geen Woo-categorie).
- Voorbeeld van het paneel, en in gewone taal wat er verandert ten opzichte van de versie in gebruik. Wat je opstelt blijft als concept bewaard.
- Publiceren met reden: een nieuwe versie van het objecttype in het platform, in de audit. Overzicht van de versies; een oudere als begin nemen.
- Rechten `metadata.view` en `metadata.manage` (migratie 002). Instellingen `PLATFORM_URL`, `PLATFORM_DIENSTSLEUTEL` en `GEMEENTE`; zonder staat de pagina uit.
