/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// A config engine's icon is a blob URL, which only resolves in the process that
// created it, so a `<moz-urlbar>` in a content document takes it as a data URL.

"use strict";

// An identifier the packaged icon records cover, so the engine has an icon.
const ENGINE_WITH_ICON = "wikipedia";

add_setup(async function () {
  await SearchTestUtils.updateRemoteSettingsConfig([
    { identifier: "default" },
    { identifier: ENGINE_WITH_ICON, base: { aliases: [ENGINE_WITH_ICON] } },
  ]);

  let engine = SearchService.getEngineById(ENGINE_WITH_ICON);
  let iconUrl = await engine.getIconURL();
  Assert.ok(
    iconUrl?.startsWith("blob:"),
    "The engine's icon is a blob URL in the parent process"
  );
});

// The list of token alias engines "@" opens.
add_task(async function tokenAliasList() {
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();

  await NewtabSearchbarTestUtils.promiseAutocompleteResultPopup({
    browser: tab.linkedBrowser,
    value: "@",
  });
  let icon = await NewtabSearchbarTestUtils.waitForRowIcon(
    tab.linkedBrowser,
    ENGINE_WITH_ICON,
    { notSrc: UrlbarShared.ICON.SEARCH_GLASS }
  );

  Assert.ok(icon.src.startsWith("data:"), "The page gets a data URL");
  Assert.ok(icon.loaded, "The icon loaded");

  BrowserTestUtils.removeTab(tab);
});

// The autofilled row a partially typed token alias produces.
add_task(async function tokenAliasAutofill() {
  let tab = await NewtabSearchbarTestUtils.openNewTabPage();

  await NewtabSearchbarTestUtils.promiseAutocompleteResultPopup({
    browser: tab.linkedBrowser,
    value: `@${ENGINE_WITH_ICON.slice(0, 3)}`,
  });
  let icon = await NewtabSearchbarTestUtils.waitForRowIcon(
    tab.linkedBrowser,
    ENGINE_WITH_ICON,
    { notSrc: UrlbarShared.ICON.SEARCH_GLASS }
  );

  Assert.ok(icon.src.startsWith("data:"), "The page gets a data URL");
  Assert.ok(icon.loaded, "The icon loaded");

  BrowserTestUtils.removeTab(tab);
});
