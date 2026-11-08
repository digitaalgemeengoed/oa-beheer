import { useState } from "react";
import { FormField, FormLabel, Heading1, Heading2, Paragraph, PrimaryActionButton, Select, SelectOption, Textarea, Textbox } from "@utrecht/component-library-react";
import { api, type Ik } from "../api";
import { t, taal, tijd } from "../i18n";
import { foutTekst, MeldingVak, RedenVeld, useLaden, type Melding } from "./gedeeld";

interface Instelling { sleutel: string; type: "geheel" | "boolean" | "tekst" | "lijst" | "tijdzone"; waarde: unknown; standaard: unknown; minimum: number | null; maximum: number | null; omschrijving: { nl: string; en: string }; gewijzigd: string | null }

export function Instellingen({ ik }: { ik: Ik }) {
  const lijst = useLaden(() => api<Instelling[]>("GET", "/api/instellingen"));
  const kan = ik.rechten.includes("settings.manage");
  return (
    <>
      <Heading1>{t("instellingen")}</Heading1>
      {lijst.fout && <MeldingVak m={{ soort: "fout", tekst: lijst.fout }} />}
      {lijst.data?.map((i) => <Regel key={i.sleutel} i={i} kan={kan} klaar={lijst.herlaad} />)}
    </>
  );
}

function naarTekst(i: Instelling, w: unknown): string {
  return i.type === "lijst" ? (w as string[]).join("\n") : String(w);
}

function Regel({ i, kan, klaar }: { i: Instelling; kan: boolean; klaar: () => void }) {
  const [waarde, zet] = useState(naarTekst(i, i.waarde));
  const [reden, zetReden] = useState("");
  const [m, zetM] = useState<Melding>(null);
  const id = `i-${i.sleutel.replace(/\W/g, "-")}`;
  const opslaan = async () => {
    const w = i.type === "geheel" ? Number(waarde) : i.type === "boolean" ? waarde === "true" : i.type === "lijst" ? waarde.split("\n").map((x) => x.trim()).filter(Boolean) : waarde;
    try {
      await api("PUT", `/api/instellingen/${i.sleutel}`, { waarde: w, reden });
      zetM({ soort: "ok", tekst: t("opgeslagen") });
      zetReden("");
      klaar();
    } catch (x) {
      zetM({ soort: "fout", tekst: foutTekst(x) });
    }
  };
  const bereik = i.minimum !== null ? ` (${i.minimum}–${i.maximum})` : "";
  return (
    <section className="ab-formulier">
      <Heading2 className="ab-mono">{i.sleutel}</Heading2>
      <Paragraph>{i.omschrijving[taal()]}</Paragraph>
      <MeldingVak m={m} />
      <FormField label={<FormLabel htmlFor={id}>{t("waarde")}{bereik}</FormLabel>} description={`${t("standaard")}: ${naarTekst(i, i.standaard) || "—"}${i.gewijzigd ? ` · ${tijd(i.gewijzigd)}` : ""}${i.type === "lijst" ? ` · ${t("lijstUitleg")}` : ""}`}>
        {i.type === "boolean" ? (
          <Select id={id} value={waarde} disabled={!kan} onChange={(e) => zet(e.target.value)}>
            <SelectOption value="true">{t("ja")}</SelectOption>
            <SelectOption value="false">{t("nee")}</SelectOption>
          </Select>
        ) : i.type === "lijst" ? (
          <Textarea id={id} rows={3} value={waarde} disabled={!kan} onChange={(e) => zet(e.target.value)} />
        ) : (
          <Textbox id={id} type={i.type === "geheel" ? "number" : "text"} min={i.minimum ?? undefined} max={i.maximum ?? undefined} value={waarde} disabled={!kan} onChange={(e) => zet(e.target.value)} />
        )}
      </FormField>
      {kan && (
        <>
          <RedenVeld id={`${id}-reden`} waarde={reden} zet={zetReden} />
          <div><PrimaryActionButton onClick={opslaan}>{t("opslaan")}</PrimaryActionButton></div>
        </>
      )}
    </section>
  );
}
