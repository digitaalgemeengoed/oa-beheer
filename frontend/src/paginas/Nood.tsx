import { useState, type FormEvent } from "react";
import { Alert, FormField, FormLabel, Heading1, Paragraph, PrimaryActionButton, Textarea, Textbox } from "@utrecht/component-library-react";
import { api } from "../api";
import { t } from "../i18n";
import { foutTekst } from "./gedeeld";

/** /emergency: niet gelinkt. Wachtwoord, TOTP-code en reden. */
export function Nood({ klaar }: { klaar: () => void }) {
  const [wachtwoord, zetW] = useState("");
  const [totp, zetT] = useState("");
  const [reden, zetR] = useState("");
  const [fout, zetFout] = useState<string | null>(null);
  const [bezig, zetBezig] = useState(false);
  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    zetBezig(true);
    zetFout(null);
    try {
      await api("POST", "/api/nood/inloggen", { wachtwoord, totp, reden });
      zetW("");
      klaar();
    } catch (x) {
      zetFout(foutTekst(x));
    } finally {
      zetBezig(false);
    }
  };
  return (
    <main className="ab-smal">
      <Heading1>{t("noodTitel")}</Heading1>
      <Paragraph>{t("noodUitleg")}</Paragraph>
      {fout && <Alert type="error"><Paragraph>{fout}</Paragraph></Alert>}
      <form className="ab-formulier" onSubmit={verstuur}>
        <FormField label={<FormLabel htmlFor="w">{t("wachtwoord")}</FormLabel>}>
          <Textbox id="w" type="password" autoComplete="current-password" value={wachtwoord} required maxLength={200} onChange={(e) => zetW(e.target.value)} />
        </FormField>
        <FormField label={<FormLabel htmlFor="c">{t("totp")}</FormLabel>}>
          <Textbox id="c" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totp} required onChange={(e) => zetT(e.target.value.replace(/\D/g, ""))} />
        </FormField>
        <FormField label={<FormLabel htmlFor="r">{t("reden")}</FormLabel>} description={t("redenNood")}>
          <Textarea id="r" rows={3} minLength={10} maxLength={1000} value={reden} required onChange={(e) => zetR(e.target.value)} />
        </FormField>
        <div><PrimaryActionButton type="submit" disabled={bezig}>{t("inloggen")}</PrimaryActionButton></div>
      </form>
    </main>
  );
}
