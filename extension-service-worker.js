// Toolbar button: open OoFR, or bring the tab that already shows it to the front.
// Two open copies would each hold the whole state and overwrite one another's changes.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("index.html");
  try {
    const contexts = (await chrome.runtime.getContexts?.({ contextTypes: ["TAB"] })) || [];
    const existing = contexts.find((context) => String(context.documentUrl || "").startsWith(url) && context.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // Fall through: opening a new tab is always a safe answer.
  }
  await chrome.tabs.create({ url });
});
