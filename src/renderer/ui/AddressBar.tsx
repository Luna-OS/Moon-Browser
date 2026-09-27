import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { SuggestResult } from "@shared/api";
import { isNewTabUrl } from "@shared/internal";
import { displayUrl } from "@shared/display";
import type { Suggestion, TabInfo } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import {
  BookmarksIcon,
  GlobeIcon,
  InfoIcon,
  LockIcon,
  MoonIcon,
  PuzzleIcon,
  SearchIcon,
  StarIcon,
  TabIcon,
  WarningIcon,
} from "@theme/icons";
import { onUiEvent, ui } from "./store";

/** The address as shown while editing: complete, nothing for the new tab page. */
function editableUrl(tab: TabInfo | undefined): string {
  if (!tab || isNewTabUrl(tab.url)) return "";
  return tab.url;
}

export function AddressBar({
  tab,
  engineName,
  bookmarked,
  onDropdownChange,
}: {
  tab: TabInfo | undefined;
  engineName: string;
  bookmarked: boolean;
  onDropdownChange: (open: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  /** What the user typed; null while not editing, then the bar follows the tab. */
  const [draft, setDraft] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [tabId, setTabId] = useState(tab?.id);
  const typed = useRef("");
  const pendingSelection = useRef<[number, number] | null>(null);

  // A new active tab ends any editing.
  if (tab?.id !== tabId) {
    setTabId(tab?.id);
    setDraft(null);
    setResult(null);
  }

  const edited = draft !== null;
  const text = draft ?? (focused ? editableUrl(tab) : tab ? displayUrl(tab.url) : "");

  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && input.current) {
      input.current.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  });

  const focusAndSelect = useCallback(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.select());
  }, []);

  useEffect(
    () =>
      onUiEvent((event) => {
        if (event.type === "focusAddressBar") focusAndSelect();
      }),
    [focusAndSelect],
  );

  const open = focused && edited && !!result && result.suggestions.length > 0 && text.trim() !== "";
  useEffect(() => onDropdownChange(open), [open, onDropdownChange]);

  const reset = () => {
    setDraft(null);
    setResult(null);
    setSelected(0);
  };

  const go = (suggestion: Suggestion | null, newTab: boolean) => {
    const disposition = newTab ? "foreground" : "current";
    if (suggestion?.kind === "tab" && suggestion.tabId !== undefined) {
      void ui.command({ type: "activate", tabId: suggestion.tabId });
    } else if (suggestion && suggestion.kind !== "go" && suggestion.kind !== "search") {
      void ui.command({ type: "openUrl", url: suggestion.url, disposition });
    } else if (text.trim()) {
      void ui.command({ type: "navigate", input: text, disposition });
    } else {
      return;
    }
    reset();
    input.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = result?.suggestions.length ?? 0;
    switch (event.key) {
      case "ArrowDown":
        if (open) {
          event.preventDefault();
          setSelected((s) => (s + 1) % count);
        }
        break;
      case "ArrowUp":
        if (open) {
          event.preventDefault();
          setSelected((s) => (s - 1 + count) % count);
        }
        break;
      case "Enter": {
        event.preventDefault();
        const pick = open && selected > 0 ? (result?.suggestions[selected] ?? null) : null;
        go(pick, event.altKey);
        break;
      }
      case "Escape":
        event.preventDefault();
        if (edited) {
          reset();
          focusAndSelect();
        } else {
          input.current?.blur();
          void ui.command({ type: "focusPage" });
        }
        break;
      case "Delete":
        if (open && selected > 0 && event.shiftKey) event.preventDefault();
        break;
    }
  };

  const onChange = (value: string, inputType: string | undefined) => {
    typed.current = value;
    setDraft(value);
    setSelected(0);
    setAnchor(box.current?.getBoundingClientRect() ?? null);
    if (!value.trim()) {
      setResult(null);
      return;
    }
    void ui.suggest(value).then((r) => {
      if (typed.current !== value) return;
      setResult(r);
      const el = input.current;
      const atEnd = el && el.selectionStart === value.length && el.selectionEnd === value.length;
      if (r.inline && inputType?.startsWith("insert") && atEnd) {
        setDraft(value + r.inline);
        pendingSelection.current = [value.length, value.length + r.inline.length];
      }
    });
  };

  const security = tab?.security;
  const showSite = !focused && !!tab && !isNewTabUrl(tab.url);
  const siteIcon =
    focused || !tab || isNewTabUrl(tab.url) ? (
      <SearchIcon size={14} />
    ) : security === "secure" ? (
      <LockIcon size={13} />
    ) : security === "insecure" || security === "error" ? (
      <WarningIcon size={13} />
    ) : security === "internal" ? (
      <MoonIcon size={13} />
    ) : security === "extension" ? (
      <PuzzleIcon size={13} />
    ) : (
      <InfoIcon size={13} />
    );
  const siteTitle =
    security === "secure"
      ? "Connection is secure"
      : security === "insecure"
        ? "Not secure: this page is loaded over plain HTTP"
        : security === "internal"
          ? "Moon Browser page"
          : security === "extension"
            ? "A page of an extension"
            : security === "error"
              ? "The page could not be loaded"
              : "Local page";

  const [host, rest] = splitDisplay(text);
  const rect = anchor;

  return (
    <>
      <div
        ref={box}
        className="mb-omnibox"
        onMouseDown={(e) => e.target === box.current && focusAndSelect()}
      >
        <span
          className="mb-site-chip"
          data-security={focused ? undefined : security}
          title={focused ? undefined : siteTitle}
        >
          {siteIcon}
        </span>
        <div className="relative flex h-full min-w-0 flex-1 items-center">
          <input
            ref={input}
            className={showSite && !edited ? "mb-omnibox-hidden" : undefined}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-label="Address and search bar"
            aria-expanded={open}
            aria-controls="mb-suggestions"
            role="combobox"
            aria-autocomplete="both"
            placeholder={`Search with ${engineName} or type an address`}
            onFocus={() => {
              setFocused(true);
              requestAnimationFrame(() => input.current?.select());
            }}
            onBlur={() => {
              setFocused(false);
              reset();
            }}
            onChange={(e) => onChange(e.target.value, (e.nativeEvent as InputEvent).inputType)}
            onKeyDown={onKeyDown}
          />
          {showSite && !edited && (
            <div className="mb-omnibox-display" aria-hidden="true">
              <span className="text-(--mb-text)">{host}</span>
              <span className="text-(--mb-text-faint)">{rest}</span>
            </div>
          )}
        </div>
        {tab && tab.zoom !== 100 && !focused && (
          <button
            type="button"
            className="mb-chip"
            title="Reset zoom (Ctrl+0)"
            onClick={() => void ui.command({ type: "zoomReset" })}
          >
            {tab.zoom}%
          </button>
        )}
        {tab && !isNewTabUrl(tab.url) && !focused && (
          <button
            type="button"
            className="mb-icon-btn h-7! w-7!"
            data-bookmark-star
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Edit bookmark" : "Bookmark this page"}
            title={bookmarked ? "Edit bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)"}
            onClick={() => void ui.command({ type: "bookmark" })}
          >
            <StarIcon filled={bookmarked} />
          </button>
        )}
      </div>

      {open && rect && result && (
        <div
          id="mb-suggestions"
          role="listbox"
          className="mb-popover mb-suggestions"
          style={{ left: rect.left - 6, top: rect.bottom + 6, width: rect.width + 12 }}
        >
          {result.suggestions.map((s, i) => (
            <button
              type="button"
              key={`${s.kind}:${s.url}:${i}`}
              role="option"
              aria-selected={i === selected}
              className="mb-suggestion"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelected(i)}
              onClick={(e) => go(i === 0 ? null : s, e.altKey || e.ctrlKey)}
            >
              <SuggestionIcon s={s} />
              <span className="min-w-0 flex-1 truncate">
                {s.kind === "search" ? (
                  s.title
                ) : s.kind === "go" ? (
                  <span className="mb-suggestion-url">{displayUrl(s.url) || s.url}</span>
                ) : (
                  <>
                    {s.title}
                    <span className="text-(--mb-text-faint)"> — </span>
                    <span className="mb-suggestion-url">{displayUrl(s.url)}</span>
                  </>
                )}
              </span>
              <span className="shrink-0 text-xs text-(--mb-text-faint)">
                {s.detail ??
                  (s.kind === "tab" ? "Switch to tab" : s.kind === "bookmark" ? "Bookmark" : "")}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SuggestionIcon({ s }: { s: Suggestion }) {
  if (s.kind === "search")
    return (
      <span className="text-(--mb-text-muted)">
        <SearchIcon size={15} />
      </span>
    );
  if (s.kind === "go")
    return (
      <span className="text-(--mb-text-muted)">
        <GlobeIcon size={15} />
      </span>
    );
  if (s.kind === "tab")
    return (
      <span className="text-(--mb-accent)">
        <TabIcon size={15} />
      </span>
    );
  if (s.kind === "bookmark" && !s.favicon)
    return (
      <span className="text-(--mb-accent)">
        <BookmarksIcon size={15} />
      </span>
    );
  return <Favicon url={s.url} src={s.favicon} size={15} />;
}

/** "example.com/path" → ["example.com", "/path"] for the emphasized host. */
function splitDisplay(text: string): [string, string] {
  const i = text.search(/[/?#]/);
  if (text.includes("://") || i < 0) return [text, ""];
  return [text.slice(0, i), text.slice(i)];
}
