"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption<V extends string = string> = {
  value: V;
  /** Text shown in the trigger and used for search / type-ahead. */
  label: string;
  /** Bold prefix in the menu (e.g. a deal code). */
  code?: string;
  /** Muted secondary line in the menu. */
  description?: string;
  disabled?: boolean;
};

type SelectProps<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  /**
   * `field` — full-width form control (matches `.field`).
   * `chip` — compact pill with an inline label, like the header Book / Currency filters.
   */
  variant?: "field" | "chip";
  /** Inline label for the `chip` variant ("Book", "Stage"). */
  label?: string;
  /** `auto` shows a search box when there are more than 15 options. */
  searchable?: boolean | "auto";
  searchPlaceholder?: string;
  /** Preferred menu width in px; always clamped to the viewport. Defaults to the trigger width. */
  menuWidth?: number;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/** Rendering cap so a 2k-option list stays snappy; search narrows the rest. */
const MAX_RENDERED = 150;
const VIEWPORT_GUTTER = 8;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 420;

type MenuPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

function matches(option: SelectOption, query: string) {
  if (!query) return true;
  const hay = `${option.code ?? ""} ${option.label} ${option.description ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/**
 * Themed replacement for the native `<select>`: popover listbox rendered in a
 * portal, kept inside the viewport, with keyboard support and optional search.
 */
export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  variant = "field",
  label,
  searchable = "auto",
  searchPlaceholder = "Search…",
  menuWidth,
  invalid,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps<V>) {
  const baseId = useId();
  const triggerId = id ?? `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const showSearch =
    searchable === true || (searchable === "auto" && options.length > 15);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(
    () => (showSearch && query ? options.filter((o) => matches(o, query)) : options),
    [options, query, showSearch],
  );
  const visible = filtered.length > MAX_RENDERED ? filtered.slice(0, MAX_RENDERED) : filtered;

  const firstEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < visible.length; i += step) {
        if (!visible[i].disabled) return i;
      }
      return -1;
    },
    [visible],
  );

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const maxWidth = vw - VIEWPORT_GUTTER * 2;
    const width = Math.min(
      Math.max(rect.width, menuWidth ?? 0, variant === "chip" ? 200 : 0),
      maxWidth,
    );
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_GUTTER),
      vw - VIEWPORT_GUTTER - width,
    );
    const below = vh - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
    const above = rect.top - MENU_GAP - VIEWPORT_GUTTER;
    const wanted = Math.min(MENU_MAX_HEIGHT, menuRef.current?.scrollHeight ?? MENU_MAX_HEIGHT);
    const flip = below < Math.min(wanted, 220) && above > below;
    setPosition(
      flip
        ? { bottom: vh - rect.top + MENU_GAP, left, width, maxHeight: Math.min(MENU_MAX_HEIGHT, above) }
        : { top: rect.bottom + MENU_GAP, left, width, maxHeight: Math.min(MENU_MAX_HEIGHT, below) },
    );
  }, [menuWidth, variant]);

  const openMenu = useCallback(
    (seed?: string) => {
      if (disabled) return;
      setQuery(seed && showSearch ? seed : "");
      const idx = options.findIndex((o) => o.value === value && !o.disabled);
      setActive(idx >= 0 && idx < MAX_RENDERED ? idx : 0);
      setOpen(true);
    },
    [disabled, options, showSearch, value],
  );

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    setPosition(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = visible[index];
      if (!option || option.disabled) return;
      if (option.value !== value) onChange(option.value);
      closeMenu();
    },
    [closeMenu, onChange, value, visible],
  );

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place, visible.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeMenu(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, closeMenu, place]);

  const placed = position !== null;
  useEffect(() => {
    // Wait until the menu is placed: a visibility:hidden input can't take focus.
    if (open && placed && showSearch) searchRef.current?.focus({ preventScroll: true });
  }, [open, placed, showSearch]);

  useEffect(() => {
    if (!open || active < 0 || !position) return;
    // Scroll only the list (scrollIntoView would also scroll the page).
    const list = listRef.current;
    const el = list?.children[active] as HTMLElement | undefined;
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight + 4;
  }, [open, active, position]);

  const runTypeahead = (key: string) => {
    const now = Date.now();
    const buf = now - typeahead.current.at < 600 ? typeahead.current.text + key : key;
    typeahead.current = { text: buf, at: now };
    const needle = buf.toLowerCase();
    const start = open ? active : options.findIndex((o) => o.value === value);
    const pool = open ? visible : options;
    // A fresh keystroke cycles past the current match; a longer buffer refines it.
    const offset = buf.length > 1 ? 0 : 1;
    for (let n = 0; n < pool.length; n++) {
      const i = (Math.max(start, 0) + offset + n) % pool.length;
      const o = pool[i];
      const text = `${o.code ?? ""}${o.code ? " " : ""}${o.label}`.toLowerCase();
      if (!o.disabled && (text.startsWith(needle) || o.label.toLowerCase().startsWith(needle))) {
        if (open) setActive(i);
        else if (o.value !== value) onChange(o.value);
        return;
      }
    }
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = firstEnabled(active + 1, 1);
        if (next >= 0) setActive(next);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = firstEnabled(active - 1, -1);
        if (prev >= 0) setActive(prev);
        break;
      }
      case "Home":
        if (!showSearch) {
          e.preventDefault();
          setActive(firstEnabled(0, 1));
        }
        break;
      case "End":
        if (!showSearch) {
          e.preventDefault();
          setActive(firstEnabled(visible.length - 1, -1));
        }
        break;
      case "PageDown":
        e.preventDefault();
        setActive(firstEnabled(Math.min(active + 8, visible.length - 1), -1));
        break;
      case "PageUp":
        e.preventDefault();
        setActive(firstEnabled(Math.max(active - 8, 0), 1));
        break;
      case "Enter":
        e.preventDefault();
        commit(active);
        break;
      case " ":
        if (!showSearch) {
          e.preventDefault();
          commit(active);
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        break;
      case "Tab":
        closeMenu(false);
        break;
      default:
        if (!showSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          runTypeahead(e.key);
        }
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) {
      if (!showSearch) onListKey(e);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (showSearch) {
        e.preventDefault();
        openMenu(e.key);
      } else {
        runTypeahead(e.key);
      }
    }
  };

  const display = selected?.label ?? placeholder;
  const isPlaceholder = !selected;
  const activeId = open && active >= 0 && active < visible.length ? optionId(active) : undefined;

  const menuStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : { visibility: "hidden", left: 0, top: 0 };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={!showSearch ? activeId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        title={selected ? selected.label : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKey}
        className={cn(
          "ui-select-trigger",
          variant === "chip" ? "chip-select" : "ui-select-field",
          open && "is-open",
          invalid && "is-invalid",
          className,
        )}
      >
        {variant === "chip" && label ? <span className="chip-label">{label}</span> : null}
        <span className={cn("ui-select-value", isPlaceholder && "is-placeholder")}>{display}</span>
        <ChevronDown className="ui-select-chevron" aria-hidden />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={cn("ui-select-menu", position?.bottom !== undefined && "is-above")}
              style={menuStyle}
            >
              {showSearch ? (
                <div className="ui-select-search">
                  <Search aria-hidden />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    aria-controls={listboxId}
                    aria-activedescendant={activeId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={onListKey}
                  />
                </div>
              ) : null}
              <ul
                ref={listRef}
                id={listboxId}
                role="listbox"
                aria-label={ariaLabel ?? label}
                className="ui-select-list"
                tabIndex={-1}
              >
                {visible.length === 0 ? (
                  <li className="ui-select-empty" role="presentation">
                    {query ? "No matches" : "No options yet"}
                  </li>
                ) : (
                  visible.map((o, i) => {
                    const isSelected = o.value === value;
                    return (
                      <li
                        key={`${o.value}-${i}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={o.disabled || undefined}
                        title={o.label}
                        className={cn(
                          "ui-select-option",
                          i === active && "is-active",
                          isSelected && "is-selected",
                          o.disabled && "is-disabled",
                        )}
                        onPointerMove={() => {
                          if (active !== i && !o.disabled) setActive(i);
                        }}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => commit(i)}
                      >
                        <span className="ui-select-option-text">
                          {o.code ? (
                            <>
                              <span className="ui-select-option-code">{o.code}</span>
                              {o.description ? (
                                <span className="ui-select-option-desc">{o.description}</span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <span className="ui-select-option-label">{o.label}</span>
                              {o.description ? (
                                <span className="ui-select-option-desc">{o.description}</span>
                              ) : null}
                            </>
                          )}
                        </span>
                        {isSelected ? <Check className="ui-select-check" aria-hidden /> : null}
                      </li>
                    );
                  })
                )}
              </ul>
              {filtered.length > visible.length ? (
                <div className="ui-select-footer">
                  Showing {visible.length} of {filtered.length} — type to narrow
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
