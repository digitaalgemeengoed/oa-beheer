import { useEffect, useState } from "react";
import {
  Alert, Heading1, Heading2, Paragraph, Select, SelectOption, FormField, FormLabel, SubtleButton,
  Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow,
} from "@utrecht/component-library-react";
import { api, type Ik } from "../api";
import { taal } from "../i18n";
import { foutTekst, MeldingVak } from "./gedeeld";

// ---------------------------------------------------------------------------
// Wat het platform teruggeeft (opendop-mini, kwaliteit.ts)
// ---------------------------------------------------------------------------

interface Telling {
  soort?: string;
  voorgesteld: number;
  bevestigd: number;
  keuze: number;
  gelaten: { "geen-persoonsgegeven": number; "mag-openbaar": number; "verkeerde-soort": number; zonder: number };
  toegevoegd: number;
  grondslagGewijzigd: number;
  juist: number;
  onterecht: number;
  precisie: number | null;
  gevonden: number | null;
  scores: { juist: number[]; onterecht: number[] };
}
interface Vorm { soort: string; klasse: "gemist" | "onterecht"; vorm: string; regex: string; aantal: number; metingen: number; signaalwoorden: { woord: string; aantal: number }[]; lengtes: Record<string, number> }
interface Kwaliteit {
  dagen: number;
  drempel: number;
  metingen: number;
  gegevens: number;
  totaal: Telling;
  perSoort: (Telling & { soort: string })[];
  perMotor: { motor: string; metingen: number; precisie: number | null; gevonden: number | null }[];
  vormen: Vorm[];
  verborgen: number;
  grondslag: { van: string; naar: string; aantal: number }[];
  scorebanden: string[];
}

