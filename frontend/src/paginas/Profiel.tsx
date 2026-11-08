import { useState, type FormEvent } from "react";
import { FormField, FormLabel, Heading1, Heading2, Link, Paragraph, PrimaryActionButton, SecondaryActionButton, Select, SelectOption, StatusBadge, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textbox } from "@utrecht/component-library-react";
import { api, type Ik } from "../api";
import { t, tijd, zetTaal } from "../i18n";
import { foutTekst, MeldingVak, useLaden, type Melding } from "./gedeeld";

interface ProfielData { naam: string; email: string; taal: "nl" | "en"; wachtwoordWijzigen: string | null; apparaten: { id: string; apparaat: string; ip: string; aangemaakt: string; laatst_actief: string; ditApparaat: boolean; nood: boolean }[] }

export function Profiel({ ik, opnieuw }: { ik: Ik; opnieuw: () => void }) {
  const p = useLaden(() => api<ProfielData>("GET", "/api/profiel"));
  const [v, zet] = useState({ naam: ik.naam, taal: ik.taal });
  const [m, zetM] = useState<Melding>(null);
  const opslaan = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("PUT", "/api/profiel", v);
      zetTaal(v.taal);
      opnieuw();
    } catch (x) {
      zetM({ soort: "fout", tekst: foutTekst(x) });
    }
  };
  const afmelden = async (id: string) => {
    try {
      await api("POST", `/api/profiel/apparaten/${id}/uitloggen`);
      p.herlaad();
    } catch (x) {
      zetM({ soort: "fout", tekst: foutTekst(x) });
    }
  };
  return (
    <>
      <Heading1>{t("profiel")}</Heading1>
      <MeldingVak m={m} />
      <Paragraph>{ik.email}</Paragraph>
      {!ik.nood && (
        <form className="ab-formulier" onSubmit={opslaan}>
          <FormField label={<FormLabel htmlFor="p-naam">{t("naam")}</FormLabel>}>
            <Textbox id="p-naam" required maxLength={200} value={v.naam} onChange={(e) => zet({ ...v, naam: e.target.value })} />
          </FormField>
          <FormField label={<FormLabel htmlFor="p-taal">{t("taal")}</FormLabel>}>
            <Select id="p-taal" value={v.taal} onChange={(e) => zet({ ...v, taal: e.target.value as "nl" | "en" })}>
              <SelectOption value="nl">Nederlands</SelectOption>
              <SelectOption value="en">English</SelectOption>
            </Select>
          </FormField>
          <div><PrimaryActionButton type="submit">{t("opslaan")}</PrimaryActionButton></div>
        </form>
      )}
      {p.data?.wachtwoordWijzigen && <Paragraph><Link href={p.data.wachtwoordWijzigen} rel="noopener noreferrer">{t("wachtwoordWijzigen")}</Link></Paragraph>}
      <Heading2>{t("apparaten")}</Heading2>
      <div className="ab-tabel">
        <Table>
          <TableHeader>
            <TableRow><TableHeaderCell>{t("apparaten")}</TableHeaderCell><TableHeaderCell>IP</TableHeaderCell><TableHeaderCell>{t("laatstActief")}</TableHeaderCell><TableHeaderCell>{t("afmelden")}</TableHeaderCell></TableRow>
          </TableHeader>
          <TableBody>
            {p.data?.apparaten.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.apparaat} {a.ditApparaat && <StatusBadge status="safe">{t("ditApparaat")}</StatusBadge>}</TableCell>
                <TableCell className="ab-mono">{a.ip}</TableCell>
                <TableCell>{tijd(a.laatst_actief)}</TableCell>
                <TableCell>{!a.ditApparaat && <SecondaryActionButton onClick={() => afmelden(a.id)}>{t("afmelden")}</SecondaryActionButton>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
