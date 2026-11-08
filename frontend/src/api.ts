/**
 * Alle aanroepen naar de API. Wijzigende verzoeken altijd met een JSON-body:
 * de server eist Content-Type application/json en de eigen Origin (die zet
 * de browser zelf).
 */
export class ApiFout extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    melding: string,
  ) {
    super(melding);
  }
}

let bijUitgelogd: () => void = () => {};
export function bijNietIngelogd(f: () => void): void {
  bijUitgelogd = f;
}

export async function api<T>(methode: "GET" | "POST" | "PUT" | "DELETE", pad: string, lijf?: unknown): Promise<T> {
  const r = await fetch(pad, {
    method: methode,
    credentials: "same-origin",
    headers: methode === "GET" ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: methode === "GET" ? undefined : JSON.stringify(lijf ?? {}),
  });
  const j = (await r.json().catch(() => ({}))) as { fout?: string; melding?: string };
  if (r.status === 401 && pad !== "/api/nood/inloggen") bijUitgelogd();
  if (!r.ok) throw new ApiFout(r.status, j.fout ?? "fout", j.melding ?? `Fout ${r.status}`);
  return j as T;
}

export interface Ik {
  id: string;
  email: string;
  naam: string;
  taal: "nl" | "en";
  rechten: string[];
  niveau: number;
  superadmin: boolean;
  nood: boolean;
  sessieEinde: string | null;
}