const T = {
  titel: ["Anonimiseren", "Anonymisation"],
  kwaliteit: ["Kwaliteit", "Quality"],
  intro: [
    "Hoe goed de assistent persoonsgegevens herkent, uit wat medewerkers doen bij het anonimiseren in het document: wat ze bevestigen, laten staan (met reden) en zelf toevoegen. Er worden geen waarden bewaard, alleen tellingen, de vorm van een gegeven (\"06-51209934\" wordt \"9-9\") en signaalwoorden zoals \"telefoon\". Metingen zijn niet te herleiden tot een stuk.",
    "How well the assistant recognises personal data, from what employees do when anonymising in the document: what they confirm, leave (with a reason) and add themselves. No values are stored, only counts, the shape of an item (\"06-51209934\" becomes \"9-9\") and signal words such as \"telefoon\". Measurements cannot be traced to a document.",
  ],
  periode: ["Periode", "Period"],
  dagen: ["dagen", "days"],
  geenMetingen: ["Nog geen metingen in deze periode. Metingen ontstaan bij Bevestigen in het paneel Anonimiseren.", "No measurements in this period yet. Measurements are made on Confirm in the Anonymisation panel."],
  metingen: ["bevestigingen gemeten", "confirmations measured"],
  gegevens: ["persoonsgegevens", "items of personal data"],
  precisie: ["Precisie", "Precision"],
  precisieUitleg: ["Van wat de assistent voorstelde: hoeveel terecht.", "Of what the assistant proposed: how much was right."],
  gevonden: ["Gevonden (hoogstens)", "Found (at most)"],
  gevondenUitleg: ["Van alle gegevens die medewerkers afschermden: hoeveel de assistent zelf vond. Een bovengrens voor de recall: wat ook de medewerker mist, ziet niemand.", "Of all items employees protected: how many the assistant found itself. An upper bound for recall: what the employee also misses, nobody sees."],
  toegevoegd: ["Zelf toegevoegd", "Added by employees"],
  toegevoegdUitleg: ["Gemist door de assistent", "Missed by the assistant"],
  perSoort: ["Per soort", "By type"],
  soort: ["Soort", "Type"],
  voorgesteld: ["Voorgesteld", "Proposed"],
  bevestigd: ["Bevestigd", "Confirmed"],
  gelaten: ["Gelaten", "Left"],
  geenPg: ["geen persoonsgegeven", "not personal data"],
  magOpenbaar: ["mag openbaar", "may be public"],
  verkeerdeSoort: ["verkeerde soort", "wrong type"],
  zonder: ["zonder reden", "no reason"],
  keuze: ["Keuze", "Choice"],
  keuzeUitleg: ["Soorten die standaard uit staan (zoals data) en die de medewerker toch afschermde: een keuze, geen vondst. Telt niet mee in precisie en gevonden.", "Types that are off by default (such as dates) that the employee protected anyway: a choice, not a find. Not counted in precision or found."],
  scores: ["Zekerheid van de herkenning", "Recognition confidence"],
  scoresUitleg: ["Hoe vaak een voorstel terecht en onterecht was, per zekerheid. Ligt veel onterecht onder een bepaalde zekerheid, dan kan de drempel daar omhoog.", "How often a proposal was right and wrong, by confidence. If much of what was wrong lies below some confidence, the threshold can go up there."],
  terecht: ["terecht", "right"],
  onterecht: ["onterecht", "wrong"],
  alle: ["Alle soorten", "All types"],
  vormenGemist: ["Gemist: vormen die medewerkers zelf toevoegden", "Missed: shapes employees added themselves"],
  vormenGemistUitleg: ["Een vorm die vaak terugkomt, met een duidelijk patroon (zoals bij telefoon of zaaknummer), is een kandidaat voor een nieuw patroon in de analyzer. Bij namen helpt de vorm weinig; daar zeggen de signaalwoorden meer.", "A shape that recurs with a clear pattern (as for phone numbers or case numbers) is a candidate for a new pattern in the analyser. For names the shape helps little; the signal words say more."],
  vormenTeVeel: ["Te veel: vormen die medewerkers lieten staan (geen persoonsgegeven)", "Too much: shapes employees left (not personal data)"],
  vorm: ["Vorm", "Shape"],
  regex: ["Regexp (begin voor een patroon)", "Regexp (starting point for a pattern)"],
  aantal: ["Aantal", "Count"],
  inMetingen: ["In bevestigingen", "In confirmations"],
  signaal: ["Signaalwoorden", "Signal words"],
  lengte: ["Lengte", "Length"],
  kopieer: ["Kopieer", "Copy"],
  gekopieerd: ["Gekopieerd", "Copied"],
  verborgen: ["vormen kwamen in minder dan", "shapes occurred in fewer than"],
  verborgen1: ["vorm kwam in minder dan", "shape occurred in fewer than"],
  verborgen2: ["bevestigingen voor en worden niet getoond: een zeldzame vorm kan naar één persoon wijzen.", "confirmations and are not shown: a rare shape could point to one person."],
  geenVormen: ["Nog geen vormen die vaak genoeg voorkomen.", "No shapes that occur often enough yet."],
  grondslag: ["Gewijzigde grondslag", "Changed legal basis"],
  grondslagUitleg: ["De medewerker gaf een ander AVG-artikel dan de assistent voorstelde: de soort klopte, de categorie niet.", "The employee chose a different GDPR article than the assistant proposed: the type was right, the category was not."],
  perMotor: ["Per versie van de herkenner", "By recogniser version"],
  motor: ["Herkenner", "Recogniser"],
  hoeLees: ["Hoe lees je dit?", "How to read this"],
  hoeLeesTekst: [
    "Terecht: bevestigd, of gelaten omdat het openbaar mag of van een andere soort is (de herkenning klopte). Onterecht: gelaten als \"geen persoonsgegeven\" of zonder reden. Gemist: wat de medewerker zelf toevoegde. De precisie is betrouwbaar; \"gevonden\" is een bovengrens, want wat de medewerker ook mist, telt niemand. Voor de werkelijke recall is een steekproef nodig.",
    "Right: confirmed, or left because it may be public or is of another type (recognition was right). Wrong: left as \"not personal data\" or without a reason. Missed: what the employee added. Precision is reliable; \"found\" is an upper bound, since what the employee also misses is counted by nobody. Real recall needs a sample check.",
  ],
} as const;
const tt = (k: keyof typeof T): string => T[k][taal() === "en" ? 1 : 0];

