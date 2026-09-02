/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// The newtab address bar is its own search access point, so its searches are
// recorded under `newtab_searchbar` and against the newtab visit the bar sits
// in.

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  SearchSERPTelemetry:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
  SearchSERPTelemetryUtils:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
});

ChromeUtils.defineLazyGetter(this, "SearchUITestUtils", () => {
  let { SearchUITestUtils: module } = ChromeUtils.importESModule(
    "resource://testing-common/SearchUITestUtils.sys.mjs"
  );
  module.init(this);
  return module;
});

const SUGGEST_URL =
  "https://example.com/browser/browser/components/urlbar/tests/browser-newtab/richSuggestionEngine.sjs";

// A page the SERP telemetry below recognizes, carrying two ad links.
const SERP_URL =
  "https://example.org/browser/browser/components/urlbar/tests/browser-newtab/searchTelemetryAd.html";

const TEST_PROVIDER_INFO = [
  {
    telemetryId: "example",
    searchPageRegexp: new RegExp(`^${SERP_URL}`),
    queryParamNames: ["s"],
    codeParamName: "abc",
    taggedCodes: ["ff"],
    extraAdServersRegexps: [/^https:\/\/example\.com\/ad/],
    components: [
      {
        type: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
        default: true,
      },
    ],
  },
];

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtabpage.activity-stream.telemetry", true]],
  });
  await SearchTestUtils.installSearchExtension(
    {
      search_url: SERP_URL,
      search_url_get_params: "s={searchTerms}&abc=ff",
      suggest_url: SUGGEST_URL,
      suggest_url_get_params: "query={searchTerms}",
    },
    { setAsDefault: true }
  );

  SearchSERPTelemetry.overrideSearchTelemetryForTests(TEST_PROVIDER_INFO);
  registerCleanupFunction(() => {
    SearchSERPTelemetry.overrideSearchTelemetryForTests();
    resetTelemetry();
  });
});

add_task(async function searchIssued() {
  resetTelemetry();
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();
  let browser = tab.linkedBrowser;
  let visitId = await promiseVisitId(browser);

  let pingSubmitted = false;
  GleanPings.newtab.testBeforeNextSubmit(() => {
    pingSubmitted = true;
    let records = Glean.newtabSearch.issued.testGetValue("newtab");
    Assert.equal(records?.length, 1, "One search was issued");
    Assert.deepEqual(
      records[0].extra,
      {
        newtab_visit_id: visitId,
        search_access_point: "newtab_searchbar",
        telemetry_id: "other-Example",
      },
      "The search was recorded against the newtab visit"
    );
  });

  await search(browser);

  await TestUtils.waitForCondition(
    () => pingSubmitted,
    "Waiting for the newtab ping carrying the search"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function plainQuery() {
  resetTelemetry();
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();
  let browser = tab.linkedBrowser;

  await search(browser);

  await assertSAPTelemetry("search_enter");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function pickedSuggestion() {
  resetTelemetry();
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();
  let browser = tab.linkedBrowser;

  await search(browser, async () => {
    let index =
      await NewtabSearchbarTestUtils.promiseSuggestionsPresent(browser);
    await NewtabSearchbarTestUtils.setSelectedRowIndex(browser, index);
  });

  await assertSAPTelemetry("search_suggestion");

  BrowserTestUtils.removeTab(tab);
});

// The SERP a search from the bar loads reports the bar as its source, and its
// ads report the newtab visit the search came from, impressions and clicks
// alike.
add_task(async function serpTelemetry() {
  resetTelemetry();
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();
  let browser = tab.linkedBrowser;
  let visitId = await promiseVisitId(browser);

  let adImpression = TestUtils.topicObserved(
    "reported-page-with-ad-impressions"
  );
  await search(browser);
  await adImpression;

  let impressions = Glean.serp.impression.testGetValue() ?? [];
  Assert.equal(impressions.length, 1, "The SERP reported one impression");
  Assert.equal(
    impressions[0].extra.source,
    "newtab_searchbar",
    "The impression carries the bar as its source"
  );

  let adImpressions = Glean.newtabSearchAd.impression.testGetValue() ?? [];
  Assert.equal(adImpressions.length, 1, "The ads reported one impression");
  Assert.deepEqual(
    adImpressions[0].extra,
    {
      newtab_visit_id: visitId,
      search_access_point: "newtab_searchbar",
      is_follow_on: "false",
      is_tagged: "true",
      telemetry_id: "example",
    },
    "The ad impression was recorded against the newtab visit"
  );

  let loaded = BrowserTestUtils.waitForLocationChange(gBrowser);
  BrowserTestUtils.synthesizeMouseAtCenter("#ad1", {}, browser);
  await loaded;

  let adClicks = await TestUtils.waitForCondition(
    () => Glean.newtabSearchAd.click.testGetValue(),
    "Waiting for the ad click to be recorded"
  );
  Assert.equal(adClicks.length, 1, "The ad reported one click");
  Assert.deepEqual(
    adClicks[0].extra,
    {
      newtab_visit_id: visitId,
      search_access_point: "newtab_searchbar",
      is_follow_on: "false",
      is_tagged: "true",
      telemetry_id: "example",
    },
    "The ad click was recorded against the newtab visit"
  );

  BrowserTestUtils.removeTab(tab);
});

/**
 * Waits for the newtab visit id of the page a browser is showing.
 *
 * @param {MozBrowser} browser
 *   The browser showing the newtab page.
 * @returns {Promise<string>}
 */
function promiseVisitId(browser) {
  return TestUtils.waitForCondition(
    () => AboutNewTab.getVisitId(browser),
    "Waiting for the page's newtab visit id"
  );
}

/**
 * Searches from the newtab address bar and waits for the load.
 *
 * @param {MozBrowser} browser
 *   The browser showing the newtab page.
 * @param {Function} [beforePicking]
 *   Called once the results are in, to select a row other than the heuristic.
 */
async function search(browser, beforePicking) {
  await NewtabSearchbarTestUtils.promiseAutocompleteResultPopup({
    browser,
    value: "hello",
  });
  await beforePicking?.();

  let loaded = BrowserTestUtils.browserLoaded(browser);
  await BrowserTestUtils.synthesizeKey("KEY_Enter", {}, browser);
  await loaded;
}

/**
 * Asserts the search access point telemetry of one search.
 *
 * @param {string} action
 *   The navigation metric's label for how the search was made.
 */
async function assertSAPTelemetry(action) {
  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "Example",
    source: "newtab_searchbar",
    count: 1,
  });
  Assert.equal(
    Glean.browserEngagementNavigation.newtabSearchbar[action].testGetValue(),
    1,
    `The search was counted as ${action} under the SAP's navigation metric`
  );
}

function resetTelemetry() {
  TelemetryTestUtils.getAndClearKeyedHistogram("SEARCH_COUNTS");
  Services.fog.testResetFOG();
}
