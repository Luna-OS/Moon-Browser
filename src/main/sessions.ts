/**
 * The request pipeline of a browsing session. Electron allows one listener
 * per webRequest event, so HTTPS-first, the blocker, Global Privacy Control
 * and third-party cookie blocking share these three.
 */
import { app, type OnBeforeRequestListenerDetails, type Session } from "electron";
import { httpsUpgrade } from "@shared/https";
import { stripTrackingParams } from "@shared/security";
import { isThirdParty } from "@shared/sites";
import type { Browser } from "./browser";
import { adblockPreload } from "./paths";
import { handleInternalProtocol } from "./protocol";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The URL of the frame a request comes from, if it is still around. */
function frameUrl(details: OnBeforeRequestListenerDetails): string | null {
  try {
    return details.frame?.url || null;
  } catch {
    return null;
  }
}

/** Spell checking on or off; on Linux, languages decide whether dictionaries are fetched. */
export function applySpellcheck(ses: Session, enabled: boolean): void {
  ses.setSpellCheckerEnabled(enabled);
  if (process.platform === "linux") {
    const languages = enabled
      ? app
          .getPreferredSystemLanguages()
          .filter((l) => ses.availableSpellCheckerLanguages.includes(l))
          .slice(0, 3)
      : [];
    ses.setSpellCheckerLanguages(languages.length || !enabled ? languages : ["en-US"]);
  }
}

export function configureBrowsingSession(browser: Browser, ses: Session, isPrivate: boolean): void {
  handleInternalProtocol(ses, { ui: false });
  browser.permissions.install(ses, isPrivate);
  browser.downloads.install(ses, isPrivate);
  ses.registerPreloadScript({ type: "frame", filePath: adblockPreload });
  applySpellcheck(ses, browser.settings.spellcheck);

  ses.webRequest.onBeforeRequest((details, callback) => {
    const tab =
      details.webContentsId !== undefined ? browser.tabFor(details.webContentsId) : undefined;

    if (details.resourceType === "mainFrame") {
      if (!tab) {
        callback({});
        return;
      }
      const settings = browser.settings;
      let url = details.url;

      // 1. HTTPS first — and never a silent step back to HTTP.
      if (settings.httpsFirst && url.startsWith("http:")) {
        const host = hostOf(url);
        const previous = browser.upgraded.get(tab.id);
        if (previous && previous.host === host && Date.now() - previous.time < 15_000) {
          // The site sent us from HTTPS back to HTTP: ask before going on.
          browser.upgraded.delete(tab.id);
          tab.failNext({ kind: "https", code: -20, description: "HTTPS_DOWNGRADE", url });
          callback({ cancel: true });
          return;
        }
        const upgraded = httpsUpgrade(url, browser.httpsExceptions);
        if (upgraded) {
          browser.upgraded.set(tab.id, { host, time: Date.now() });
          url = upgraded;
        }
      }

      if (browser.siteProtected(url)) {
        // 2. Click IDs and campaign tags go before the page sees them.
        if (settings.stripTrackingParams) url = stripTrackingParams(url) ?? url;

        // 3. Pages on the lists of dangerous and tracking hosts.
        if (settings.adblock && !browser.shieldExceptions.has(hostOf(url))) {
          const rule = browser.adblock.pageBlockRule(url);
          if (rule) {
            tab.failNext({
              kind: "blocked",
              code: -20,
              description: "BLOCKED_BY_MOON_SHIELD",
              url,
              rule,
            });
            callback({ cancel: true });
            return;
          }
        }
      }

      callback(url !== details.url ? { redirectURL: url } : {});
      return;
    }

    if (!tab || !browser.protectionActive(tab.url)) {
      callback({});
      return;
    }
    const decision = browser.adblock.match(
      details.url,
      details.resourceType,
      frameUrl(details) ?? tab.url,
    );
    if (decision) {
      tab.countBlocked();
      callback(decision);
      return;
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    const settings = browser.settings;
    if (settings.globalPrivacyControl) headers["Sec-GPC"] = "1";
    if (settings.blockThirdPartyCookies && details.resourceType !== "mainFrame") {
      const tab =
        details.webContentsId !== undefined ? browser.tabFor(details.webContentsId) : undefined;
      if (tab && browser.protectionActive(tab.url) && isThirdParty(details.url, tab.url)) {
        delete headers.Cookie;
        delete headers.cookie;
      }
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const tab =
      details.webContentsId !== undefined ? browser.tabFor(details.webContentsId) : undefined;
    const isDocument = details.resourceType === "mainFrame";
    // For a new document, the page it belongs to is the document itself.
    const topUrl = isDocument ? details.url : tab?.url;
    if (!tab || !topUrl || !browser.protectionActive(topUrl)) {
      callback({});
      return;
    }
    const headers = details.responseHeaders ?? {};
    let changed = false;

    if (
      !isDocument &&
      browser.settings.blockThirdPartyCookies &&
      isThirdParty(details.url, topUrl)
    ) {
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "set-cookie") {
          delete headers[name];
          changed = true;
        }
      }
    }

    if (isDocument || details.resourceType === "subFrame") {
      const csp = browser.adblock.cspFor(details.url, details.resourceType, topUrl);
      if (csp) {
        const existing = Object.keys(headers).find(
          (n) => n.toLowerCase() === "content-security-policy",
        );
        const value = existing ? [...headers[existing], csp] : [csp];
        if (existing) delete headers[existing];
        headers["Content-Security-Policy"] = value;
        changed = true;
      }
    }

    callback(changed ? { responseHeaders: headers } : {});
  });
}
