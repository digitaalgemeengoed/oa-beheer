import { useState, type FormEvent } from "react";
import {
  Alert, FormField, FormLabel, Heading1, Paragraph, PrimaryActionButton, SecondaryActionButton,
  Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textbox,
} from "@utrecht/component-library-react";
import { api } from "../api";
import { t, tijd } from "../i18n";
import { foutTekst } from "./gedeeld";

interface Gebeurtenis { id: number; tijd: string; email: string | null; actie: string; doel: string | null; ip: string | null; resultaat: string; details: Record<string, unknown> }

export function Audit() {
  const [filter, zetFilter] = useState({ wie: "", actie: "", resultaat: "", ip: "" });
  const [rijen, zetRijen] = useState<Gebeurtenis[]>([]);
  const [volgende, zetVolgende] = useState<number | null>(null);
  const [controle, zetControle] = useState<{ intact: boolean; gebrokenBij: number | null; gecontroleerd: number; laatsteHash: string } | null>(null);
  const [fout, zetFout] = useState<string | null>(null);

  const laad = async (voor?: number) => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, w]) => w));
    if (voor) q.set("voor", String(voor));
    try {
      const r = await api<{ gebeurtenissen: Gebeurtenis[]; volgende: number | null }>("GET", `/api/audit?${q}`);
      zetRijen(voor ? [...rijen, ...r.gebeurtenissen] : r.gebeurtenissen);
      zetVolgende(r.volgende);
    } catch (x) {
      zetFout(foutTekst(x));
    }
  };
  const zoek = (e: FormEvent) => {
    e.preventDefault();
    laad();
  };

  return (
    <>
      <Heading1>{t("audit")}</Heading1>
      {fout && <Alert type="error"><Paragraph>{fout}</Paragraph></Alert>}
      <form className="ab-filters" onSubmit={zoek}>
        {(["wie", "actie", "resultaat", "ip"] as const).map((k) => (
          <FormField key={k} label={<FormLabel htmlFor={`f-${k}`}>{k === "ip" ? "IP" : t(k)}</FormLabel>}>
            <Textbox id={`f-${k}`} value={filter[k]} maxLength={254} onChange={(e) => zetFilter({ ...filter, [k]: e.target.value })} />
          </FormField>
        ))}
        <div className="ab-knoppen">
          <PrimaryActionButton type="submit">{t("filteren")}</PrimaryActionButton>
          <SecondaryActionButton type="button" onClick={async () => zetControle(await api("GET", "/api/audit/controle"))}>{t("keten")}</SecondaryActionButton>
        </div>
      </form>
      {controle && (
        <Alert type={controle.intact ? "ok" : "error"}>
          <Paragraph>{controle.intact ? t("ketenIntact") : `${t("ketenGebroken")} ${controle.gebrokenBij}.`}</Paragraph>
          <Paragraph className="ab-mono">{controle.gecontroleerd} {t("gecontroleerd")}: {controle.laatsteHash}</Paragraph>
        </Alert>
      )}
      <div className="ab-tabel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("tijd")}</TableHeaderCell>
              <TableHeaderCell>{t("wie")}</TableHeaderCell>
              <TableHeaderCell>{t("actie")}</TableHeaderCell>
              <TableHeaderCell>{t("resultaat")}</TableHeaderCell>
              <TableHeaderCell>IP</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rijen.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{tijd(g.tijd)}</TableCell>
                <TableCell>{g.email ?? "—"}</TableCell>
                <TableCell className="ab-mono">{g.actie}{g.doel ? ` · ${g.doel}` : ""}{Object.keys(g.details).length ? <div className="ab-klein">{JSON.stringify(g.details)}</div> : null}</TableCell>
                <TableCell>{g.resultaat}</TableCell>
                <TableCell className="ab-mono">{g.ip ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {volgende && <SecondaryActionButton onClick={() => laad(volgende)}>{t("meer")}</SecondaryActionButton>}
    </>
  );
}
