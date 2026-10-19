import type { ReactNode } from "react";
import { errorMessage } from "./api";

type IconProps = { className?: string };

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}

export function IconHeart({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z" />
    </Icon>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

export function IconPlay({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m8 5 11 7-11 7z" />
    </Icon>
  );
}

export function IconArrowLeft({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </Icon>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Icon>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

export function Cover({
  src,
  alt,
  className = "",
  eager = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  if (!src) {
    return (
      <div className={`cover cover-placeholder ${className}`} role="img" aria-label={alt}>
        {alt.trim().charAt(0).toUpperCase() || "?"}
      </div>
    );
  }
  return <img src={src} alt={alt} className={`cover ${className}`} loading={eager ? "eager" : "lazy"} />;
}

export function Loading({ label = "Loading…", fullPage = false }: { label?: string; fullPage?: boolean }) {
  if (fullPage) {
    return (
      <div className="page-loading">
        <p className="state" role="status">
          {label}
        </p>
      </div>
    );
  }
  return (
    <p className="state" role="status">
      {label}
    </p>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}
