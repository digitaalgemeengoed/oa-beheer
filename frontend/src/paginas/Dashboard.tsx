import { Heading1, Heading2, Paragraph } from "@utrecht/component-library-react";
import { api, type Ik } from "../api";
import { t } from "../i18n";
import { useLaden } from "./gedeeld";

interface Overzicht {
  niveau: number;
  accounts?: { status: string; n: number }[];
  gepland?: number;
  audit?: { vandaag: number; mislukt: number; nood_week: number };
  actieveSessies?: number;
}

function Kaart({ titel, getal }: { titel: string; getal: number | string }) {
  return (
    <div className="ab-kaart">
      <div className="ab-kaart-getal">{getal}</div>
      <div>{titel}</div>
    </div>
  );
}

/** Wat je ziet, hangt af van je niveau en je rechten. */
export function Dashboard({ ik }: { ik: Ik }) {
  const { data } = useLaden(() => api<Overzicht>("GET", "/api/dashboard"));
  return (
    <>
      <Heading1>{t("dashboard")}</Heading1>
      <Paragraph>{ik.naam} · {t("niveau")} {ik.niveau}{ik.superadmin ? ` · ${t("superadmin")}` : ""}</Paragraph>
      {data?.accounts && (
        <>
          <Heading2>{t("accounts")}</Heading2>
          <div className="ab-kaarten">
            {data.accounts.map((a) => <Kaart key={a.status} titel={t(a.status as "actief")} getal={a.n} />)}
            {data.gepland !== undefined && <Kaart titel={t("geplandeWijzigingen")} getal={data.gepland} />}
            {data.actieveSessies !== undefined && <Kaart titel={t("actieveSessies")} getal={data.actieveSessies} />}
          </div>
        </>
      )}
      {data?.audit && (
        <>
          <Heading2>{t("audit")}</Heading2>
          <div className="ab-kaarten">
            <Kaart titel={t("vandaag")} getal={data.audit.vandaag} />
            <Kaart titel={t("mislukt")} getal={data.audit.mislukt} />
            <Kaart titel={t("noodWeek")} getal={data.audit.nood_week} />
          </div>
        </>
      )}
    </>
  );
}
