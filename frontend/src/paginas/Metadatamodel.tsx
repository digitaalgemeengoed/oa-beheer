import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Checkbox, FormField, FormLabel, Heading1, Heading2, Heading3, Paragraph, PrimaryActionButton, SecondaryActionButton,
  Select, SelectOption, StatusBadge, SubtleButton, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textarea, Textbox,
} from "@utrecht/component-library-react";
import { api, ApiFout, type Ik } from "../api";
import { taal, tijd } from "../i18n";
import { foutTekst, MeldingVak, RedenVeld, useLaden, type Melding } from "./gedeeld";

// ---------------------------------------------------------------------------
// Typen: de catalogus komt van het platform (oa-contract, metadatamodellen.ts)
// ---------------------------------------------------------------------------

type ModelId = "mdto" | "rgbz" | "tmlo";
type VeldType = "tekst" | "lange-tekst" | "datum" | "keuze" | "getal";

interface CatalogusVeld {
  sleutel: string;
  element: string;
  label: string;
  beschrijving: string;
  type: VeldType;
  rol?: string;
  waardelijst?: string;
  verplichtInModel?: boolean;
  aan?: boolean;
  verplicht?: boolean;
  aanvulling?: string;
}
interface Model { id: ModelId; naam: string; voluit: string; versie: string; uitleg: string; automatisch: string[]; velden: CatalogusVeld[] }
interface Waardelijst { id: string; naam: string; bron: string; waarden: string[] }
interface VeldKeuze {
  sleutel: string;
  aan: boolean;
  verplicht: boolean;
  label?: string;
  beschrijving?: string;
  waardelijst?: string;
  eigen?: { type: VeldType; maxLengte?: number; opties?: string[]; rol?: string };
  geenCategorie?: boolean;
}
interface Config { basis: ModelId; naam?: string; velden: VeldKeuze[] }
interface Versie { versie: number; titel: string; modelnaam?: string; gepubliceerd: string; gedeeld: boolean; door: string | null; model: ModelId | null; config: Config | null; velden: number }
interface Stand {
  aan: boolean;
  gemeente?: string;
  catalogus?: { modellen: Record<ModelId, Model>; waardelijsten: Record<string, Waardelijst>; rollen: string[] };
  actief?: { versie: number; titel: string; config: Config | null; schema: { properties?: Record<string, { title?: string }>; required?: string[] } };
  versies?: Versie[];
  concept?: { config: Config; gewijzigd: string; door: string | null } | null;
}
interface Probleem { sleutel?: string; ernst: "fout" | "waarschuwing"; melding: string }
interface SchemaVeld { sleutel: string; element: string; label: string; beschrijving?: string; type: VeldType; rol?: string; opties?: string[]; verplicht: boolean; eigen: boolean; standaard?: string }
interface Controle { problemen: Probleem[]; velden: SchemaVeld[]; schema: unknown }

const MODELLEN: ModelId[] = ["mdto", "rgbz", "tmlo"];

// ---------------------------------------------------------------------------
// Teksten (nl, en)
// ---------------------------------------------------------------------------

