/**
 * The filter lists and engine settings of Moon Browser's built-in blocker.
 *
 * The lists are uBlock Origin's own lists plus EasyList, EasyPrivacy and
 * Peter Lowe's list — "unbiased" in Helium's words: no "acceptable ads"
 * exceptions for anyone. They are fetched from the Ghostery adblocker's
 * mirror of the upstream lists, which the engine is tested against.
 */
const MIRROR =
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets";

export interface FilterList {
  name: string;
  url: string;
  annoyance?: boolean;
}

export const FILTER_LISTS: readonly FilterList[] = [
  { name: "uBlock filters", url: `${MIRROR}/ublock-origin/filters.txt` },
  { name: "uBlock filters – 2020", url: `${MIRROR}/ublock-origin/filters-2020.txt` },
  { name: "uBlock filters – 2021", url: `${MIRROR}/ublock-origin/filters-2021.txt` },
  { name: "uBlock filters – 2022", url: `${MIRROR}/ublock-origin/filters-2022.txt` },
  { name: "uBlock filters – 2023", url: `${MIRROR}/ublock-origin/filters-2023.txt` },
  { name: "uBlock filters – 2024", url: `${MIRROR}/ublock-origin/filters-2024.txt` },
  { name: "uBlock filters – Privacy", url: `${MIRROR}/ublock-origin/privacy.txt` },
  { name: "uBlock filters – Badware risks", url: `${MIRROR}/ublock-origin/badware.txt` },
  { name: "uBlock filters – Resource abuse", url: `${MIRROR}/ublock-origin/resource-abuse.txt` },
  { name: "uBlock filters – Quick fixes", url: `${MIRROR}/ublock-origin/quick-fixes.txt` },
  { name: "uBlock filters – Unbreak", url: `${MIRROR}/ublock-origin/unbreak.txt` },
  { name: "EasyList", url: `${MIRROR}/easylist/easylist.txt` },
  { name: "EasyPrivacy", url: `${MIRROR}/easylist/easyprivacy.txt` },
  { name: "Peter Lowe's list", url: `${MIRROR}/peter-lowe/serverlist.txt` },
  { name: "EasyList Cookie", url: `${MIRROR}/easylist/easylist-cookie.txt`, annoyance: true },
  {
    name: "uBlock filters – Cookie notices",
    url: `${MIRROR}/ublock-origin/annoyances-cookies.txt`,
    annoyance: true,
  },
  {
    name: "uBlock filters – Other annoyances",
    url: `${MIRROR}/ublock-origin/annoyances-others.txt`,
    annoyance: true,
  },
];

/**
 * Moon Browser's own fixes, after the lists. Bump the version when they
 * change: cached engines without them are then rebuilt at once.
 */
export const MOON_FIXES_ID = "moon-fixes:1";
export const MOON_FIXES = [
  // Netflix's player stops with error NSES-UHX when its own logging requests
  // fail. uBlock Origin blocks them but fakes their success with a scriptlet
  // (no-fetch-if), which in Moon Browser can come too late; let them through.
  "@@||netflix.com/log/$xhr,ping,other",
  "@@||logs.netflix.com^$xhr,ping,other",
  "@@||netflix.com/ichnaea/log$xhr,ping,other",
  "@@||netflix.com/msl/playapi/cadmium/logblob/$xhr,ping,other",
].join("\n");

/** Redirect resources and scriptlets (uBlock Origin's resources). */
export const RESOURCES_URL = `${MIRROR}/ublock-origin/resources.json`;

export function listsFor(annoyances: boolean): FilterList[] {
  return FILTER_LISTS.filter((l) => annoyances || !l.annoyance);
}

export const ENGINE_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadCSPFilters: true,
  loadExceptionFilters: true,
  loadPreprocessors: true,
  enableMutationObserver: true,
  enableHtmlFiltering: false,
  loadExtendedSelectors: false,
  guessRequestTypeFromUrl: false,
  enableCompression: false,
  integrityCheck: true,
};
