import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  BusinessInput,
  AnalysisSchema,
  safeWebsite,
  businessKey,
  type Business,
  type Campaign,
  type Fact,
  type Analysis,
  type Provider,
} from "@lead/contracts";
import { AppError } from "./security.js";
export type Fetcher = typeof fetch;
async function json(
  url: string,
  options: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<any> {
  let r: Response;
  try {
    r = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
  } catch {
    throw new AppError(
      504,
      "The provider did not respond. Check provider usage before starting a new run.",
    );
  }
  if (!r.ok) {
    await r.body?.cancel();
    throw new AppError(
      [401, 403, 429].includes(r.status) ? r.status : 502,
      r.status === 429
        ? "Provider request limit reached. Retry after the provider limit resets."
        : r.status === 401 || r.status === 403
          ? "The provider rejected this key. Replace it in Connections."
          : `Provider request failed (${r.status}). Check provider usage before retrying.`,
    );
  }
  const reader = r.body?.getReader();
  if (!reader) throw new AppError(502, "Provider returned an empty response.");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new AppError(502, "Provider response exceeded the supported size.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new AppError(502, "Provider returned an invalid response.");
  }
}
export function normalizeMaps(data: any, limit: number): Business[] {
  const raw = [
    ...(Array.isArray(data.local_results)
      ? data.local_results
      : Array.isArray(data.local_results?.places)
        ? data.local_results.places
        : []),
  ];
  const unique = new Map<string, Business>();
  for (const row of raw) {
    const parsed = BusinessInput.safeParse({
      name: row.title,
      category: typeof row.type === "string" ? row.type : "",
      address: row.address || "",
      phone: row.phone || "",
      website: safeWebsite(row.website || ""),
      rating: typeof row.rating === "number" ? row.rating : null,
      reviews: typeof row.reviews === "number" ? row.reviews : null,
      placeId: row.place_id || row.data_id || "",
      sourceUrl: row.place_id
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.title || "business")}&query_place_id=${encodeURIComponent(row.place_id)}`
        : "",
    });
    if (parsed.success && !unique.has(businessKey(parsed.data)))
      unique.set(businessKey(parsed.data), parsed.data);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}
export async function searchBusinesses(
  key: string,
  query: string,
  limit: number,
  fetcher?: Fetcher,
) {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: query,
    hl: "en",
    api_key: key,
  }).toString();
  const data = await json(url.href, {}, fetcher);
  if (data.error)
    throw new AppError(
      502,
      "The search provider could not complete this query.",
    );
  return normalizeMaps(data, limit);
}
export function validateAnalysis(
  value: unknown,
  facts: Fact[],
  campaign: Pick<Campaign, "categories" | "locations" | "requiredEvidence">,
): Analysis {
  const result = AnalysisSchema.parse(value);
  const ids = new Set(facts.map((f) => f.id));
  const required = [
    ...(campaign.categories.length ? ["Category"] : []),
    ...(campaign.locations.length ? ["Location"] : []),
    ...campaign.requiredEvidence,
  ];
  if (
    result.assessments.length !== required.length ||
    new Set(result.assessments.map((a) => a.criterion)).size !==
      required.length ||
    result.assessments.some((a) => !required.includes(a.criterion))
  )
    throw new AppError(502, "Analysis did not cover the campaign criteria.");
  for (const a of result.assessments) {
    if (
      a.evidenceIds.some((id) => !ids.has(id)) ||
      (a.result !== "unknown" && !a.evidenceIds.length)
    )
      throw new AppError(502, "Analysis referenced missing evidence.");
  }
  return result;
}
export function publicAddress(address: string): boolean {
  const a = address.toLowerCase();
  if (isIP(a) === 4) {
    const n = a.split(".").map(Number);
    return (
      n[0] !== 0 &&
      n[0] !== 10 &&
      n[0] !== 127 &&
      n[0]! < 224 &&
      !(n[0] === 169 && n[1] === 254) &&
      !(n[0] === 172 && n[1]! >= 16 && n[1]! <= 31) &&
      !(n[0] === 192 && (n[1] === 168 || n[1] === 0)) &&
      !(n[0] === 100 && n[1]! >= 64 && n[1]! <= 127) &&
      !(n[0] === 198 && (n[1] === 18 || n[1] === 19))
    );
  }
  if (isIP(a) === 6)
    return (
      /^[23]/.test(a) && !a.startsWith("2001:db8") && !a.startsWith("2002:")
    );
  return false;
}
export async function websiteTarget(value: string): Promise<string> {
  const url = safeWebsite(value);
  if (!url)
    throw new AppError(400, "This business has no supported website URL.");
  const u = new URL(url);
  if (u.port && u.port !== "443" && u.port !== "80")
    throw new AppError(400, "Only standard website ports are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new AppError(400, "Private network websites are not supported.");
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new AppError(400, "The website hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AppError(400, "Private network websites are not supported.");
  return u.href;
}
export async function enrichWebsite(
  key: string,
  url: string,
  fetcher?: Fetcher,
) {
  const target = await websiteTarget(url);
  const data = await json(
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: target,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    },
    fetcher,
  );
  if (data.success === false || typeof data.data?.markdown !== "string")
    throw new AppError(502, "Website research returned no usable text.");
  return {
    markdown: data.data.markdown.slice(0, 12000) as string,
    url: target,
  };
}
export async function testConnection(
  provider: Provider,
  key: string,
  fetcher?: Fetcher,
) {
  if (provider === "serpapi") {
    const u = new URL("https://serpapi.com/account.json");
    u.searchParams.set("api_key", key);
    const data = await json(u.href, {}, fetcher);
    if (data.error) throw new AppError(502, "The provider rejected this key.");
  } else if (provider === "firecrawl")
    await enrichWebsite(key, "https://example.com", fetcher);
  else throw new AppError(400, "Test this provider through the AI adapter.");
}
