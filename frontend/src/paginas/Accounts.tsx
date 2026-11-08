import { useState, type FormEvent } from "react";
import {
  Checkbox, FormField, FormLabel, Heading1, Heading2, Paragraph, PrimaryActionButton, SecondaryActionButton, Select, SelectOption,
  StatusBadge, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textbox,
} from "@utrecht/component-library-react";
import { api, type Ik } from "../api";
import { t, tijd } from "../i18n";
import { L } from "../App";
import { foutTekst, MeldingVak, RedenVeld, useLaden, type Melding } from "./gedeeld";

interface AccountRij { id: string; email: string; naam: string; status: string; hoofdaccount: boolean; niveau: number; groepen: string[]; laatst_actief: string | null; gepland: number; beheerbaar: boolean }
interface GroepRij { id: string; naam: string; niveau: number; toewijsbaar: boolean }

const STATUSKLEUR: Record<string, "safe" | "warning" | "danger"> = { actief: "safe", geblokkeerd: "danger", gedeactiveerd: "warning" };

export function Accounts({ ik }: { ik: Ik }) {
  const lijst = useLaden(() => api<AccountRij[]>("GET", "/api/accounts"));
  const [nieuw, zetNieuw] = useState(false);
  return (
    <>
      <Heading1>{t("accounts")}</Heading1>
      {ik.rechten.includes("accounts.manage") && !nieuw && <SecondaryActionButton onClick={() => zetNieuw(true)}>{t("accountNieuw")}</SecondaryActionButton>}
      {nieuw && <NieuwAccount klaar={() => { zetNieuw(false); lijst.herlaad(); }} />}
      {lijst.fout && <MeldingVak m={{ soort: "fout", tekst: lijst.fout }} />}
      <div className="ab-tabel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("naam")}</TableHeaderCell>
              <TableHeaderCell>{t("email")}</TableHeaderCell>
              <TableHeaderCell>{t("status")}</TableHeaderCell>
              <TableHeaderCell>{t("niveau")}</TableHeaderCell>
              <TableHeaderCell>{t("groepen")}</TableHeaderCell>
              <TableHeaderCell>{t("laatstActief")}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lijst.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.hoofdaccount ? <>{a.naam} <StatusBadge status="neutral">{t("hoofdaccount")}</StatusBadge></> : <L naar={`/accounts/${a.id}`}>{a.naam}</L>}</TableCell>
                <TableCell>{a.email}</TableCell>
                <TableCell><StatusBadge status={STATUSKLEUR[a.status]}>{t(a.status as "actief")}</StatusBadge>{a.gepland > 0 && <> <StatusBadge status="warning">{t("gepland")}</StatusBadge></>}</TableCell>
                <TableCell>{a.niveau || "—"}</TableCell>
                <TableCell>{a.groepen.join(", ") || "—"}</TableCell>
                <TableCell>{tijd(a.laatst_actief)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function GroepKeuze({ geselecteerd, zet }: { geselecteerd: string[]; zet: (g: string[]) => void }) {
  const groepen = useLaden(() => api<GroepRij[]>("GET", "/api/groepen"));
  return (
    <fieldset className="ab-vinkjes">
      <legend>{t("groepen")}</legend>
      {groepen.data?.map((g) => (
        <label key={g.id}>
          <Checkbox
            checked={geselecteerd.includes(g.id)}
            disabled={!g.toewijsbaar}
            onChange={(e) => zet(e.target.checked ? [...geselecteerd, g.id] : geselecteerd.filter((x) => x !== g.id))}
          />
          {g.naam} ({t("niveau")} {g.niveau})
        </label>
      ))}
    </fieldset>
  );
}

function NieuwAccount({ klaar }: { klaar: () => void }) {
  const [v, zet] = useState({ email: "", naam: "", taal: "nl" as "nl" | "en", groepen: [] as string[], reden: "" });
  const [m, zetM] = useState<Melding>(null);
  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("POST", "/api/accounts", v);
      klaar();
    } catch (x) {
      zetM({ soort: "fout", tekst: foutTekst(x) });
    }
  };
  return (
    <form className="ab-formulier" onSubmit={verstuur}>
      <Heading2>{t("accountNieuw")}</Heading2>
      <Paragraph>{t("accountUitleg")}</Paragraph>
      <MeldingVak m={m} />
      <FormField label={<FormLabel htmlFor="n-email">{t("email")}</FormLabel>}>
        <Textbox id="n-email" type="email" required maxLength={254} value={v.email} onChange={(e) => zet({ ...v, email: e.target.value })} />
      </FormField>
      <FormField label={<FormLabel htmlFor="n-naam">{t("naam")}</FormLabel>}>
        <Textbox id="n-naam" required maxLength={200} value={v.naam} onChange={(e) => zet({ ...v, naam: e.target.value })} />
      </FormField>
      <FormField label={<FormLabel htmlFor="n-taal">{t("taal")}</FormLabel>}>
        <Select id="n-taal" value={v.taal} onChange={(e) => zet({ ...v, taal: e.target.value as "nl" | "en" })}>
          <SelectOption value="nl">Nederlands</SelectOption>
          <SelectOption value="en">English</SelectOption>
        </Select>
      </FormField>
      <GroepKeuze geselecteerd={v.groepen} zet={(groepen) => zet({ ...v, groepen })} />
      <RedenVeld id="n-reden" waarde={v.reden} zet={(reden) => zet({ ...v, reden })} />
      <div className="ab-knoppen">
        <PrimaryActionButton type="submit">{t("opslaan")}</PrimaryActionButton>
        <SecondaryActionButton type="button" onClick={klaar}>{t("annuleren")}</SecondaryActionButton>
      </div>
    </form>
  );
}

