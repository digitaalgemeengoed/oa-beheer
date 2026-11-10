import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Checkbox, FormField, FormLabel, Heading1, Heading2, Heading3, Paragraph, PrimaryActionButton, SecondaryActionButton,
  Select, SelectOption, StatusBadge, SubtleButton, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textarea, Textbox,
} from "@utrecht/component-library-react";
import { api, ApiFout, type Ik } from "../api";
import { taal, tijd } from "../i18n";
import { foutTekst, MeldingVak, RedenVeld, useLaden, type Melding } from "./gedeeld";

// ---------------------------------------------------------------------------
// Typen: zoals het platform ze geeft (oa-contract, classificatie.ts)
// ---------------------------------------------------------------------------

type Waardering = "vernietigen" | "blijvend-bewaren";
interface Procestype { nummer: number; naam: string; omschrijving: string; procesobject: string }
interface Resultaat {
  id: string;
  procestype: number;
  generiek: string | null;
  naam: string;
  omschrijving: string;
  waardering: Waardering;
  procestermijn: "nihil" | "procesobject" | "vervaldatum";
  bewaartermijn?: string;
  bewaartermijnTekst?: string;
  toelichting?: string;
}
interface Selectielijst { id: string; naam: string; toelichting: string; procestypen: Procestype[]; resultaten: Resultaat[] }
interface Afwijking { resultaat: string; waardering?: Waardering; bewaartermijn?: string; reden: string }
type AttribuutType = "tekst" | "keuze" | "ja-nee";
interface Attribuut { sleutel: string; label: string; type: AttribuutType; opties?: string[]; verplicht: boolean; beschrijving?: string }
interface Config {
  naam?: string;
  selectielijst: string;
  uitgezet?: string[];
  afwijkingen?: Afwijking[];
  attributen: Attribuut[];
  vergrendelBij: string[];
  termijnStartBij: string;
}
interface Model { versie: number; config: Config; gepubliceerd: string; door: string | null }
interface Stand {
  aan: boolean;
  gemeente?: string;
  selectielijsten?: Selectielijst[];
  statussen?: string[] | null;
  standaard?: Config;
  actief?: Model | null;
  versies?: Model[];
}
interface Probleem { sleutel?: string; ernst: "fout" | "waarschuwing"; melding: string }