const T = {
  titel: ["Metadatamodel", "Metadata model"],
  intro: [
    "Welke metadata een medewerker in het paneel Metadateren invult. Kies het model dat je organisatie volgt, zet velden aan of uit, maak ze verplicht, pas label en hulptekst aan of voeg eigen velden toe. Publiceren maakt een nieuwe versie; stukken die al zijn vastgelegd houden hun versie.",
    "Which metadata an employee fills in on the Metadata panel. Choose the model your organisation follows, switch fields on or off, make them required, adjust label and help text, or add fields of your own. Publishing creates a new version; documents already recorded keep theirs.",
  ],
  uit: ["Het platform is niet gekoppeld aan dit portaal. Zet PLATFORM_URL, PLATFORM_DIENSTSLEUTEL en GEMEENTE (zie INRICHTING.md, stap 9).", "The platform is not connected to this portal. Set PLATFORM_URL, PLATFORM_DIENSTSLEUTEL and GEMEENTE (see INRICHTING.md, step 9)."],
  nuActief: ["Nu in gebruik", "In use now"],
  standaardmodel: ["het standaardmodel van de Office Assistent (een deel van MDTO)", "the Office Assistant default model (a subset of MDTO)"],
  versie: ["versie", "version"],
  concept: ["Concept, nog niet gepubliceerd", "Draft, not yet published"],
  bewaard: ["bewaard", "saved"],
  door: ["door", "by"],
  conceptWeg: ["Concept weggooien", "Discard draft"],
  stap1: ["1. Basismodel", "1. Base model"],
  stap1Uitleg: ["De standaard die je organisatie volgt. TOOI is geen model maar levert de waardelijsten, zoals de Woo-informatiecategorieën.", "The standard your organisation follows. TOOI is not a model but supplies the value lists, such as the Woo information categories."],
  gekozen: ["gekozen", "selected"],
  wissel: ["Een ander basismodel zet alle velden terug naar de standaard van dat model. Je aanpassingen gaan verloren.", "A different base model resets all fields to that model's default. Your changes are lost."],
  wisselToch: ["Toch wisselen", "Switch anyway"],
  stap2: ["2. Velden", "2. Fields"],
  stap2Uitleg: ["Aan: het veld staat in het paneel. Verplicht: zonder dit veld heet een stuk onvolledig. De volgorde hier is de volgorde in het paneel.", "On: the field appears in the panel. Required: without it a document counts as incomplete. The order here is the order in the panel."],
  aan: ["Aan", "On"],
  verplicht: ["Verplicht", "Required"],
  veld: ["Veld", "Field"],
  inModel: ["In het model", "In the model"],
  soort: ["Soort", "Type"],
  bewerk: ["Aanpassen", "Edit"],
  klaar: ["Klaar", "Done"],
  omhoog: ["Omhoog", "Move up"],
  omlaag: ["Omlaag", "Move down"],
  verplichtInModel: ["verplicht in het model", "required by the model"],
  aanvulling: ["aanvulling", "addition"],
  eigen: ["eigen veld", "own field"],
  label: ["Label", "Label"],
  hulptekst: ["Hulptekst", "Help text"],
  leegStandaard: ["Leeg laten: de tekst uit het model.", "Leave empty: the text from the model."],
  waardelijst: ["Waardelijst", "Value list"],
  opties: ["Keuzes, één per regel", "Options, one per line"],
  eigenKeuzes: ["Eigen keuzes (hieronder)", "Own options (below)"],
  maxLengte: ["Hoogstens zoveel tekens", "At most this many characters"],
  rol: ["Betekenis voor de assistent", "Meaning for the assistant"],
  geenRol: ["geen", "none"],
  verwijder: ["Verwijderen", "Remove"],
  automatisch: ["Vult het systeem zelf in", "Filled in by the system"],
  nieuwVeld: ["Eigen veld toevoegen", "Add your own field"],
  nieuwVeldUitleg: ["Voor wat in geen model staat, zoals een kostenplaats of wijk. Het komt in de metadata van het stuk, niet in het archiefmodel.", "For what no model has, such as a cost centre or district. It goes into the document's metadata, not into the archival model."],
  sleutel: ["Technische naam", "Technical name"],
  sleutelUitleg: ["Letters en cijfers, begint met een kleine letter. Kan later niet meer veranderen.", "Letters and digits, starting with a lowercase letter. Cannot change later."],
  toevoegen: ["Toevoegen", "Add"],
  stap3: ["3. Controleren en publiceren", "3. Check and publish"],
  geenProblemen: ["Het model klopt.", "The model is valid."],
  verschil: ["Wat er verandert ten opzichte van versie", "What changes compared with version"],
  geenVerschil: ["Niets: dit is wat nu in gebruik is.", "Nothing: this is what is in use now."],
  publiceren: ["Publiceren als nieuwe versie", "Publish as a new version"],
  publiceerUitleg: ["Nieuwe stukken krijgen dit model meteen. Stukken die al zijn vastgelegd houden hun versie en hun velden.", "New documents get this model straight away. Documents already recorded keep their version and fields."],
  gepubliceerd: ["Gepubliceerd als versie", "Published as version"],
  voorbeeld: ["Zo ziet het paneel eruit", "This is how the panel looks"],
  voorbeeldUitleg: ["Voorbeeld; hier vul je niets in.", "Preview; nothing is filled in here."],
  zakelijk: ["Zakelijk", "Business"],
  persoonlijk: ["Persoonlijk", "Personal"],
  kies: ["Kies…", "Choose…"],
  versies: ["Versies", "Versions"],
  gedeeld: ["gedeeld", "shared"],
  eigenVersie: ["eigen", "own"],
  alsBasis: ["Als begin nemen", "Use as starting point"],
  velden: ["velden", "fields"],
  alleenLezen: ["Je kunt het model bekijken, niet wijzigen (recht metadata.manage).", "You can view the model, not change it (permission metadata.manage)."],
  bezig: ["Bezig…", "Working…"],
  toegevoegd: ["toegevoegd", "added"],
  weggehaald: ["weggehaald", "removed"],
  nuVerplicht: ["nu verplicht", "now required"],
  nietVerplicht: ["niet meer verplicht", "no longer required"],
  andersGenoemd: ["heet nu", "is now called"],
  andereLijst: ["andere waardelijst", "different value list"],
  volgorde: ["andere volgorde", "different order"],
  basisNaar: ["Basismodel van", "Base model from"],
  geenCategorie: ["Ook \"geen categorie (niet actief openbaar)\" aanbieden", "Also offer \"no category (not proactively published)\""],
  geenCategorieUitleg: [
    "Niet elk stuk valt in een categorie van artikel 3.3 Woo, zoals een gespreksverslag met een inwoner. Met deze keuze legt de medewerker dat vast in plaats van een categorie te kiezen die niet klopt. Het stuk blijft opvraagbaar met een Woo-verzoek.",
    "Not every document falls into a category of article 3.3 of the Open Government Act, such as notes of a conversation with a resident. With this option the employee records that, instead of choosing a category that does not fit. The document can still be requested.",
  ],
  metGeen: ["ook \"geen categorie\"", "also \"no category\""],
  geenAan: ["biedt nu ook \"geen categorie\" aan", "now also offers \"no category\""],
  geenUit: ["biedt \"geen categorie\" niet meer aan", "no longer offers \"no category\""],
  modelnaam: ["Naam van het model", "Name of the model"],
  modelnaamUitleg: ["Zo heet het model bovenaan het paneel Metadateren en in de eigenschappen van elk bestand, met het versienummer. Leeg: de naam van het basismodel. Een andere naam is ook een nieuwe versie.", "This is what the model is called at the top of the Metadata panel and in the properties of each file, with its version number. Empty: the name of the base model. A new name is also a new version."],
  naamVan: ["Naam van", "Name from"],
  naam: ["Naam", "Name"],
  status: ["status", "status"],
  versieNieuw: ["nieuwe versie", "new version"],
  naar: ["naar", "to"],
} as const;
const tt = (k: keyof typeof T): string => T[k][taal() === "en" ? 1 : 0];

