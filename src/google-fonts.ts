// Google Fonts stylesheet urls as written in HTML/CSS: `&` may be HTML-escaped,
// css2 families carry axes (`Roboto:wght@400;700`), the legacy API joins families with `|`

const HTML_AMPERSAND = "&amp;";
const TEXT_PARAM = "text";
const URL_BASE = "https://fonts.googleapis.com";

const toUrl = (raw: string): URL => new URL(raw.replaceAll(HTML_AMPERSAND, "&"), URL_BASE);

export function getGoogleFontFamilies(raw: string): string[] {
  return toUrl(raw)
    .searchParams.getAll("family")
    .flatMap((value) => value.split("|"))
    .map((family) => family.split(":")[0].trim())
    .filter(Boolean);
}

export const getGoogleFontText = (raw: string): string | null =>
  toUrl(raw).searchParams.get(TEXT_PARAM);

// Sets `text=` without re-encoding the rest of the url
export function setGoogleFontText(raw: string, text: string): string {
  const separator = raw.includes(HTML_AMPERSAND) ? HTML_AMPERSAND : "&";
  const queryStart = raw.indexOf("?");
  const base = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const params = queryStart === -1 ? [] : raw.slice(queryStart + 1).split(separator);
  const kept = params.filter((param) => param && !param.startsWith(`${TEXT_PARAM}=`));
  const textParam = new URLSearchParams({ [TEXT_PARAM]: text }).toString();
  return `${base}?${[...kept, textParam].join(separator)}`;
}