const T = {
  titel: ["Classificatie", "Classification"],
  intro: [
    "Waar een stuk bij hoort in de selectielijst, en wat daaruit volgt: hoe lang het bewaard wordt en wanneer het vergrendeld is. Medewerkers kiezen in het paneel (Classificeren) een klasse; de assistent stelt er een voor. Publiceren maakt een nieuwe versie; stukken houden de versie waarmee ze zijn geclassificeerd.",
    "Where a document belongs in the retention schedule, and what follows: how long it is kept and when it is locked. Employees choose a class in the panel (Classify); the assistant suggests one. Publishing creates a new version; documents keep the version they were classified with.",
  ],
  uit: ["Het platform is niet gekoppeld aan dit portaal. Zie INRICHTING.md, stap 9.", "The platform is not connected to this portal. See INRICHTING.md, step 9."],
  nuActief: ["Nu in gebruik", "In use now"],
  geenModel: ["Nog geen classificatiemodel. Zonder model wordt geen stuk vergrendeld en krijgt geen stuk een bewaartermijn.", "No classification model yet. Without one, no document is locked and none gets a retention period."],
  versie: ["versie", "version"],
  door: ["door", "by"],
  gewijzigd: ["Gewijzigd, nog niet gepubliceerd", "Changed, not yet published"],
  terug: ["Wijzigingen weggooien", "Discard changes"],
  stap1: ["1. Naam en selectielijst", "1. Name and retention schedule"],
  naam: ["Naam van het model", "Name of the model"],
  naamUitleg: ["Zo heet het model in het paneel. Leeg: de naam van de selectielijst. Een andere naam is ook een nieuwe versie.", "This is what the model is called in the panel. Empty: the name of the schedule. A new name is also a new version."],
  stap2: ["2. Vergrendelen en bewaartermijn", "2. Locking and retention period"],
  vergrendel: ["Vergrendelen bij status", "Lock at status"],
  vergrendelUitleg: ["Bij deze statussen maakt het platform geen nieuwe versie meer. Een wijziging wordt een voorstel, dat een vrijgever beoordeelt (Keycloak-rol vrijgever). Kies ten minste één status.", "At these statuses the platform makes no new version. A change becomes a proposal, reviewed by a releaser (Keycloak role vrijgever). Choose at least one status."],
  start: ["De bewaartermijn gaat in bij status", "The retention period starts at status"],
  startUitleg: ["De dag waarop een stuk deze status voor het eerst krijgt, is de brondatum. Bij klassen waarvan de termijn ingaat als het procesobject vervalt (een vergunning), vult de medewerker die datum in.", "The day a document first gets this status is the source date. For classes whose period starts when the process object lapses (a permit), the employee enters that date."],
  geenStatus: ["Het metadatamodel heeft geen statusveld. Zet bij Metadatamodel een statusveld aan (RGBZ heeft er een); anders wordt niets vergrendeld en gaat geen termijn in.", "The metadata model has no status field. Switch one on in Metadata model (RGBZ has one); otherwise nothing is locked and no period starts."],
  stap3: ["3. Klassen uit de selectielijst", "3. Classes from the schedule"],
  stap3Uitleg: ["Zet uit wat je gemeente niet gebruikt; dat maakt de keuze in het paneel kleiner. Afwijken van een bewaartermijn kan alleen met een reden en het recht bewaartermijn.afwijken; vernietigen wat de selectielijst blijvend bewaart, meld je bij de archivaris.", "Switch off what your municipality does not use; that keeps the choice in the panel smaller. Deviating from a retention period requires a reason and the permission bewaartermijn.afwijken; destroying what the schedule keeps permanently must be reported to the archivist."],
  zoek: ["Zoek op nummer of woord", "Search by number or word"],
  inGebruik: ["in gebruik", "in use"],
  alles: ["Alles aan", "All on"],
  niets: ["Alles uit", "All off"],
  afwijken: ["Afwijken", "Deviate"],
  afwijking: ["afwijking", "deviation"],
  afwijkingen: ["Afwijkingen van de selectielijst", "Deviations from the schedule"],
  waardering: ["Waardering", "Appraisal"],
  vernietigen: ["vernietigen", "destroy"],
  bewaren: ["blijvend bewaren", "keep permanently"],
  jaren: ["Bewaartermijn in jaren", "Retention in years"],
  reden: ["Reden (verplicht)", "Reason (required)"],
  weg: ["Afwijking weghalen", "Remove deviation"],
  klaar: ["Klaar", "Done"],
  stap4: ["4. Eigen attributen", "4. Own attributes"],
  stap4Uitleg: ["Kenmerken die je gemeente bij het classificeren wil vastleggen, zoals de BIV-classificatie of \"bevat bijzondere persoonsgegevens\". De medewerker vult ze in het paneel in.", "Characteristics your municipality wants to record when classifying, such as the CIA rating or \"contains special personal data\". The employee fills them in in the panel."],
  label: ["Label", "Label"],
  sleutel: ["Technische naam", "Technical name"],
  soort: ["Soort", "Type"],
  tekst: ["tekst", "text"],
  keuze: ["keuzelijst", "choice"],
  janee: ["ja of nee", "yes or no"],
  opties: ["Keuzes, één per regel", "Options, one per line"],
  verplicht: ["Verplicht", "Required"],
  hulptekst: ["Hulptekst", "Help text"],
  toevoegen: ["Attribuut toevoegen", "Add attribute"],
  verwijder: ["Verwijderen", "Remove"],
  geenAttributen: ["Nog geen eigen attributen.", "No own attributes yet."],
  stap5: ["5. Controleren en publiceren", "5. Check and publish"],
  klopt: ["Het model klopt.", "The model is valid."],
  publiceren: ["Publiceren als nieuwe versie", "Publish as a new version"],
  publiceerUitleg: ["Nieuwe classificaties gebruiken dit model meteen; vergrendelen volgt meteen het nieuwe model. Stukken houden de bewaartermijn van de versie waarmee ze zijn geclassificeerd.", "New classifications use this model straight away; locking follows the new model at once. Documents keep the retention of the version they were classified with."],
  gepubliceerd: ["Gepubliceerd als versie", "Published as version"],
  versies: ["Versies", "Versions"],
  alsBasis: ["Als begin nemen", "Use as starting point"],
  alleenLezen: ["Je kunt het model bekijken, niet wijzigen (recht classificatie.manage).", "You can view the model, not change it (permission classificatie.manage)."],
  geenAfwijken: ["Afwijken van bewaartermijnen vraagt het recht bewaartermijn.afwijken.", "Deviating from retention periods requires the permission bewaartermijn.afwijken."],
  bezig: ["Bezig…", "Working…"],
} as const;
const tt = (k: keyof typeof T): string => T[k][taal() === "en" ? 1 : 0];