const SOORTNAAM: Record<VeldType, [string, string]> = {
  tekst: ["tekst", "text"],
  "lange-tekst": ["lange tekst", "long text"],
  datum: ["datum", "date"],
  keuze: ["keuzelijst", "choice"],
  getal: ["getal", "number"],
};
const soortNaam = (s: VeldType) => SOORTNAAM[s][taal() === "en" ? 1 : 0];

const ROLNAAM: Record<string, [string, string]> = {
  titel: ["titel", "title"],
  omschrijving: ["omschrijving", "description"],
  informatiecategorie: ["Woo-categorie", "Woo category"],
  vertrouwelijkheid: ["vertrouwelijkheid", "confidentiality"],
  taal: ["taal", "language"],
  zaak: ["zaak", "case"],
  dossier: ["dossier", "file"],
  auteur: ["auteur", "author"],
  datum: ["datum", "date"],
  trefwoorden: ["trefwoorden", "keywords"],
  status: ["status", "status"],
};
const rolNaam = (r: string) => ROLNAAM[r]?.[taal() === "en" ? 1 : 0] ?? r;

function standaardConfig(m: Model): Config {
  return { basis: m.id, velden: m.velden.map((v) => ({ sleutel: v.sleutel, aan: !!v.aan, verplicht: !!v.verplicht, ...(v.rol === "informatiecategorie" ? { geenCategorie: true } : {}) })) };
}

/** Het model dat nu in gebruik is, als keuze. Het oude standaardmodel (zonder keuze) als MDTO met dezelfde velden. */
function configVanActief(s: Stand): Config {
  if (s.actief?.config) return s.actief.config;
  const mdto = s.catalogus!.modellen.mdto;
  const props = s.actief?.schema.properties ?? {};
  const verplicht = new Set(s.actief?.schema.required ?? []);
  // Het standaardmodel van de Office Assistent gebruikt een paar andere sleutels.
  const naar: Record<string, string> = { vertrouwelijkheid: "beperkingGebruik", dossier: "isOnderdeelVan" };
  const aan = new Map(Object.keys(props).map((k) => [naar[k] ?? k, verplicht.has(k)] as const));
  return { basis: "mdto", velden: mdto.velden.map((v) => ({ sleutel: v.sleutel, aan: aan.has(v.sleutel), verplicht: aan.get(v.sleutel) ?? false })) };
}

/** Een technische naam uit een label: "Wijk of buurt" → "wijkOfBuurt". */
function sleutelUit(label: string): string {
  const woorden = label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const s = woorden.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(s) ? s.slice(0, 40) : `veld${s}`.slice(0, 40);
}

/** De naam zoals medewerkers die zien (modelnaam() in oa-contract). */
const naamVan = (c: Config, cat: NonNullable<Stand["catalogus"]>) => c.naam?.trim() || cat.modellen[c.basis]?.naam || c.basis;

const gelijk = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Vaste volgorde van de sleutels: de database (jsonb) bewaart ze in een andere. */
function vast(c: Config): unknown {
  return {
    basis: c.basis,
    naam: c.naam?.trim() || undefined,
    velden: c.velden.map((v) => ({
      sleutel: v.sleutel,
      aan: v.aan,
      verplicht: v.verplicht,
      label: v.label || undefined,
      beschrijving: v.beschrijving || undefined,
      waardelijst: v.waardelijst || undefined,
      eigen: v.eigen ? { type: v.eigen.type, maxLengte: v.eigen.maxLengte, opties: v.eigen.opties, rol: v.eigen.rol } : undefined,
      geenCategorie: v.geenCategorie || undefined,
    })),
  };
}
const zelfde = (a: Config, b: Config) => gelijk(vast(a), vast(b));

// ---------------------------------------------------------------------------
// De pagina
// ---------------------------------------------------------------------------

export function Metadatamodel({ ik }: { ik: Ik }) {
  const stand = useLaden(() => api<Stand>("GET", "/api/metadatamodel"));
  if (stand.fout) return <><Heading1>{tt("titel")}</Heading1><MeldingVak m={{ soort: "fout", tekst: stand.fout }} /></>;
  if (!stand.data) return <Heading1>{tt("titel")}</Heading1>;
  if (!stand.data.aan) return <><Heading1>{tt("titel")}</Heading1><Alert type="info"><Paragraph>{tt("uit")}</Paragraph></Alert></>;
  // Na publiceren opnieuw beginnen vanaf de nieuwe versie.
  return <Bewerker key={stand.data.actief?.versie} ik={ik} s={stand.data} herlaad={stand.herlaad} />;
}

