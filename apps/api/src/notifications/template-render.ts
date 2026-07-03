// Render de modelos de mensagem + wrapper de e-mail com branding da empresa.
// Util SEM dependências de serviço (evita ciclo NotificationService <-> MessagingService).
// Diferente do MessagingService.render: aqui variáveis ausentes viram "" (envio real,
// sem dados de exemplo).

export type TemplateCategory = "info" | "low" | "warning" | "critical";

export const TEMPLATE_CATEGORY: Record<TemplateCategory, { color: string; label: string }> = {
  info: { color: "#2563eb", label: "Informação" },
  low: { color: "#0d9488", label: "Não urgente" },
  warning: { color: "#f59e0b", label: "Urgente" },
  critical: { color: "#dc2626", label: "Crítico / Inadimplente" },
};

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Substitui {{chave}} (aceita pontos) pelas variáveis dadas; ausentes viram "". */
export function renderTemplate(body: string, vars?: Record<string, string | number | null | undefined>): string {
  const v = vars ?? {};
  return (body || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, k) => {
    const val = (v as any)[k];
    return val !== undefined && val !== null ? String(val) : "";
  });
}

/** HTML do e-mail com cabeçalho colorido (categoria) + logo/nome da empresa + rodapé. */
export function buildBrandedEmail(opts: { bodyHtml: string; category?: TemplateCategory; brandName: string; logoUrl?: string | null }): string {
  const c = TEMPLATE_CATEGORY[opts.category ?? "info"] ?? TEMPLATE_CATEGORY.info;
  const header = opts.logoUrl
    ? `<img src="${opts.logoUrl}" alt="" style="max-height:44px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:18px;font-weight:700;color:#fff">${escapeHtml(opts.brandName)}</span>`;
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.08)">
    <div style="background:${c.color};padding:18px 24px;text-align:left">
      ${header}
      <div style="color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.9;margin-top:6px">${c.label}</div>
    </div>
    <div style="padding:28px 24px;line-height:1.6;font-size:15px">${opts.bodyHtml}</div>
    <div style="border-top:1px solid #e5e7eb;padding:14px 24px;font-size:11px;color:#9ca3af">${escapeHtml(opts.brandName)}</div>
  </div>
</body></html>`;
}
