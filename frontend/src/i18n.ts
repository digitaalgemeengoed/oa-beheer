/** Teksten in het Nederlands en het Engels. De taal komt uit het profiel, anders uit de browser. */
export type Taal = "nl" | "en";

const T = {
  titel: ["Beheer Office Assistent", "Office Assistant admin"],
  inloggen: ["Inloggen", "Sign in"],
  inloggenUitleg: ["Log in met je account van de gemeente. Je krijgt opnieuw de vraag om je wachtwoord en je code.", "Sign in with your municipality account. You will be asked for your password and code again."],
  inloggenMislukt: ["Inloggen is niet gelukt. Heb je toegang tot dit portaal? Vraag het je beheerder.", "Signing in did not work. Do you have access to this portal? Ask your administrator."],
  uitloggen: ["Uitloggen", "Sign out"],
  dashboard: ["Overzicht", "Dashboard"],
  accounts: ["Accounts", "Accounts"],
  groepen: ["Groepen", "Groups"],
  audit: ["Audit", "Audit trail"],
  instellingen: ["Instellingen", "Settings"],
  metadatamodel: ["Metadatamodel", "Metadata model"],
  profiel: ["Profiel", "Profile"],
  niveau: ["Niveau", "Clearance"],
  nood: ["Noodtoegang. Deze sessie eindigt om", "Emergency access. This session ends at"],
  noodTitel: ["Noodtoegang", "Emergency access"],
  noodUitleg: ["Alleen voor het hoofdaccount, als gewoon inloggen niet kan. Elk gebruik wordt vastgelegd en gemeld aan de superadmins.", "Only for the master account, when the normal sign-in is not possible. Every use is recorded and reported to the superadmins."],
  wachtwoord: ["Wachtwoord", "Password"],
  totp: ["Code uit de authenticator-app", "Code from the authenticator app"],
  reden: ["Reden", "Reason"],
  redenUitleg: ["Minstens vijf tekens; komt in de audit.", "At least five characters; goes into the audit trail."],
  redenNood: ["Waarom is noodtoegang nodig? Minstens tien tekens.", "Why is emergency access needed? At least ten characters."],
  geweigerd: ["Dat is niet gelukt.", "That did not work."],
  opslaan: ["Opslaan", "Save"],
  annuleren: ["Annuleren", "Cancel"],
  nieuw: ["Nieuw", "New"],
  naam: ["Naam", "Name"],
  email: ["E-mailadres", "Email address"],
  taal: ["Taal", "Language"],
  status: ["Status", "Status"],
  actief: ["actief", "active"],
  geblokkeerd: ["geblokkeerd", "blocked"],
  gedeactiveerd: ["gedeactiveerd", "deactivated"],
  laatstActief: ["Laatst actief", "Last active"],
  gepland: ["gepland", "scheduled"],
  hoofdaccount: ["hoofdaccount", "master account"],
  accountNieuw: ["Account toevoegen", "Add account"],
  accountUitleg: ["De persoon logt in via Keycloak met dit e-mailadres en krijgt een uitnodiging per e-mail.", "The person signs in through Keycloak with this email address and receives an invitation by email."],
  statusWijzigen: ["Status wijzigen", "Change status"],
  ingang: ["Ingang (leeg = nu)", "Takes effect (empty = now)"],
  overalUitloggen: ["Overal uitloggen", "Sign out everywhere"],
  geschiedenis: ["Geschiedenis", "History"],
  groepenWijzigen: ["Groepen wijzigen", "Change groups"],
  nietBeheerbaar: ["Dit account kun je niet wijzigen.", "You cannot change this account."],
  rechten: ["Rechten", "Permissions"],
  omschrijving: ["Omschrijving", "Description"],
  superadmin: ["Superadmin", "Superadmin"],
  leden: ["Leden", "Members"],
  verwijderen: ["Verwijderen", "Delete"],
  groepNieuw: ["Groep toevoegen", "Add group"],
  filteren: ["Filteren", "Filter"],
  wie: ["Wie (e-mail)", "Who (email)"],
  actie: ["Actie", "Action"],
  resultaat: ["Resultaat", "Result"],
  tijd: ["Tijd", "Time"],
  meer: ["Meer laden", "Load more"],
  keten: ["Keten controleren", "Verify chain"],
  ketenIntact: ["De auditketen is intact.", "The audit chain is intact."],
  ketenGebroken: ["De auditketen is gebroken bij gebeurtenis", "The audit chain is broken at event"],
  gecontroleerd: ["gebeurtenissen gecontroleerd; laatste hash", "events verified; latest hash"],
  apparaten: ["Mijn apparaten", "My devices"],
  ditApparaat: ["dit apparaat", "this device"],
  afmelden: ["Afmelden", "Sign out"],
  wachtwoordWijzigen: ["Wachtwoord en tweestapsverificatie wijzigen (Keycloak)", "Change password and two-factor authentication (Keycloak)"],
  opgeslagen: ["Opgeslagen.", "Saved."],
  geenRecht: ["Daarvoor heb je geen recht.", "You do not have permission for that."],
  laden: ["Laden…", "Loading…"],
  waarde: ["Waarde", "Value"],
  standaard: ["standaard", "default"],
  ja: ["ja", "yes"],
  nee: ["nee", "no"],
  terug: ["Terug", "Back"],
  overslaan: ["Naar de inhoud", "Skip to content"],
  vandaag: ["Gebeurtenissen in de laatste 24 uur", "Events in the last 24 hours"],
  mislukt: ["Mislukte aanmeldingen in de laatste 24 uur", "Failed sign-ins in the last 24 hours"],
  noodWeek: ["Gebruik van noodtoegang in de laatste week", "Emergency access used in the last week"],
  actieveSessies: ["Actieve sessies", "Active sessions"],
  geplandeWijzigingen: ["Geplande statuswijzigingen", "Scheduled status changes"],
  lijstUitleg: ["Eén per regel.", "One per line."],
} as const;

export type Sleutel = keyof typeof T;

let huidig: Taal = (navigator.language ?? "nl").startsWith("nl") ? "nl" : "en";

export function zetTaal(t: Taal): void {
  huidig = t;
  document.documentElement.lang = t;
}

export function taal(): Taal {
  return huidig;
}

export function t(s: Sleutel): string {
  return T[s][huidig === "nl" ? 0 : 1];
}

export function tijd(w: string | null | undefined): string {
  if (!w) return "—";
  return new Intl.DateTimeFormat(huidig === "nl" ? "nl-NL" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(w));
}