function Bewerker({ ik, s, herlaad }: { ik: Ik; s: Stand; herlaad: () => void }) {
  const kan = ik.rechten.includes("metadata.manage");
  const cat = s.catalogus!;
  const vanActief = useMemo(() => configVanActief(s), [s]);
  const [config, zetConfig] = useState<Config>(s.concept?.config ?? vanActief);
  const [open, zetOpen] = useState<string | null>(null);
  const [wissel, zetWissel] = useState<ModelId | null>(null);
  const [controle, zetControle] = useState<Controle | null>(null);
  const [bewaard, zetBewaard] = useState<string | null>(s.concept?.gewijzigd ?? null);
  const [reden, zetReden] = useState("");
  const [m, zetM] = useState<Melding>(null);
  const [bezig, zetBezig] = useState(false);
  const model = cat.modellen[config.basis];
  const gewijzigd = !zelfde(config, vanActief);
  const eerste = useRef(true);

  // Toetsen (en het voorbeeld bijwerken) bij elke wijziging; het concept bewaren als er iets afwijkt.
  useEffect(() => {
    const t1 = setTimeout(() => {
      api<Controle>("POST", "/api/metadatamodel/controle", { config }).then(zetControle, (e) => zetM({ soort: "fout", tekst: foutTekst(e) }));
    }, 250);
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (kan && !eerste.current) {
      t2 = setTimeout(() => {
        const r = gewijzigd ? api<{ bewaard: string }>("PUT", "/api/metadatamodel/concept", { config }).then((x) => zetBewaard(x.bewaard)) : api("DELETE", "/api/metadatamodel/concept").then(() => zetBewaard(null));
        r.catch(() => undefined);
      }, 1200);
    }
    eerste.current = false;
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const zetVeld = (sleutel: string, wijziging: Partial<VeldKeuze>) =>
    zetConfig((c) => ({
      ...c,
      velden: c.velden.map((v) => {
        if (v.sleutel !== sleutel) return v;
        const n = { ...v, ...wijziging };
        if (wijziging.aan === false) n.verplicht = false;
        if (wijziging.verplicht === true) n.aan = true;
        for (const k of ["label", "beschrijving", "waardelijst"] as const) if (n[k] === "") delete n[k];
        return n;
      }),
    }));
  const verplaats = (i: number, d: -1 | 1) =>
    zetConfig((c) => {
      const v = [...c.velden];
      const j = i + d;
      if (j < 0 || j >= v.length) return c;
      [v[i], v[j]] = [v[j]!, v[i]!];
      return { ...c, velden: v };
    });

  const kiesModel = (id: ModelId) => {
    if (id === config.basis) return;
    if (zelfde(config, standaardConfig(model)) || zelfde(config, vanActief)) {
      zetConfig({ ...standaardConfig(cat.modellen[id]), naam: config.naam });
      zetWissel(null);
    } else zetWissel(id);
  };

  const publiceer = async () => {
    zetBezig(true);
    zetM(null);
    try {
      const r = await api<{ versie: number }>("POST", "/api/metadatamodel/publiceer", { config, reden });
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

  const conceptWeg = async () => {
    await api("DELETE", "/api/metadatamodel/concept").catch(() => undefined);
    zetConfig(vanActief);
    zetBewaard(null);
    eerste.current = true;
  };

  const problemen = controle?.problemen ?? [];
  const fouten = problemen.filter((p) => p.ernst === "fout");
  const perVeld = (k: string) => problemen.filter((p) => p.sleutel === k);
  const actiefVersie = s.versies?.find((v) => v.versie === s.actief!.versie);

  return (
    <>
      <Heading1>{tt("titel")}</Heading1>
      <Paragraph className="ab-lead">{tt("intro")}</Paragraph>

      <div className="md-status">
        <div>
          <span className="ab-klein">{tt("nuActief")}</span>
          <div>
            <b>
              {tt("versie")} {s.actief!.versie}
            </b>{" "}
            · {s.actief!.config ? naamVan(s.actief!.config, cat) : tt("standaardmodel")}
            {s.actief!.config?.naam?.trim() && !s.actief!.config.naam.includes(cat.modellen[s.actief!.config.basis].naam) ? ` (${cat.modellen[s.actief!.config.basis].naam})` : ""}
            {actiefVersie && !actiefVersie.gedeeld && actiefVersie.door ? ` · ${tijd(actiefVersie.gepubliceerd)} ${tt("door")} ${actiefVersie.door}` : ""}
          </div>
        </div>
        {gewijzigd && (
          <div className="md-concept">
            <StatusBadge status="warning">{tt("concept")}</StatusBadge>
            {bewaard && <span className="ab-klein"> {tt("bewaard")} {tijd(bewaard)}</span>}
            {kan && <SubtleButton onClick={conceptWeg}>{tt("conceptWeg")}</SubtleButton>}
          </div>
        )}
      </div>
      {!kan && <Alert type="info"><Paragraph>{tt("alleenLezen")}</Paragraph></Alert>}
      <MeldingVak m={m} />

      <div className="md-raster">
        <div className="md-hoofd">
          {/* 1. Basismodel */}
          <section aria-labelledby="md-stap1">
            <Heading2 id="md-stap1">{tt("stap1")}</Heading2>
            <Paragraph className="ab-klein">{tt("stap1Uitleg")}</Paragraph>
            <div className="md-modellen" role="radiogroup" aria-labelledby="md-stap1">
              {MODELLEN.map((id) => {
                const x = cat.modellen[id];
                const gekozen = config.basis === id;
                return (
                  <button key={id} type="button" role="radio" aria-checked={gekozen} aria-label={`${x.naam} ${x.versie}: ${x.voluit}`} aria-describedby={`md-uitleg-${id}`} className={`md-model${gekozen ? " gekozen" : ""}`} disabled={!kan} onClick={() => kiesModel(id)}>
                    <span className="md-model-kop">
                      <b>{x.naam}</b> <span className="ab-klein">{x.versie}</span>
                      {gekozen && <StatusBadge status="success">{tt("gekozen")}</StatusBadge>}
                    </span>
                    <span className="md-model-voluit">{x.voluit}</span>
                    <span className="ab-klein" id={`md-uitleg-${id}`}>{x.uitleg}</span>
                  </button>
                );
              })}
            </div>
            {wissel && (
              <Alert type="warning">
                <Paragraph>{tt("wissel")}</Paragraph>
                <div className="ab-knoppen">
                  <SecondaryActionButton onClick={() => { zetConfig({ ...standaardConfig(cat.modellen[wissel]), naam: config.naam }); zetWissel(null); zetOpen(null); }}>
                    {tt("wisselToch")} ({cat.modellen[wissel].naam})
                  </SecondaryActionButton>
                  <SubtleButton onClick={() => zetWissel(null)}>{tt("klaar")}</SubtleButton>
                </div>
              </Alert>
            )}
            <FormField label={<FormLabel htmlFor="md-naam">{tt("modelnaam")}</FormLabel>} description={tt("modelnaamUitleg")}>
              <Textbox id="md-naam" value={config.naam ?? ""} placeholder={model.naam} maxLength={80} disabled={!kan} onChange={(e) => zetConfig((c) => ({ ...c, naam: e.target.value || undefined }))} />
            </FormField>
          </section>

          {/* 2. Velden */}
          <section aria-labelledby="md-stap2">
            <Heading2 id="md-stap2">{tt("stap2")}</Heading2>
            <Paragraph className="ab-klein">{tt("stap2Uitleg")}</Paragraph>
            <ol className="md-velden">
              {config.velden.map((k, i) => {
                const c = model.velden.find((v) => v.sleutel === k.sleutel);
                const type = k.eigen?.type ?? c?.type ?? "tekst";
                const rol = k.eigen?.rol ?? c?.rol;
                const label = k.label || c?.label || k.sleutel;
                const isOpen = open === k.sleutel;
                const pv = perVeld(k.sleutel);
                return (
                  <li key={k.sleutel} className={`md-veld${k.aan ? "" : " uit"}${isOpen ? " open" : ""}${pv.some((p) => p.ernst === "fout") ? " fout" : ""}`}>
                    <div className="md-veld-regel">
                      <label className="md-vink" title={tt("aan")}>
                        <Checkbox checked={k.aan} disabled={!kan} onChange={(e) => zetVeld(k.sleutel, { aan: e.target.checked })} aria-label={`${label}: ${tt("aan")}`} />
                        <span className="ab-klein">{tt("aan")}</span>
                      </label>
                      <label className="md-vink" title={tt("verplicht")}>
                        <Checkbox checked={k.verplicht} disabled={!kan} onChange={(e) => zetVeld(k.sleutel, { verplicht: e.target.checked })} aria-label={`${label}: ${tt("verplicht")}`} />
                        <span className="ab-klein">{tt("verplicht")}</span>
                      </label>
                      <div className="md-veld-naam">
                        <b>{label}</b>
                        <span className="md-labels">
                          <span className="md-label">{soortNaam(type)}</span>
                          {c && c.element !== "—" && <span className="md-label md-model-label">{model.naam} {c.element}</span>}
                          {c?.aanvulling && <span className="md-label md-aanvulling" title={c.aanvulling}>{tt("aanvulling")}</span>}
                          {k.eigen && <span className="md-label md-eigen">{tt("eigen")}</span>}
                          {rol && <span className="md-label md-rol">{rolNaam(rol)}</span>}
                          {c?.verplichtInModel && <span className="md-label md-verplicht">{tt("verplichtInModel")}</span>}
                          {k.geenCategorie && <span className="md-label">{tt("metGeen")}</span>}
                        </span>
                      </div>
                      <div className="md-veld-knoppen">
                        <SubtleButton disabled={!kan || i === 0} onClick={() => verplaats(i, -1)} aria-label={`${label}: ${tt("omhoog")}`}>↑</SubtleButton>
                        <SubtleButton disabled={!kan || i === config.velden.length - 1} onClick={() => verplaats(i, 1)} aria-label={`${label}: ${tt("omlaag")}`}>↓</SubtleButton>
                        <SubtleButton onClick={() => zetOpen(isOpen ? null : k.sleutel)} aria-expanded={isOpen}>{isOpen ? tt("klaar") : tt("bewerk")}</SubtleButton>
                      </div>
                    </div>
                    {pv.map((p, n) => (
                      <p key={n} className={`md-probleem ${p.ernst}`}>{p.melding}</p>
                    ))}
                    {isOpen && <VeldBewerken k={k} c={c} type={type} kan={kan} cat={cat} zet={(w) => zetVeld(k.sleutel, w)} weg={() => zetConfig((x) => ({ ...x, velden: x.velden.filter((v) => v.sleutel !== k.sleutel) }))} />}
                  </li>
                );
              })}
            </ol>
            {kan && <NieuwVeld bestaand={new Set(config.velden.map((v) => v.sleutel).concat(model.velden.map((v) => v.sleutel)))} cat={cat} voegToe={(v) => { zetConfig((x) => ({ ...x, velden: [...x.velden, v] })); zetOpen(v.sleutel); }} />}
            <details className="md-automatisch">
              <summary>{tt("automatisch")} ({model.automatisch.length})</summary>
              <Paragraph className="ab-klein">{model.automatisch.join(", ")}</Paragraph>
            </details>
          </section>

          {/* 3. Controleren en publiceren */}
          <section aria-labelledby="md-stap3">
            <Heading2 id="md-stap3">{tt("stap3")}</Heading2>
            {controle && (problemen.length === 0 ? (
              <Alert type="ok"><Paragraph>{tt("geenProblemen")}</Paragraph></Alert>
            ) : (
              <ul className="md-problemen">
                {problemen.map((p, n) => (
                  <li key={n} className={p.ernst}>
                    <StatusBadge status={p.ernst === "fout" ? "danger" : "warning"}>{p.ernst}</StatusBadge> {p.melding}
                  </li>
                ))}
              </ul>
            ))}
            <Heading3>{tt("verschil")} {s.actief!.versie}</Heading3>
            <Verschil oud={vanActief} nieuw={config} cat={cat} />
            {kan && (
              <div className="ab-formulier">
                <Paragraph className="ab-klein">{tt("publiceerUitleg")}</Paragraph>
                <RedenVeld id="md-reden" waarde={reden} zet={zetReden} />
                <div>
                  <PrimaryActionButton onClick={publiceer} disabled={bezig || !gewijzigd || fouten.length > 0 || reden.trim().length < 5}>
                    {bezig ? tt("bezig") : tt("publiceren")}
                  </PrimaryActionButton>
                </div>
              </div>
            )}
          </section>

          <Versies versies={s.versies ?? []} cat={cat} kan={kan} neem={(c) => { zetConfig(c); zetOpen(null); }} />
        </div>

        <aside className="md-voorbeeld" aria-labelledby="md-voorbeeld-titel">
          <Heading2 id="md-voorbeeld-titel">{tt("voorbeeld")}</Heading2>
          <p className="ab-klein">{tt("voorbeeldUitleg")}</p>
          <Voorbeeld velden={controle?.velden ?? []} model={`${naamVan(config, cat)} · ${gewijzigd ? tt("versieNieuw") : `${tt("versie")} ${s.actief!.versie}`}`} />
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Onderdelen
// ---------------------------------------------------------------------------

function VeldBewerken({ k, c, type, kan, cat, zet, weg }: {
  k: VeldKeuze;
  c?: CatalogusVeld;
  type: VeldType;
  kan: boolean;
  cat: NonNullable<Stand["catalogus"]>;
  zet: (w: Partial<VeldKeuze>) => void;
  weg: () => void;
}) {
  const id = `md-${k.sleutel}`;
  const lijst = k.waardelijst ?? c?.waardelijst;
  const [opties, zetOpties] = useState((k.eigen?.opties ?? []).join("\n"));
  return (
    <div className="md-bewerk">
      {c && <Paragraph className="ab-klein">{c.beschrijving}{c.aanvulling ? ` ${c.aanvulling}` : ""}</Paragraph>}
      <FormField label={<FormLabel htmlFor={`${id}-label`}>{tt("label")}</FormLabel>} description={c ? `${tt("leegStandaard")} (${c.label})` : undefined}>
        <Textbox id={`${id}-label`} value={k.label ?? ""} placeholder={c?.label} maxLength={100} disabled={!kan} onChange={(e) => zet({ label: e.target.value })} />
      </FormField>
      <FormField label={<FormLabel htmlFor={`${id}-hulp`}>{tt("hulptekst")}</FormLabel>} description={c ? tt("leegStandaard") : undefined}>
        <Textarea id={`${id}-hulp`} value={k.beschrijving ?? ""} placeholder={c?.beschrijving} rows={2} maxLength={500} disabled={!kan} onChange={(e) => zet({ beschrijving: e.target.value })} />
      </FormField>
      {(k.eigen?.rol ?? c?.rol) === "informatiecategorie" && (
        <FormField
          label={
            <label className="cl-vink" htmlFor={`${id}-geen`}>
              <Checkbox id={`${id}-geen`} checked={!!k.geenCategorie} disabled={!kan} onChange={(e) => zet({ geenCategorie: e.target.checked || undefined })} /> {tt("geenCategorie")}
            </label>
          }
          description={tt("geenCategorieUitleg")}
        />
      )}
      {k.eigen && (
        <div className="md-twee">
          <FormField label={<FormLabel htmlFor={`${id}-soort`}>{tt("soort")}</FormLabel>}>
            <Select id={`${id}-soort`} value={k.eigen.type} disabled={!kan} onChange={(e) => zet({ eigen: { ...k.eigen!, type: e.target.value as VeldType } })}>
              {(Object.keys(SOORTNAAM) as VeldType[]).map((s) => <SelectOption key={s} value={s}>{soortNaam(s)}</SelectOption>)}
            </Select>
          </FormField>
          <FormField label={<FormLabel htmlFor={`${id}-rol`}>{tt("rol")}</FormLabel>}>
            <Select id={`${id}-rol`} value={k.eigen.rol ?? ""} disabled={!kan} onChange={(e) => zet({ eigen: { ...k.eigen!, rol: e.target.value || undefined } })}>
              <SelectOption value="">{tt("geenRol")}</SelectOption>
              {cat.rollen.map((r) => <SelectOption key={r} value={r}>{rolNaam(r)}</SelectOption>)}
            </Select>
          </FormField>
          {(k.eigen.type === "tekst" || k.eigen.type === "lange-tekst") && (
            <FormField label={<FormLabel htmlFor={`${id}-max`}>{tt("maxLengte")}</FormLabel>}>
              <Textbox id={`${id}-max`} type="number" min={1} max={10000} value={k.eigen.maxLengte ?? ""} disabled={!kan} onChange={(e) => zet({ eigen: { ...k.eigen!, maxLengte: e.target.value ? Number(e.target.value) : undefined } })} />
            </FormField>
          )}
        </div>
      )}
      {type === "keuze" && (
        <FormField label={<FormLabel htmlFor={`${id}-lijst`}>{tt("waardelijst")}</FormLabel>}>
          <Select id={`${id}-lijst`} value={k.waardelijst ?? (k.eigen ? "" : c?.waardelijst ?? "")} disabled={!kan} onChange={(e) => zet({ waardelijst: e.target.value === c?.waardelijst ? undefined : e.target.value || undefined })}>
            {k.eigen && <SelectOption value="">{tt("eigenKeuzes")}</SelectOption>}
            {Object.values(cat.waardelijsten).map((w) => <SelectOption key={w.id} value={w.id}>{w.naam} ({w.bron})</SelectOption>)}
          </Select>
        </FormField>
      )}
      {type === "keuze" && k.eigen && !k.waardelijst && (
        <FormField label={<FormLabel htmlFor={`${id}-opties`}>{tt("opties")}</FormLabel>}>
          <Textarea id={`${id}-opties`} rows={4} value={opties} disabled={!kan}
            onChange={(e) => { zetOpties(e.target.value); zet({ eigen: { ...k.eigen!, opties: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) } }); }} />
        </FormField>
      )}
      {type === "keuze" && lijst && cat.waardelijsten[lijst] && (
        <p className="ab-klein md-waarden">{cat.waardelijsten[lijst].waarden.join(" · ")}</p>
      )}
      {k.eigen && kan && <div><SubtleButton onClick={weg}>{tt("verwijder")}</SubtleButton></div>}
    </div>
  );
}

function NieuwVeld({ bestaand, cat, voegToe }: { bestaand: Set<string>; cat: NonNullable<Stand["catalogus"]>; voegToe: (v: VeldKeuze) => void }) {
  const [open, zetOpen] = useState(false);
  const [label, zetLabel] = useState("");
  const [sleutel, zetSleutel] = useState("");
  const [eigenSleutel, zetEigenSleutel] = useState(false);
  const [type, zetType] = useState<VeldType>("tekst");
  const s = eigenSleutel ? sleutel : sleutelUit(label);
  const geldig = label.trim().length > 0 && /^[a-z][A-Za-z0-9]{1,39}$/.test(s) && !bestaand.has(s);
  void cat;
  if (!open) return <SecondaryActionButton onClick={() => zetOpen(true)}>+ {tt("nieuwVeld")}</SecondaryActionButton>;
  return (
    <div className="md-nieuw">
      <Heading3>{tt("nieuwVeld")}</Heading3>
      <Paragraph className="ab-klein">{tt("nieuwVeldUitleg")}</Paragraph>
      <div className="md-twee">
        <FormField label={<FormLabel htmlFor="md-nieuw-label">{tt("label")}</FormLabel>}>
          <Textbox id="md-nieuw-label" value={label} maxLength={100} onChange={(e) => zetLabel(e.target.value)} />
        </FormField>
        <FormField label={<FormLabel htmlFor="md-nieuw-soort">{tt("soort")}</FormLabel>}>
          <Select id="md-nieuw-soort" value={type} onChange={(e) => zetType(e.target.value as VeldType)}>
            {(Object.keys(SOORTNAAM) as VeldType[]).map((x) => <SelectOption key={x} value={x}>{soortNaam(x)}</SelectOption>)}
          </Select>
        </FormField>
      </div>
      <FormField label={<FormLabel htmlFor="md-nieuw-sleutel">{tt("sleutel")}</FormLabel>} description={tt("sleutelUitleg")} invalid={!!label && !geldig} errorMessage={!!label && bestaand.has(s) ? `"${s}" ${taal() === "en" ? "already exists" : "bestaat al"}` : undefined}>
        <Textbox id="md-nieuw-sleutel" className="ab-mono" value={s} maxLength={40} onChange={(e) => { zetEigenSleutel(true); zetSleutel(e.target.value); }} />
      </FormField>
      <div className="ab-knoppen">
        <PrimaryActionButton disabled={!geldig} onClick={() => {
          voegToe({ sleutel: s, aan: true, verplicht: false, label: label.trim(), eigen: { type, ...(type === "keuze" ? { opties: [] } : {}) } });
          zetOpen(false); zetLabel(""); zetSleutel(""); zetEigenSleutel(false); zetType("tekst");
        }}>{tt("toevoegen")}</PrimaryActionButton>
        <SubtleButton onClick={() => zetOpen(false)}>{tt("klaar")}</SubtleButton>
      </div>
    </div>
  );
}

/** Wat er verandert ten opzichte van wat nu in gebruik is, in gewone taal. */
function Verschil({ oud, nieuw, cat }: { oud: Config; nieuw: Config; cat: NonNullable<Stand["catalogus"]> }) {
  const regels: string[] = [];
  const naam = (c: Config, k: VeldKeuze) => k.label || cat.modellen[c.basis].velden.find((v) => v.sleutel === k.sleutel)?.label || k.sleutel;
  if (naamVan(oud, cat) !== naamVan(nieuw, cat)) regels.push(`${tt("naamVan")} "${naamVan(oud, cat)}" ${tt("naar")} "${naamVan(nieuw, cat)}".`);
  if (oud.basis !== nieuw.basis) regels.push(`${tt("basisNaar")} ${cat.modellen[oud.basis].naam} ${tt("naar")} ${cat.modellen[nieuw.basis].naam}.`);
  // Bij een ander basismodel: velden met dezelfde betekenis (titel, vertrouwelijkheid …) horen bij elkaar.
  const rolVan = (c: Config, k: VeldKeuze) => k.eigen?.rol ?? cat.modellen[c.basis].velden.find((v) => v.sleutel === k.sleutel)?.rol;
  const naarNieuw = new Map<string, string>();
  if (oud.basis !== nieuw.basis)
    for (const w of oud.velden) {
      const r = rolVan(oud, w);
      const n = r && nieuw.velden.find((v) => rolVan(nieuw, v) === r);
      if (n) naarNieuw.set(n.sleutel, w.sleutel);
    }
  const o = new Map(oud.velden.map((v) => [v.sleutel, v] as const));
  for (const [n, w] of naarNieuw) o.set(n, oud.velden.find((v) => v.sleutel === w)!);
  const gekoppeld = new Set(naarNieuw.values());
  for (const v of nieuw.velden) {
    const w = o.get(v.sleutel);
    if (v.aan && !w?.aan) regels.push(`${naam(nieuw, v)}: ${tt("toegevoegd")}${v.verplicht ? ` (${tt("verplicht").toLowerCase()})` : ""}.`);
    else if (!v.aan && w?.aan) regels.push(`${naam(oud, w)}: ${tt("weggehaald")}.`);
    else if (v.aan && w?.aan) {
      if (v.verplicht !== w.verplicht) regels.push(`${naam(nieuw, v)}: ${v.verplicht ? tt("nuVerplicht") : tt("nietVerplicht")}.`);
      if (!!v.geenCategorie !== !!w.geenCategorie) regels.push(`${naam(nieuw, v)} ${v.geenCategorie ? tt("geenAan") : tt("geenUit")}.`);
      if (naam(oud, w) !== naam(nieuw, v)) regels.push(`${naam(oud, w)} ${tt("andersGenoemd")} "${naam(nieuw, v)}".`);
      const lijst = (c: Config, k: VeldKeuze) => k.waardelijst ?? cat.modellen[c.basis].velden.find((x) => x.sleutel === k.sleutel)?.waardelijst ?? "";
      if (lijst(oud, w) !== lijst(nieuw, v) || !gelijk(v.eigen?.opties ?? [], w.eigen?.opties ?? [])) regels.push(`${naam(nieuw, v)}: ${tt("andereLijst")}.`);
    }
  }
  for (const w of oud.velden) if (w.aan && !gekoppeld.has(w.sleutel) && !nieuw.velden.some((v) => v.sleutel === w.sleutel)) regels.push(`${naam(oud, w)}: ${tt("weggehaald")}.`);
  const volgorde = (c: Config) => c.velden.filter((v) => v.aan).map((v) => v.sleutel).join();
  if (oud.basis === nieuw.basis && regels.every((r) => r.startsWith(tt("naamVan"))) && volgorde(oud) !== volgorde(nieuw)) regels.push(`${tt("volgorde")}.`);
  if (regels.length === 0) return <Paragraph className="ab-klein">{tt("geenVerschil")}</Paragraph>;
  return <ul className="md-verschil">{regels.map((r, i) => <li key={i}>{r}</li>)}</ul>;
}

/** Het paneel Metadateren, zoals de medewerker het straks ziet. */
function Voorbeeld({ velden, model }: { velden: SchemaVeld[]; model: string }) {
  return (
    <div className="md-paneel" aria-hidden="true">
      <div className="md-paneel-kop">Metadateren</div>
      <div className="md-paneel-sub">{taal() === "en" ? "Attributes, and who says so" : "Kenmerken, en wie dat zegt"}</div>
      <div className="md-paneel-model">{model}</div>
      <div className="md-paneel-veld">
        <div className="md-paneel-label">{taal() === "en" ? "Business or personal (required)" : "Zakelijk of persoonlijk (verplicht)"}</div>
        <div className="md-paneel-aard"><span className="aan">{tt("zakelijk")}</span><span>{tt("persoonlijk")}</span></div>
      </div>
      {velden.map((v) => (
        <div key={v.sleutel} className="md-paneel-veld">
          <div className="md-paneel-label">{v.label}{v.verplicht ? (taal() === "en" ? " (required)" : " (verplicht)") : ""}</div>
          {v.beschrijving && <div className="md-paneel-hulp">{v.beschrijving}</div>}
          {v.type === "keuze" ? (
            <div className="md-paneel-invoer keuze">{v.standaard ?? tt("kies")}</div>
          ) : v.type === "lange-tekst" ? (
            <div className="md-paneel-invoer lang" />
          ) : v.type === "datum" ? (
            <div className="md-paneel-invoer datum">dd-mm-jjjj</div>
          ) : (
            <div className="md-paneel-invoer">{v.standaard ?? ""}</div>
          )}
        </div>
      ))}
      <div className="md-paneel-knop">{taal() === "en" ? "Register" : "Registreren"}</div>
    </div>
  );
}

function Versies({ versies, cat, kan, neem }: { versies: Versie[]; cat: NonNullable<Stand["catalogus"]>; kan: boolean; neem: (c: Config) => void }) {
  if (versies.length === 0) return null;
  return (
    <section aria-labelledby="md-versies">
      <Heading2 id="md-versies">{tt("versies")}</Heading2>
      <div className="ab-tabel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{tt("versie")}</TableHeaderCell>
              <TableHeaderCell>{tt("naam")}</TableHeaderCell>
              <TableHeaderCell>{tt("stap1").replace(/^1\. /, "")}</TableHeaderCell>
              <TableHeaderCell>{tt("velden")}</TableHeaderCell>
              <TableHeaderCell>{taal() === "en" ? "Published" : "Gepubliceerd"}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versies.map((v) => (
              <TableRow key={`${v.versie}-${v.gedeeld}`}>
                <TableCell>{v.versie} <span className="ab-klein">({v.gedeeld ? tt("gedeeld") : tt("eigenVersie")})</span></TableCell>
                <TableCell>{v.modelnaam ?? (v.config ? naamVan(v.config, cat) : tt("standaardmodel"))}</TableCell>
                <TableCell>{v.model ? cat.modellen[v.model]?.naam ?? v.model : tt("standaardmodel")}</TableCell>
                <TableCell>{v.velden}</TableCell>
                <TableCell>{tijd(v.gepubliceerd)}{v.door ? ` · ${v.door}` : ""}</TableCell>
                <TableCell>{kan && v.config && <SubtleButton onClick={() => neem(v.config!)}>{tt("alsBasis")}</SubtleButton>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
