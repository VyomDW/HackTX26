import { env } from "../env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** SerpApi Google search. Server-side only so the key never reaches the client. */
export async function search(query: string): Promise<SearchResult[]> {
  if (!env.serpApiKey) throw new Error("search: SERPAPI_KEY is not set");
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", env.serpApiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search: SerpApi returned ${res.status}`);
  const data = (await res.json()) as { organic_results?: { title: string; link: string; snippet?: string }[] };
  return (data.organic_results ?? []).slice(0, 5).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
}
