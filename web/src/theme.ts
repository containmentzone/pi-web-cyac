import { useSyncExternalStore } from "react";

export type Theme = "void" | "paper";
export const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "void", label: "Void", hint: "Dark ground, acid accents" },
  { value: "paper", label: "Paper", hint: "Light ground, dark ink" },
];

const KEY = "pi-web-theme";
const listeners = new Set<() => void>();

function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "paper" ? "paper" : "void";
}

export function setTheme(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Theme still applies for this page view.
  }
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
  );
}