function duur(d?: string): string {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(d ?? "");
  if (!m) return d ?? "";
  const delen = [m[1] && `${m[1]} jaar`, m[2] && `${m[2]} mnd`, m[3] && `${m[3]} wk`, m[4] && `${m[4]} dagen`].filter(Boolean);
  return delen.length ? delen.join(" ") : "direct";
}
function termijn(r: Pick<Resultaat, "waardering" | "bewaartermijn" | "bewaartermijnTekst">): string {
  if (r.waardering === "blijvend-bewaren") return tt("bewaren");
  return `${tt("vernietigen")} ${r.bewaartermijn ? `na ${duur(r.bewaartermijn)}` : `(${r.bewaartermijnTekst ?? "zie toelichting"})`}`;
}

/** Vaste volgorde en vorm, om te vergelijken met wat in gebruik is. */
function vast(c: Config): string {
  return JSON.stringify({
    naam: c.naam?.trim() || undefined,
    selectielijst: c.selectielijst,
    uitgezet: [...(c.uitgezet ?? [])].sort(),
    afwijkingen: [...(c.afwijkingen ?? [])].map((a) => ({ resultaat: a.resultaat, waardering: a.waardering, bewaartermijn: a.bewaartermijn, reden: a.reden })).sort((a, b) => a.resultaat.localeCompare(b.resultaat)),
    attributen: c.attributen.map((a) => ({ sleutel: a.sleutel, label: a.label, type: a.type, opties: a.opties, verplicht: a.verplicht, beschrijving: a.beschrijving || undefined })),
    vergrendelBij: [...c.vergrendelBij].sort(),
    termijnStartBij: c.termijnStartBij,
  });
}