interface AccountDetailData extends AccountRij {
  groepen: never;
  actieveSessies: number;
  wijzigingen: { status: string; reden: string; ingang: string; uitgevoerd: string | null; door: string }[];
}

export function AccountDetail({ ik, id }: { ik: Ik; id: string }) {
  const a = useLaden(() => api<Omit<AccountDetailData, "groepen"> & { groepen: { id: string; naam: string }[] }>("GET", `/api/accounts/${id}`));
  const [m, zetM] = useState<Melding>(null);
  const [status, zetStatus] = useState({ status: "geblokkeerd", ingang: "", reden: "" });
  const [groepen, zetGroepen] = useState<string[] | null>(null);
  const [groepReden, zetGroepReden] = useState("");
  const [uitReden, zetUitReden] = useState("");
  const kan = ik.rechten.includes("accounts.manage") && a.data?.beheerbaar;

  const doe = async (f: () => Promise<unknown>) => {
    try {
      await f();
      zetM({ soort: "ok", tekst: t("opgeslagen") });
      a.herlaad();
    } catch (x) {
      zetM({ soort: "fout", tekst: foutTekst(x) });
    }
  };
  if (!a.data) return <Paragraph>{a.fout ?? t("laden")}</Paragraph>;
  const huidigeGroepen = groepen ?? a.data.groepen.map((g) => g.id);

  return (
    <>
      <Paragraph><L naar="/accounts">← {t("terug")}</L></Paragraph>
      <Heading1>{a.data.naam}</Heading1>
      <Paragraph>{a.data.email} · <StatusBadge status={STATUSKLEUR[a.data.status]}>{t(a.data.status as "actief")}</StatusBadge> · {t("niveau")} {a.data.niveau || "—"} · {t("actieveSessies")}: {a.data.actieveSessies}</Paragraph>
      <MeldingVak m={m} />
      {!kan && <Paragraph>{t("nietBeheerbaar")}</Paragraph>}
      {kan && (
        <>
          <form className="ab-formulier" onSubmit={(e) => { e.preventDefault(); doe(() => api("PUT", `/api/accounts/${id}/groepen`, { groepen: huidigeGroepen, reden: groepReden })); }}>
            <Heading2>{t("groepenWijzigen")}</Heading2>
            <GroepKeuze geselecteerd={huidigeGroepen} zet={zetGroepen} />
            <RedenVeld id="g-reden" waarde={groepReden} zet={zetGroepReden} />
            <div><PrimaryActionButton type="submit">{t("opslaan")}</PrimaryActionButton></div>
          </form>
          <form className="ab-formulier" onSubmit={(e) => { e.preventDefault(); doe(() => api("POST", `/api/accounts/${id}/status`, { status: status.status, reden: status.reden, ...(status.ingang ? { ingang: new Date(status.ingang).toISOString() } : {}) })); }}>
            <Heading2>{t("statusWijzigen")}</Heading2>
            <FormField label={<FormLabel htmlFor="s-status">{t("status")}</FormLabel>}>
              <Select id="s-status" value={status.status} onChange={(e) => zetStatus({ ...status, status: e.target.value })}>
                {["actief", "geblokkeerd", "gedeactiveerd"].map((s) => <SelectOption key={s} value={s}>{t(s as "actief")}</SelectOption>)}
              </Select>
            </FormField>
            <FormField label={<FormLabel htmlFor="s-ingang">{t("ingang")}</FormLabel>}>
              <Textbox id="s-ingang" type="datetime-local" value={status.ingang} onChange={(e) => zetStatus({ ...status, ingang: e.target.value })} />
            </FormField>
            <RedenVeld id="s-reden" waarde={status.reden} zet={(reden) => zetStatus({ ...status, reden })} />
            <div><PrimaryActionButton type="submit">{t("opslaan")}</PrimaryActionButton></div>
          </form>
          <form className="ab-formulier" onSubmit={(e) => { e.preventDefault(); doe(() => api("POST", `/api/accounts/${id}/uitloggen`, { reden: uitReden })); }}>
            <Heading2>{t("overalUitloggen")}</Heading2>
            <RedenVeld id="u-reden" waarde={uitReden} zet={zetUitReden} />
            <div><SecondaryActionButton type="submit">{t("overalUitloggen")}</SecondaryActionButton></div>
          </form>
        </>
      )}
      <Heading2>{t("geschiedenis")}</Heading2>
      <div className="ab-tabel">
        <Table>
          <TableHeader>
            <TableRow><TableHeaderCell>{t("ingang")}</TableHeaderCell><TableHeaderCell>{t("status")}</TableHeaderCell><TableHeaderCell>{t("reden")}</TableHeaderCell><TableHeaderCell>{t("wie")}</TableHeaderCell></TableRow>
          </TableHeader>
          <TableBody>
            {a.data.wijzigingen.map((w, i) => (
              <TableRow key={i}>
                <TableCell>{tijd(w.ingang)}{!w.uitgevoerd && <> <StatusBadge status="warning">{t("gepland")}</StatusBadge></>}</TableCell>
                <TableCell>{t(w.status as "actief")}</TableCell>
                <TableCell>{w.reden}</TableCell>
                <TableCell>{w.door}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
