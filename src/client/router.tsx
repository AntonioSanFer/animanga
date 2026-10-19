import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";

let current = window.location.pathname + window.location.search;
const listeners = new Set<() => void>();

function refresh(): void {
  current = window.location.pathname + window.location.search;
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", refresh);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({ animanga: true }, "", to);
  else window.history.pushState({ animanga: true }, "", to);
  refresh();
}

export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  children: ReactNode;
};

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
