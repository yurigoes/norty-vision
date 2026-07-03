"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Alert {
  id: string;
  level: "error" | "warning";
  title: string;
  message: string;
  actionHref: string;
  actionLabel: string;
}

/**
 * Banner de notificações internas do sistema. Hoje alerta WhatsApp
 * desconectado (vermelho). Faz poll periódico e some quando resolvido.
 */
export function InternalAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/company-integrations/alerts", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setAlerts(Array.isArray(data?.items) ? data.items : []);
      } catch {
        /* ignora */
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      {visible.map((a) => (
        <div
          key={a.id}
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            a.level === "error"
              ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-200"
              : "border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-200"
          }`}
        >
          <div className="min-w-0">
            <p className="font-semibold">{a.level === "error" ? "⚠ " : ""}{a.title}</p>
            <p className="text-xs opacity-90">{a.message}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={a.actionHref}
              className="rounded-lg border border-current px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
            >
              {a.actionLabel}
            </Link>
            <button
              onClick={() => setDismissed((d) => new Set(d).add(a.id))}
              className="text-base leading-none opacity-70 hover:opacity-100"
              aria-label="Dispensar"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
