"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableChildren(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

export function AccessibleDialog({
  children,
  closeDisabled = false,
  labelledBy,
  onClose,
  returnFocusRef,
}: Readonly<{
  children: ReactNode;
  closeDisabled?: boolean;
  labelledBy: string;
  onClose(): void;
  returnFocusRef: RefObject<HTMLElement | null>;
}>) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const returnTarget = returnFocusRef.current;
    const panel = panelRef.current;
    (panel ? focusableChildren(panel)[0] : null)?.focus();

    return () => {
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [returnFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!closeDisabled) onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = focusableChildren(panel);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={handleKeyDown}>
      <section
        ref={panelRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
