# Luma for iPhone and iPad

The desktop Luma is built on Electron and Chromium, which do not run on iOS. This is its sibling: a native
SwiftUI app on WebKit (`WKWebView`) with the same night-sky look, search engines, bangs and privacy defaults.

## Build

You need a Mac with Xcode 16 or newer.

```sh
brew install xcodegen
cd ios
xcodegen generate        # writes Luma.xcodeproj from project.yml
open Luma.xcodeproj
```

Pick the **Luma** scheme and a simulator, then Run. For a real iPhone or iPad, choose your team under
_Signing & Capabilities_ (a free Apple ID is enough for your own devices; TestFlight and the App Store need the
paid Apple Developer Program).

The project file is generated and not checked in — after adding or removing files, run `xcodegen generate` again.

## TestFlight

The **iOS TestFlight** workflow (started by hand under _Actions_) signs the app and uploads it to TestFlight —
no Mac and no cable needed. It wants an app record for the bundle ID `io.lunaos.moonbrowser.ios` in App Store
Connect and four repository secrets:

| Secret          | What                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| `ASC_KEY_ID`    | Key ID of an App Store Connect API key (role Admin, so it may sign in the cloud)  |
| `ASC_ISSUER_ID` | Issuer ID shown above the list of API keys                                       |
| `ASC_KEY_P8`    | The whole content of the downloaded `AuthKey_….p8` file                          |
| `APPLE_TEAM_ID` | The team ID from the developer account's membership page                         |

## What is where

| Folder               | What                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `Luma/App`           | The app's entry point                                                                 |
| `Luma/Core`          | Settings, theme, search engines, bangs, the address bar's logic, moon phase            |
| `Luma/Data`          | Bookmarks and history                                                                 |
| `Luma/Shield`        | Luma Shield: turns the filter lists into WebKit content-blocker rules                  |
| `Luma/Browser`       | Tabs, the web view and its delegates, downloads, favicons                              |
| `Luma/UI`            | The browser itself: iPhone and iPad layouts, tab switcher, new tab page                |
| `Luma/Pages`         | Bookmarks, history, downloads, settings                                               |
| `LumaTests`          | Unit tests                                                                            |

## What differs from the desktop

- **WebKit instead of Chromium.** Apple requires it for browsers on iOS (outside the EU's alternative-engine
  program).
- **No Chrome extensions**, no Widevine build of its own — protected content plays through WebKit's FairPlay.
- **Luma Shield** uses WebKit's content-blocker rules: network and cosmetic filters from the same lists as the
  desktop, without the scriptlets uBlock Origin's lists also contain.
- **Default browser.** iOS only offers an app as default browser when it carries Apple's
  `com.apple.developer.web-browser` entitlement, which is
  [requested from Apple](https://developer.apple.com/documentation/xcode/preparing-your-app-to-be-the-default-browser)
  per developer account. Once granted, add it to the target's entitlements; the URL schemes are already declared.
