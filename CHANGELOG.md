# Wijzigingen

## 0.5.1 — 2026-11-10

Metadatamodel: bij de Woo-informatiecategorie het vinkje **Ook "geen categorie (niet actief openbaar)" aanbieden**, met uitleg. Het overzicht van wijzigingen noemt het; een waarschuwing als de categorie verplicht is zonder deze keuze.

## 0.5.0 — 2026-11-10

**Classificatie.** Een nieuwe pagina voor het classificatiemodel:
- naam;
- de Selectielijst 2020 per procestype, met resultaten aan of uit en zoeken op nummer of woord;
- afwijkingen van de bewaartermijn, alleen met een reden en het recht `bewaartermijn.afwijken`;
- eigen attributen (tekst, keuzelijst, ja of nee);
- vergrendelen bij status (ten minste één) en de status waarop de termijn ingaat;
- controleren, publiceren met reden (in de audit), en de versies.

Rechten `classificatie.view`, `classificatie.manage` en `bewaartermijn.afwijken` (migratie 004).

## 0.4.0 — 2026-11-10

**Metadatamodel: een eigen naam.** Bij stap 1 geef je het model een naam, zoals "RGBZ Haarlem". Die staat bovenaan het paneel Metadateren en in de eigenschappen van elk bestand, met het versienummer. Een andere naam is ook een nieuwe versie; het overzicht van wijzigingen noemt hem. De versietabel en "Nu in gebruik" tonen de naam, het voorbeeld van het paneel ook. De audit van een publicatie noemt de naam.

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