const SOORTNAAM: Record<string, string> = {
  naam: "Namen", adres: "Adressen", plaats: "Plaatsen", organisatie: "Organisaties", datum: "Data", geboortedatum: "Geboortedata",
  bsn: "BSN", iban: "IBAN", bedrag: "Bedragen", telefoon: "Telefoonnummers", "e-mail": "E-mailadressen", kenteken: "Kentekens",
  zaaknummer: "Zaaknummers", identiteitsbewijs: "Documentnummers", rijbewijs: "Rijbewijsnummers", "kvk-nummer": "KvK-nummers",
  "btw-nummer": "Btw-nummers", "ip-adres": "IP-adressen", gezondheid: "Gezondheid", religie: "Religie of levensovertuiging",
  etniciteit: "Ras of etnische afkomst", biometrie: "Biometrische gegevens", strafrechtelijk: "Strafrechtelijke gegevens", overig: "Overig",
};
const soortNaam = (s: string) => (taal() === "en" ? s : SOORTNAAM[s] ?? s);
const CATEGORIE: Record<string, string> = { c1: "art. 6", c2: "art. 9", c3: "art. 10" };
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export function Anonimiseren({ ik }: { ik: Ik }) {
  void ik;
  return (
    <>
      <Heading1>{tt("titel")}</Heading1>
      <div className="an-tabs" role="tablist" aria-label={tt("titel")}>
        <button type="button" role="tab" aria-selected="true" className="an-tab actief" id="an-tab-kwaliteit" aria-controls="an-kwaliteit">
          {tt("kwaliteit")}
        </button>
      </div>
      <section id="an-kwaliteit" role="tabpanel" aria-labelledby="an-tab-kwaliteit">
        <KwaliteitTab />
      </section>
    </>
  );
}