function sleutelUit(label: string): string {
  const w = label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const s = w.map((x, i) => (i === 0 ? x.toLowerCase() : x[0]!.toUpperCase() + x.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(s) ? s.slice(0, 40) : `attr${s}`.slice(0, 40);
}

// ---------------------------------------------------------------------------
// De pagina
// ---------------------------------------------------------------------------

export function Classificatie({ ik }: { ik: Ik }) {
  const stand = useLaden(() => api<Stand>("GET", "/api/classificatie"));
  if (stand.fout) return <><Heading1>{tt("titel")}</Heading1><MeldingVak m={{ soort: "fout", tekst: stand.fout }} /></>;
  if (!stand.data) return <Heading1>{tt("titel")}</Heading1>;
  if (!stand.data.aan) return <><Heading1>{tt("titel")}</Heading1><Alert type="info"><Paragraph>{tt("uit")}</Paragraph></Alert></>;
  return <Bewerker key={stand.data.actief?.versie ?? 0} ik={ik} s={stand.data} herlaad={stand.herlaad} />;
}

function Bewerker({ ik, s, herlaad }: { ik: Ik; s: Stand; herlaad: () => void }) {
  const kan = ik.rechten.includes("classificatie.manage");
  const magAfwijken = kan && ik.rechten.includes("bewaartermijn.afwijken");
  const vanActief = useMemo<Config>(() => s.actief?.config ?? s.standaard!, [s]);
  const [config, zetConfig] = useState<Config>(vanActief);
  const [problemen, zetProblemen] = useState<Probleem[] | null>(null);
  const [reden, zetReden] = useState("");
  const [m, zetM] = useState<Melding>(null);
  const [bezig, zetBezig] = useState(false);
  const [vraag, zetVraag] = useState("");
  const [open, zetOpen] = useState<string | null>(null);
  const lijst = s.selectielijsten!.find((l) => l.id === config.selectielijst) ?? s.selectielijsten![0]!;
  const gewijzigd = !s.actief || vast(config) !== vast(vanActief);
  const eerste = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ problemen: Probleem[] }>("POST", "/api/classificatie/controle", { config }).then((r) => zetProblemen(r.problemen), (e) => zetM({ soort: "fout", tekst: foutTekst(e) }));
    }, eerste.current ? 0 : 300);
    eerste.current = false;
    return () => clearTimeout(t);
  }, [config]);

  const uit = useMemo(() => new Set(config.uitgezet ?? []), [config.uitgezet]);
  const afw = useMemo(() => new Map((config.afwijkingen ?? []).map((a) => [a.resultaat, a])), [config.afwijkingen]);
  const zetUit = (ids: string[], weg: boolean) =>
    zetConfig((c) => {
      const u = new Set(c.uitgezet ?? []);
      for (const i of ids) (weg ? u.add(i) : u.delete(i));
      return { ...c, uitgezet: [...u].sort() };
    });
  const zetAfwijking = (id: string, a: Partial<Afwijking> | null) =>
    zetConfig((c) => {
      const rest = (c.afwijkingen ?? []).filter((x) => x.resultaat !== id);
      if (!a) return { ...c, afwijkingen: rest };
      const oud = (c.afwijkingen ?? []).find((x) => x.resultaat === id) ?? { resultaat: id, reden: "" };
      return { ...c, afwijkingen: [...rest, { ...oud, ...a }] };
    });

  const q = vraag.trim().toLowerCase();
  const zichtbaar = (r: Resultaat) => !q || r.id === q || r.id.startsWith(`${q}.`) || `${r.naam} ${r.omschrijving} ${r.toelichting ?? ""}`.toLowerCase().includes(q);
  const fouten = (problemen ?? []).filter((p) => p.ernst === "fout");

  const publiceer = async () => {
    zetBezig(true);
    zetM(null);
    try {
      const r = await api<{ versie: number }>("POST", "/api/classificatie/publiceer", { config, reden });
      zetM({ soort: "ok", tekst: `${tt("gepubliceerd")} ${r.versie}.` });
      zetReden("");
      herlaad();
    } catch (e) {
      const details = e instanceof ApiFout ? e.details : undefined;
      zetM({ soort: "fout", tekst: foutTekst(e) + (details?.length ? ` ${details.map((d) => d.melding).join(" ")}` : "") });
    } finally {
      zetBezig(false);
    }
  };

  return (
    <>
      <Heading1>{tt("titel")}</Heading1>
      <Paragraph className="ab-lead">{tt("intro")}</Paragraph>

      <div className="md-status">
        <div>
          <span className="ab-klein">{tt("nuActief")}</span>
          <div>
            {s.actief ? (
              <>
                <b>{tt("versie")} {s.actief.versie}</b> · {s.actief.config.naam?.trim() || lijst.naam} · {tijd(s.actief.gepubliceerd)}
                {s.actief.door ? ` ${tt("door")} ${s.actief.door}` : ""}
              </>
            ) : (
              tt("geenModel")
            )}
          </div>
        </div>
        {s.actief && gewijzigd && (
          <div className="md-concept">
            <StatusBadge status="warning">{tt("gewijzigd")}</StatusBadge>
            {kan && <SubtleButton onClick={() => zetConfig(vanActief)}>{tt("terug")}</SubtleButton>}
          </div>
        )}
      </div>
      {!kan && <Alert type="info"><Paragraph>{tt("alleenLezen")}</Paragraph></Alert>}
      <MeldingVak m={m} />

      <div className="cl-kolommen">
        {/* 1. Naam en selectielijst */}
        <section aria-labelledby="cl-stap1">
          <Heading2 id="cl-stap1">{tt("stap1")}</Heading2>
          <div className="md-model gekozen cl-lijst" aria-label={lijst.naam}>
            <span className="md-model-kop"><b>{lijst.naam}</b></span>
            <span className="ab-klein">{lijst.toelichting} {lijst.resultaten.length} resultaten in {lijst.procestypen.length} procestypen.</span>
          </div>
          <FormField label={<FormLabel htmlFor="cl-naam">{tt("naam")}</FormLabel>} description={tt("naamUitleg")}>
            <Textbox id="cl-naam" value={config.naam ?? ""} placeholder={lijst.naam} maxLength={80} disabled={!kan} onChange={(e) => zetConfig((c) => ({ ...c, naam: e.target.value || undefined }))} />
          </FormField>
        </section>

        {/* 2. Vergrendelen en bewaartermijn */}
        <section aria-labelledby="cl-stap2">
          <Heading2 id="cl-stap2">{tt("stap2")}</Heading2>
          {!s.statussen ? (
            <Alert type="warning"><Paragraph>{tt("geenStatus")}</Paragraph></Alert>
          ) : (
            <>
              <fieldset className="cl-statussen">
                <legend>{tt("vergrendel")}</legend>
                <p className="ab-klein">{tt("vergrendelUitleg")}</p>
                {s.statussen.map((st) => (
                  <label key={st} className="cl-vink">
                    <Checkbox
                      checked={config.vergrendelBij.includes(st)}
                      disabled={!kan}
                      onChange={(e) => zetConfig((c) => ({ ...c, vergrendelBij: e.target.checked ? [...c.vergrendelBij, st] : c.vergrendelBij.filter((x) => x !== st) }))}
                    />
                    {st}
                  </label>
                ))}
              </fieldset>
              <FormField label={<FormLabel htmlFor="cl-start">{tt("start")}</FormLabel>} description={tt("startUitleg")}>
                <Select id="cl-start" value={config.termijnStartBij} disabled={!kan} onChange={(e) => zetConfig((c) => ({ ...c, termijnStartBij: e.target.value }))}>
                  {s.statussen.map((st) => <SelectOption key={st} value={st}>{st}</SelectOption>)}
                </Select>
              </FormField>
            </>
          )}
        </section>
      </div>

      {/* 3. Klassen */}
      <section aria-labelledby="cl-stap3" className="cl-sectie">
        <Heading2 id="cl-stap3">{tt("stap3")}</Heading2>
        <Paragraph className="ab-klein">{tt("stap3Uitleg")}</Paragraph>
        {kan && !magAfwijken && <Paragraph className="ab-klein">{tt("geenAfwijken")}</Paragraph>}
        {(config.afwijkingen?.length ?? 0) > 0 && (
          <div className="cl-afwijkingen">
            <Heading3>{tt("afwijkingen")} ({config.afwijkingen!.length})</Heading3>
            <ul>
              {config.afwijkingen!.map((a) => {
                const r = lijst.resultaten.find((x) => x.id === a.resultaat);
                return (
                  <li key={a.resultaat}>
                    <b>{a.resultaat}</b> {r?.naam} {r?.omschrijving ? `(${r.omschrijving})` : ""}: {r ? termijn(r) : ""} → <b>{termijn({ waardering: a.waardering ?? r?.waardering ?? "vernietigen", bewaartermijn: a.bewaartermijn ?? r?.bewaartermijn })}</b>
                    <span className="ab-klein"> · {a.reden || "geen reden"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <FormField label={<FormLabel htmlFor="cl-zoek">{tt("zoek")}</FormLabel>}>
          <Textbox id="cl-zoek" value={vraag} onChange={(e) => zetVraag(e.target.value)} autoComplete="off" />
        </FormField>
        <div className="cl-procestypen">
          {lijst.procestypen.map((pt) => {
            const alle = lijst.resultaten.filter((r) => r.procestype === pt.nummer);
            const rs = alle.filter(zichtbaar);
            if (!rs.length) return null;
            const aan = alle.filter((r) => !uit.has(r.id)).length;
            return (
              <details key={pt.nummer} className="cl-procestype" open={!!q}>
                <summary>
                  <b>{pt.nummer}. {pt.naam}</b> <span className="ab-klein">({aan} van {alle.length} {tt("inGebruik")})</span>
                </summary>
                <p className="ab-klein">{pt.omschrijving}{pt.procesobject ? ` · Procesobject: ${pt.procesobject}` : ""}</p>
                {kan && (
                  <div className="ab-knoppen">
                    <SubtleButton onClick={() => zetUit(alle.map((r) => r.id), false)}>{tt("alles")}</SubtleButton>
                    <SubtleButton onClick={() => zetUit(alle.map((r) => r.id), true)}>{tt("niets")}</SubtleButton>
                  </div>
                )}
                <ul className="cl-resultaten">
                  {rs.map((r) => {
                    const a = afw.get(r.id);
                    const isOpen = open === r.id;
                    return (
                      <li key={r.id} className={`cl-resultaat${uit.has(r.id) ? " uit" : ""}${r.generiek ? "" : " generiek"}`}>
                        <div className="cl-regel">
                          <label className="cl-vink" title={tt("inGebruik")}>
                            <Checkbox checked={!uit.has(r.id)} disabled={!kan} onChange={(e) => zetUit([r.id], !e.target.checked)} aria-label={`${r.id} ${tt("inGebruik")}`} />
                          </label>
                          <div className="cl-naam">
                            <span><b>{r.id}</b> {r.naam}{r.omschrijving ? ` · ${r.omschrijving}` : ""}</span>
                            <span className="ab-klein">
                              {termijn(r)}
                              {r.procestermijn !== "nihil" ? " · gaat in als het procesobject vervalt" : ""}
                              {a && <> → <b>{termijn({ waardering: a.waardering ?? r.waardering, bewaartermijn: a.bewaartermijn ?? r.bewaartermijn })}</b> ({tt("afwijking")})</>}
                            </span>
                          </div>
                          {magAfwijken && <SubtleButton onClick={() => zetOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>{isOpen ? tt("klaar") : tt("afwijken")}</SubtleButton>}
                        </div>
                        {isOpen && (
                          <div className="md-bewerk">
                            <div className="md-twee">
                              <FormField label={<FormLabel htmlFor={`cl-w-${r.id}`}>{tt("waardering")}</FormLabel>}>
                                <Select id={`cl-w-${r.id}`} value={a?.waardering ?? r.waardering} onChange={(e) => zetAfwijking(r.id, { waardering: e.target.value as Waardering })}>
                                  <SelectOption value="vernietigen">{tt("vernietigen")}</SelectOption>
                                  <SelectOption value="blijvend-bewaren">{tt("bewaren")}</SelectOption>
                                </Select>
                              </FormField>
                              {(a?.waardering ?? r.waardering) === "vernietigen" && (
                                <FormField label={<FormLabel htmlFor={`cl-j-${r.id}`}>{tt("jaren")}</FormLabel>} description={r.bewaartermijn ? `Selectielijst: ${duur(r.bewaartermijn)}` : undefined}>
                                  <Textbox
                                    id={`cl-j-${r.id}`}
                                    type="number"
                                    min={0}
                                    max={200}
                                    value={/^P(\d+)Y$/.exec(a?.bewaartermijn ?? "")?.[1] ?? ""}
                                    onChange={(e) => zetAfwijking(r.id, { bewaartermijn: e.target.value === "" ? undefined : `P${Math.max(0, Math.round(Number(e.target.value)))}Y` })}
                                  />
                                </FormField>
                              )}
                            </div>
                            <FormField label={<FormLabel htmlFor={`cl-r-${r.id}`}>{tt("reden")}</FormLabel>}>
                              <Textarea id={`cl-r-${r.id}`} rows={2} maxLength={1000} value={a?.reden ?? ""} onChange={(e) => zetAfwijking(r.id, { reden: e.target.value })} />
                            </FormField>
                            {a && <div><SubtleButton onClick={() => { zetAfwijking(r.id, null); zetOpen(null); }}>{tt("weg")}</SubtleButton></div>}
                          </div>
                        )}
                        {(problemen ?? []).filter((p) => p.sleutel === r.id).map((p, i) => <p key={i} className={`md-probleem ${p.ernst}`}>{p.melding}</p>)}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </section>

      {/* 4. Eigen attributen */}
      <section aria-labelledby="cl-stap4" className="cl-sectie">
        <Heading2 id="cl-stap4">{tt("stap4")}</Heading2>
        <Paragraph className="ab-klein">{tt("stap4Uitleg")}</Paragraph>
        {config.attributen.length === 0 && <Paragraph className="ab-klein">{tt("geenAttributen")}</Paragraph>}
        <ol className="md-velden">
          {config.attributen.map((a, i) => (
            <li key={a.sleutel} className="md-veld">
              <AttribuutBewerken
                a={a}
                kan={kan}
                zet={(n) => zetConfig((c) => ({ ...c, attributen: c.attributen.map((x, j) => (j === i ? n : x)) }))}
                weg={() => zetConfig((c) => ({ ...c, attributen: c.attributen.filter((_, j) => j !== i) }))}
              />
              {(problemen ?? []).filter((p) => p.sleutel === a.sleutel).map((p, k) => <p key={k} className={`md-probleem ${p.ernst}`}>{p.melding}</p>)}
            </li>
          ))}
        </ol>
        {kan && <NieuwAttribuut bestaand={new Set(config.attributen.map((a) => a.sleutel))} voegToe={(a) => zetConfig((c) => ({ ...c, attributen: [...c.attributen, a] }))} />}
      </section>

      {/* 5. Controleren en publiceren */}
      <section aria-labelledby="cl-stap5" className="cl-sectie">
        <Heading2 id="cl-stap5">{tt("stap5")}</Heading2>
        {problemen && (problemen.length === 0 ? (
          <Alert type="ok"><Paragraph>{tt("klopt")}</Paragraph></Alert>
        ) : (
          <ul className="md-problemen">
            {problemen.map((p, n) => (
              <li key={n} className={p.ernst}>
                <StatusBadge status={p.ernst === "fout" ? "danger" : "warning"}>{p.ernst}</StatusBadge> {p.sleutel && /^\d/.test(p.sleutel) ? `${p.sleutel}: ` : ""}{p.melding}
              </li>
            ))}
          </ul>
        ))}
        {kan && (
          <div className="ab-formulier">
            <Paragraph className="ab-klein">{tt("publiceerUitleg")}</Paragraph>
            <RedenVeld id="cl-reden" waarde={reden} zet={zetReden} />
            <div>
              <PrimaryActionButton onClick={publiceer} disabled={bezig || !gewijzigd || fouten.length > 0 || reden.trim().length < 5}>
                {bezig ? tt("bezig") : tt("publiceren")}
              </PrimaryActionButton>
            </div>
          </div>
        )}
      </section>

      {(s.versies?.length ?? 0) > 0 && (
        <section aria-labelledby="cl-versies" className="cl-sectie">
          <Heading2 id="cl-versies">{tt("versies")}</Heading2>
          <div className="ab-tabel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{tt("versie")}</TableHeaderCell>
                  <TableHeaderCell>{tt("naam").replace(/ van het model| of the model/, "")}</TableHeaderCell>
                  <TableHeaderCell>{tt("vergrendel")}</TableHeaderCell>
                  <TableHeaderCell>{tt("afwijkingen").split(" ")[0]}</TableHeaderCell>
                  <TableHeaderCell>{taal() === "en" ? "Published" : "Gepubliceerd"}</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.versies!.map((v) => (
                  <TableRow key={v.versie}>
                    <TableCell>{v.versie}</TableCell>
                    <TableCell>{v.config.naam?.trim() || lijst.naam}</TableCell>
                    <TableCell>{v.config.vergrendelBij.join(", ")}</TableCell>
                    <TableCell>{v.config.afwijkingen?.length ?? 0}</TableCell>
                    <TableCell>{tijd(v.gepubliceerd)}{v.door ? ` · ${v.door}` : ""}</TableCell>
                    <TableCell>{kan && <SubtleButton onClick={() => zetConfig(v.config)}>{tt("alsBasis")}</SubtleButton>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </>
  );
}

function AttribuutBewerken({ a, kan, zet, weg }: { a: Attribuut; kan: boolean; zet: (a: Attribuut) => void; weg: () => void }) {
  const id = `cl-a-${a.sleutel}`;
  return (
    <div className="cl-attribuut">
      <div className="md-twee">
        <FormField label={<FormLabel htmlFor={`${id}-label`}>{tt("label")}</FormLabel>} description={`${tt("sleutel")}: ${a.sleutel}`}>
          <Textbox id={`${id}-label`} value={a.label} maxLength={100} disabled={!kan} onChange={(e) => zet({ ...a, label: e.target.value })} />
        </FormField>
        <FormField label={<FormLabel htmlFor={`${id}-soort`}>{tt("soort")}</FormLabel>}>
          <Select id={`${id}-soort`} value={a.type} disabled={!kan} onChange={(e) => zet({ ...a, type: e.target.value as AttribuutType })}>
            <SelectOption value="tekst">{tt("tekst")}</SelectOption>
            <SelectOption value="keuze">{tt("keuze")}</SelectOption>
            <SelectOption value="ja-nee">{tt("janee")}</SelectOption>
          </Select>
        </FormField>
      </div>
      {a.type === "keuze" && (
        <FormField label={<FormLabel htmlFor={`${id}-opties`}>{tt("opties")}</FormLabel>}>
          <Textarea id={`${id}-opties`} rows={3} disabled={!kan} value={(a.opties ?? []).join("\n")} onChange={(e) => zet({ ...a, opties: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
        </FormField>
      )}
      <FormField label={<FormLabel htmlFor={`${id}-hulp`}>{tt("hulptekst")}</FormLabel>}>
        <Textbox id={`${id}-hulp`} value={a.beschrijving ?? ""} maxLength={500} disabled={!kan} onChange={(e) => zet({ ...a, beschrijving: e.target.value || undefined })} />
      </FormField>
      <div className="ab-knoppen">
        <label className="cl-vink">
          <Checkbox checked={a.verplicht} disabled={!kan} onChange={(e) => zet({ ...a, verplicht: e.target.checked })} /> {tt("verplicht")}
        </label>
        {kan && <SecondaryActionButton onClick={weg}>{tt("verwijder")}</SecondaryActionButton>}
      </div>
    </div>
  );
}

function NieuwAttribuut({ bestaand, voegToe }: { bestaand: Set<string>; voegToe: (a: Attribuut) => void }) {
  const [label, zetLabel] = useState("");
  const [type, zetType] = useState<AttribuutType>("keuze");
  const sleutel = sleutelUit(label);
  const dubbel = bestaand.has(sleutel);
  return (
    <div className="md-nieuw">
      <Heading3>{tt("toevoegen")}</Heading3>
      <div className="md-twee">
        <FormField label={<FormLabel htmlFor="cl-nieuw-label">{tt("label")}</FormLabel>} description={label ? `${tt("sleutel")}: ${sleutel}` : undefined}>
          <Textbox id="cl-nieuw-label" value={label} maxLength={100} onChange={(e) => zetLabel(e.target.value)} />
        </FormField>
        <FormField label={<FormLabel htmlFor="cl-nieuw-soort">{tt("soort")}</FormLabel>}>
          <Select id="cl-nieuw-soort" value={type} onChange={(e) => zetType(e.target.value as AttribuutType)}>
            <SelectOption value="keuze">{tt("keuze")}</SelectOption>
            <SelectOption value="tekst">{tt("tekst")}</SelectOption>
            <SelectOption value="ja-nee">{tt("janee")}</SelectOption>
          </Select>
        </FormField>
      </div>
      <div>
        <SecondaryActionButton
          disabled={!label.trim() || dubbel}
          onClick={() => {
            voegToe({ sleutel, label: label.trim(), type, verplicht: false, ...(type === "keuze" ? { opties: [] } : {}) });
            zetLabel("");
          }}
        >
          {tt("toevoegen")}
        </SecondaryActionButton>
      </div>
    </div>
  );
}
