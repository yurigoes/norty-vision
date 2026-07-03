"use client";

import { useEffect, useState } from "react";

interface BrandLogoClientProps {
  size?: "sm" | "md" | "lg" | "xl";
  showName?: boolean;
  className?: string;
}

interface PublicSettings {
  productName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

const SIZE_MAP: Record<NonNullable<BrandLogoClientProps["size"]>, string> = {
  sm: "h-5",
  md: "h-7",
  lg: "h-10",
  xl: "h-14",
};

let cachedSettings: PublicSettings | null = null;

/** Versao client-side do BrandLogo. Fetcha /api/platform/public uma vez. */
export function BrandLogoClient({
  size = "md",
  showName = false,
  className = "",
}: BrandLogoClientProps) {
  const [s, setS] = useState<PublicSettings | null>(cachedSettings);

  useEffect(() => {
    if (cachedSettings) return;
    fetch("/api/platform/public", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const settings = d?.settings ?? {};
        cachedSettings = {
          productName: settings.productName ?? "yugochat",
          logoUrl: settings.logoUrl ?? null,
          logoDarkUrl: settings.logoDarkUrl ?? null,
        };
        setS(cachedSettings);
      })
      .catch(() => {
        cachedSettings = {
          productName: "yugochat",
          logoUrl: null,
          logoDarkUrl: null,
        };
        setS(cachedSettings);
      });
  }, []);

  if (!s) {
    return <span className={`opacity-0 ${className}`}>•</span>;
  }

  const hClass = SIZE_MAP[size];

  if (!s.logoUrl) {
    return (
      <span className={`font-semibold tracking-tight ${className}`}>
        {s.productName}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src={s.logoUrl}
        alt={s.productName}
        className={`${hClass} w-auto object-contain dark:hidden`}
      />
      <img
        src={s.logoDarkUrl ?? s.logoUrl}
        alt={s.productName}
        className={`${hClass} hidden w-auto object-contain dark:block`}
      />
      {showName && (
        <span className="font-semibold tracking-tight">{s.productName}</span>
      )}
    </span>
  );
}
