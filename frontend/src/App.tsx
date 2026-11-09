import { useCallback, useEffect, useState, type ReactNode, type MouseEvent } from "react";
import { Alert, Button, Document, Heading1, Link, Paragraph, PrimaryActionButton, SkipLink, Surface } from "@utrecht/component-library-react";
import { api, bijNietIngelogd, type Ik } from "./api";
import { t, tijd, zetTaal } from "./i18n";
import { Dashboard } from "./paginas/Dashboard";
import { Accounts, AccountDetail } from "./paginas/Accounts";
import { Groepen } from "./paginas/Groepen";
import { Audit } from "./paginas/Audit";
import { Instellingen } from "./paginas/Instellingen";
import { Profiel } from "./paginas/Profiel";
import { Nood } from "./paginas/Nood";
import { Metadatamodel } from "./paginas/Metadatamodel";

/** Eenvoudige router op de History-API. */
export function ga(pad: string): void {
  history.pushState(null, "", pad);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function L({ naar, children }: { naar: string; children: ReactNode }) {
  const huidig = location.pathname === naar || (naar !== "/" && location.pathname.startsWith(`${naar}/`));
  return (
    <Link href={naar} aria-current={huidig ? "page" : undefined} onClick={(e: MouseEvent) => { e.preventDefault(); ga(naar); }}>
      {children}
    </Link>
  );
}

function usePad(): string {
  const [pad, zet] = useState(location.pathname);
  useEffect(() => {
    const f = () => zet(location.pathname);
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  return pad;
}

export function App() {
  const pad = usePad();
  const [ik, zetIk] = useState<Ik | null | undefined>(undefined);

  const laad = useCallback(async () => {
    try {
      const i = await api<Ik>("GET", "/api/ik");
      zetTaal(i.taal);
      zetIk(i);
    } catch {
      zetIk(null);
    }
  }, []);

  useEffect(() => {
    bijNietIngelogd(() => zetIk(null));
    laad();
  }, [laad]);

  if (pad === "/emergency") return <Thema><Nood klaar={() => { ga("/"); laad(); }} /></Thema>;
  if (ik === undefined) return <Thema><Paragraph className="ab-smal">{t("laden")}</Paragraph></Thema>;
  if (ik === null) return <Thema><Aanmelden /></Thema>;

  const r = new Set(ik.rechten);
  const uitloggen = async () => {
    const { doorsturen } = await api<{ doorsturen: string }>("POST", "/api/auth/uitloggen");
    location.href = doorsturen;
  };

  let inhoud: ReactNode;
  if (pad === "/") inhoud = <Dashboard ik={ik} />;
  else if (pad === "/accounts" && r.has("accounts.view")) inhoud = <Accounts ik={ik} />;
  else if (pad.startsWith("/accounts/") && r.has("accounts.view")) inhoud = <AccountDetail ik={ik} id={pad.split("/")[2]} />;
  else if (pad === "/groepen") inhoud = <Groepen ik={ik} />;
  else if (pad === "/audit" && r.has("audit.view")) inhoud = <Audit />;
  else if (pad === "/instellingen" && (r.has("settings.view") || r.has("settings.manage"))) inhoud = <Instellingen ik={ik} />;
  else if (pad === "/metadatamodel" && (r.has("metadata.view") || r.has("metadata.manage"))) inhoud = <Metadatamodel ik={ik} />;
  else if (pad === "/profiel") inhoud = <Profiel ik={ik} opnieuw={laad} />;
  else inhoud = <Alert type="warning"><Paragraph>{t("geenRecht")}</Paragraph></Alert>;

  return (
    <Thema>
      <div className="ab-pagina">
        <SkipLink href="#inhoud">{t("overslaan")}</SkipLink>
        {ik.nood && <div className="ab-nood" role="status">{t("nood")} {tijd(ik.sessieEinde)}</div>}
        <header className="ab-kop">
          <span className="ab-kop-titel">{t("titel")}</span>
          <span className="ab-kop-wie">
            <span>{ik.naam} · {t("niveau")} {ik.niveau}</span>
            <Button appearance="secondary-action-button" onClick={uitloggen}>{t("uitloggen")}</Button>
          </span>
        </header>
        <nav className="ab-nav" aria-label={t("titel")}>
          <L naar="/">{t("dashboard")}</L>
          {r.has("accounts.view") && <L naar="/accounts">{t("accounts")}</L>}
          {(r.has("groups.view") || r.has("groups.manage") || r.has("accounts.manage")) && <L naar="/groepen">{t("groepen")}</L>}
          {r.has("audit.view") && <L naar="/audit">{t("audit")}</L>}
          {(r.has("metadata.view") || r.has("metadata.manage")) && <L naar="/metadatamodel">{t("metadatamodel")}</L>}
          {(r.has("settings.view") || r.has("settings.manage")) && <L naar="/instellingen">{t("instellingen")}</L>}
          <L naar="/profiel">{t("profiel")}</L>
        </nav>
        <main id="inhoud" className="ab-inhoud" key={pad}>{inhoud}</main>
      </div>
    </Thema>
  );
}

function Thema({ children }: { children: ReactNode }) {
  return (
    <Surface className="haarlem-theme">
      <Document>{children}</Document>
    </Surface>
  );
}

function Aanmelden() {
  const fout = new URLSearchParams(location.search).get("fout");
  const terug = location.pathname === "/" ? "/" : location.pathname;
  return (
    <main className="ab-smal">
      <Heading1>{t("titel")}</Heading1>
      {fout && <Alert type="error"><Paragraph>{t("inloggenMislukt")}</Paragraph></Alert>}
      <Paragraph>{t("inloggenUitleg")}</Paragraph>
      <PrimaryActionButton onClick={() => { location.href = `/api/auth/inloggen?terug=${encodeURIComponent(terug)}`; }}>{t("inloggen")}</PrimaryActionButton>
    </main>
  );
}