function KwaliteitTab() {
  const [dagen, zetDagen] = useState(90);
  const [k, zetK] = useState<Kwaliteit | null>(null);
  const [fout, zetFout] = useState<string | null>(null);
  const [soort, zetSoort] = useState("");
  useEffect(() => {
    zetFout(null);
    api<Kwaliteit>("GET", `/api/anonimiseren/kwaliteit?dagen=${dagen}`).then(zetK, (e) => zetFout(foutTekst(e)));
  }, [dagen]);

  const t = k && (soort ? k.perSoort.find((s) => s.soort === soort) : k.totaal);
  return (
    <>
      <Paragraph className="ab-lead">{tt("intro")}</Paragraph>
      <div className="ab-filters an-filters">
        <FormField label={<FormLabel htmlFor="an-dagen">{tt("periode")}</FormLabel>}>
          <Select id="an-dagen" value={String(dagen)} onChange={(e) => zetDagen(Number(e.target.value))}>
            {[30, 90, 365].map((d) => <SelectOption key={d} value={String(d)}>{d} {tt("dagen")}</SelectOption>)}
          </Select>
        </FormField>
      </div>
      {fout && <MeldingVak m={{ soort: "fout", tekst: fout }} />}
      {k && k.metingen === 0 && <Alert type="info"><Paragraph>{tt("geenMetingen")}</Paragraph></Alert>}
      {k && k.metingen > 0 && (
        <>
          <div className="ab-kaarten an-kaarten">
            <div className="ab-kaart"><div className="ab-kaart-getal">{k.metingen}</div><div>{tt("metingen")}</div><div className="ab-klein">{k.gegevens} {tt("gegevens")}</div></div>
            <div className="ab-kaart"><div className="ab-kaart-getal">{pct(k.totaal.precisie)}</div><div>{tt("precisie")}</div><div className="ab-klein">{tt("precisieUitleg")}</div></div>
            <div className="ab-kaart"><div className="ab-kaart-getal">{pct(k.totaal.gevonden)}</div><div>{tt("gevonden")}</div><div className="ab-klein">{tt("gevondenUitleg")}</div></div>
            <div className="ab-kaart"><div className="ab-kaart-getal">{k.totaal.toegevoegd}</div><div>{tt("toegevoegd")}</div><div className="ab-klein">{tt("toegevoegdUitleg")}</div></div>
          </div>
          <details className="an-uitleg">
            <summary>{tt("hoeLees")}</summary>
            <Paragraph className="ab-klein">{tt("hoeLeesTekst")}</Paragraph>
          </details>

          <Heading2>{tt("perSoort")}</Heading2>
          <div className="ab-tabel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{tt("soort")}</TableHeaderCell>
                  <TableHeaderCell>{tt("voorgesteld")}</TableHeaderCell>
                  <TableHeaderCell>{tt("bevestigd")}</TableHeaderCell>
                  <TableHeaderCell>{tt("gelaten")}</TableHeaderCell>
                  <TableHeaderCell>{tt("toegevoegd")}</TableHeaderCell>
                  <TableHeaderCell>{tt("precisie")}</TableHeaderCell>
                  <TableHeaderCell>{tt("gevonden")}</TableHeaderCell>
                  <TableHeaderCell><abbr title={tt("keuzeUitleg")}>{tt("keuze")}</abbr></TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {k.perSoort.map((s) => (
                  <TableRow key={s.soort}>
                    <TableCell>{soortNaam(s.soort)}</TableCell>
                    <TableCell>{s.voorgesteld}</TableCell>
                    <TableCell>{s.bevestigd}</TableCell>
                    <TableCell><Gelaten g={s.gelaten} /></TableCell>
                    <TableCell>{s.toegevoegd}</TableCell>
                    <TableCell><Balk waarde={s.precisie} /></TableCell>
                    <TableCell><Balk waarde={s.gevonden} /></TableCell>
                    <TableCell>{s.keuze || ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Heading2>{tt("scores")}</Heading2>
          <Paragraph className="ab-klein">{tt("scoresUitleg")}</Paragraph>
          <FormField label={<FormLabel htmlFor="an-soort">{tt("soort")}</FormLabel>}>
            <Select id="an-soort" value={soort} onChange={(e) => zetSoort(e.target.value)}>
              <SelectOption value="">{tt("alle")}</SelectOption>
              {k.perSoort.filter((s) => s.voorgesteld > 0).map((s) => <SelectOption key={s.soort} value={s.soort}>{soortNaam(s.soort)}</SelectOption>)}
            </Select>
          </FormField>
          {t && <Scores juist={t.scores.juist} onterecht={t.scores.onterecht} banden={k.scorebanden} />}

          <Heading2>{tt("vormenGemist")}</Heading2>
          <Paragraph className="ab-klein">{tt("vormenGemistUitleg")}</Paragraph>
          <Vormen vormen={k.vormen.filter((v) => v.klasse === "gemist")} />
          <Heading2>{tt("vormenTeVeel")}</Heading2>
          <Vormen vormen={k.vormen.filter((v) => v.klasse === "onterecht")} />
          {k.verborgen > 0 && <Paragraph className="ab-klein">{k.verborgen} {tt(k.verborgen === 1 ? "verborgen1" : "verborgen")} {k.drempel} {tt("verborgen2")}</Paragraph>}

          {k.grondslag.length > 0 && (
            <>
              <Heading2>{tt("grondslag")}</Heading2>
              <Paragraph className="ab-klein">{tt("grondslagUitleg")}</Paragraph>
              <ul>{k.grondslag.map((g) => <li key={`${g.van}${g.naar}`}>{CATEGORIE[g.van]} → {CATEGORIE[g.naar]}: {g.aantal}×</li>)}</ul>
            </>
          )}

          <Heading2>{tt("perMotor")}</Heading2>
          <div className="ab-tabel">
            <Table>
              <TableHeader><TableRow><TableHeaderCell>{tt("motor")}</TableHeaderCell><TableHeaderCell>{tt("metingen")}</TableHeaderCell><TableHeaderCell>{tt("precisie")}</TableHeaderCell><TableHeaderCell>{tt("gevonden")}</TableHeaderCell></TableRow></TableHeader>
              <TableBody>
                {k.perMotor.map((m) => (
                  <TableRow key={m.motor}><TableCell>{m.motor}</TableCell><TableCell>{m.metingen}</TableCell><TableCell>{pct(m.precisie)}</TableCell><TableCell>{pct(m.gevonden)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}

function Gelaten({ g }: { g: Telling["gelaten"] }) {
  const delen: [number, string][] = [[g["geen-persoonsgegeven"], tt("geenPg")], [g["mag-openbaar"], tt("magOpenbaar")], [g["verkeerde-soort"], tt("verkeerdeSoort")], [g.zonder, tt("zonder")]];
  const totaal = delen.reduce((a, [n]) => a + n, 0);
  if (!totaal) return <>0</>;
  return (
    <span>
      {totaal}{" "}
      <span className="ab-klein">({delen.filter(([n]) => n > 0).map(([n, l]) => `${n} ${l}`).join(", ")})</span>
    </span>
  );
}

/** Een percentage met een balkje (SVG: geen inline stijlen nodig). */
function Balk({ waarde }: { waarde: number | null }) {
  if (waarde === null) return <>—</>;
  const kleur = waarde >= 0.9 ? "an-goed" : waarde >= 0.7 ? "an-matig" : "an-slecht";
  return (
    <span className="an-balk">
      <svg width="60" height="8" aria-hidden="true" className={kleur}>
        <rect width="60" height="8" className="an-balk-achter" rx="2" />
        <rect width={Math.round(60 * waarde)} height="8" className="an-balk-voor" rx="2" />
      </svg>
      {pct(waarde)}
    </span>
  );
}

function Scores({ juist, onterecht, banden }: { juist: number[]; onterecht: number[]; banden: string[] }) {
  const max = Math.max(1, ...juist, ...onterecht);
  const B = 520, H = 160, kol = B / banden.length, bw = kol / 2 - 6;
  return (
    <figure className="an-scores">
      <svg viewBox={`0 0 ${B} ${H + 24}`} role="img" aria-label={`${tt("scores")}: ${banden.map((b, i) => `${b}: ${juist[i]} ${tt("terecht")}, ${onterecht[i]} ${tt("onterecht")}`).join("; ")}`}>
        {banden.map((b, i) => {
          const hj = Math.round((juist[i]! / max) * (H - 16));
          const ho = Math.round((onterecht[i]! / max) * (H - 16));
          const x = i * kol + 4;
          return (
            <g key={b}>
              <rect x={x} y={H - hj} width={bw} height={hj} className="an-juist" />
              <rect x={x + bw + 2} y={H - ho} width={bw} height={ho} className="an-onterecht" />
              {juist[i]! > 0 && <text x={x + bw / 2} y={H - hj - 3} textAnchor="middle" className="an-getal">{juist[i]}</text>}
              {onterecht[i]! > 0 && <text x={x + bw + 2 + bw / 2} y={H - ho - 3} textAnchor="middle" className="an-getal">{onterecht[i]}</text>}
              <text x={i * kol + kol / 2} y={H + 16} textAnchor="middle" className="an-as">{b}</text>
            </g>
          );
        })}
        <line x1="0" x2={B} y1={H} y2={H} className="an-lijn" />
      </svg>
      <figcaption className="ab-klein"><span className="an-stip an-juist-stip" /> {tt("terecht")} <span className="an-stip an-onterecht-stip" /> {tt("onterecht")}</figcaption>
    </figure>
  );
}

function Vormen({ vormen }: { vormen: Vorm[] }) {
  const [gekopieerd, zet] = useState<string | null>(null);
  if (!vormen.length) return <Paragraph className="ab-klein">{tt("geenVormen")}</Paragraph>;
  const kopieer = async (r: string) => {
    try {
      await navigator.clipboard.writeText(r);
      zet(r);
    } catch {
      zet(null);
    }
  };
  return (
    <div className="ab-tabel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>{tt("soort")}</TableHeaderCell>
            <TableHeaderCell>{tt("vorm")}</TableHeaderCell>
            <TableHeaderCell>{tt("regex")}</TableHeaderCell>
            <TableHeaderCell>{tt("aantal")}</TableHeaderCell>
            <TableHeaderCell>{tt("inMetingen")}</TableHeaderCell>
            <TableHeaderCell>{tt("signaal")}</TableHeaderCell>
            <TableHeaderCell>{tt("lengte")}</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vormen.map((v) => (
            <TableRow key={`${v.soort}${v.vorm}`}>
              <TableCell>{soortNaam(v.soort)}</TableCell>
              <TableCell><code className="ab-mono">{v.vorm}</code></TableCell>
              <TableCell>
                <code className="ab-mono">{v.regex}</code>{" "}
                <SubtleButton onClick={() => kopieer(v.regex)}>{gekopieerd === v.regex ? tt("gekopieerd") : tt("kopieer")}</SubtleButton>
              </TableCell>
              <TableCell>{v.aantal}</TableCell>
              <TableCell>{v.metingen}</TableCell>
              <TableCell>{v.signaalwoorden.map((s) => `${s.woord} (${s.aantal})`).join(", ") || "—"}</TableCell>
              <TableCell className="ab-klein">{Object.entries(v.lengtes).map(([l, n]) => `${l} ${n}`).join(", ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
