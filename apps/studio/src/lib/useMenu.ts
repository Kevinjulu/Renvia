import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="option"]:not([aria-disabled="true"])';

function items(menu: HTMLElement | null) {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
}

/**
 * Shared behaviour for popover menus: outside click and Escape close the menu,
 * arrow/Home/End move focus between items, and focus returns to the trigger on Escape.
 */
export function useMenu<T extends HTMLElement = HTMLElement>({
  open,
  onClose,
  rootRef,
  focusFirst = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Clicks inside this element (or the menu itself, which may be portaled) don't close it. Defaults to the trigger. */
  rootRef?: RefObject<HTMLElement | null>;
  focusFirst?: boolean;
}) {
  const menuRef = useRef<T>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const root = rootRef?.current ?? triggerRef.current;
      if (root?.contains(target) || menuRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef]);

  useEffect(() => {
    if (!open || !focusFirst) return;
    const frame = requestAnimationFrame(() => {
      const list = items(menuRef.current);
      const selected = list.find((item) => item.getAttribute("aria-checked") === "true" || item.getAttribute("aria-selected") === "true");
      (selected ?? list[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusFirst]);

  const onMenuKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const list = items(menuRef.current);
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % list.length;
    else if (event.key === "ArrowUp") next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else if (event.key === "Tab" && index >= 0) {
      onCloseRef.current();
      return;
    }
    const target = list[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, []);

  return { menuRef, triggerRef, onMenuKeyDown };
}
