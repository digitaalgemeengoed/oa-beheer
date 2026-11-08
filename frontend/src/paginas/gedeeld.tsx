import { useEffect, useState } from "react";
import { Alert, FormField, FormLabel, Paragraph, Textarea } from "@utrecht/component-library-react";
import { ApiFout } from "../api";
import { t } from "../i18n";

export type Melding = { soort: "ok" | "fout"; tekst: string } | null;

export function MeldingVak({ m }: { m: Melding }) {
  if (!m) return null;
  return <Alert type={m.soort === "ok" ? "ok" : "error"}><Paragraph>{m.tekst}</Paragraph></Alert>;
}

export function foutTekst(e: unknown): string {
  if (e instanceof ApiFout) return e.code === "verzoek-ongeldig" ? `${t("geweigerd")} (${t("redenUitleg")})` : e.message;
  return t("geweigerd");
}

export function RedenVeld({ id, waarde, zet, uitleg }: { id: string; waarde: string; zet: (s: string) => void; uitleg?: string }) {
  return (
    <FormField label={<FormLabel htmlFor={id}>{t("reden")}</FormLabel>} description={uitleg ?? t("redenUitleg")}>
      <Textarea id={id} value={waarde} rows={2} maxLength={1000} required onChange={(e) => zet(e.target.value)} />
    </FormField>
  );
}

/** Laadt gegevens; opnieuw met herlaad(). */
export function useLaden<T>(laad: () => Promise<T>): { data: T | null; fout: string | null; herlaad: () => void } {
  const [data, zet] = useState<T | null>(null);
  const [fout, zetFout] = useState<string | null>(null);
  const [teller, zetTeller] = useState(0);
  useEffect(() => {
    laad().then(zet, (e) => zetFout(foutTekst(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teller]);
  return { data, fout, herlaad: () => zetTeller((n) => n + 1) };
}
