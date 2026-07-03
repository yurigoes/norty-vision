"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";
import { openDocBlob } from "../../../lib/openDoc";

interface Customer {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  city: string | null;
  avatarUrl?: string | null;
}

interface DocItem { id: string; docType: string; status: string; notes: string | null; createdAt: string; kind: "image" | "pdf" | "other" }

const DOC_LABEL: Record<string, string> = {
  rg: "RG", cpf: "CPF", cnh: "CNH", selfie: "Selfie", proof_income: "Comprovante de renda",
  proof_address: "Comprovante de residência", avatar: "Foto de perfil", other: "Outro",
};

/** Avatar com placeholder estilo "boneco 3D" (gradiente + silhueta) quando sem foto. */
function Avatar({ url, name, size = 56 }: { url?: string | null; name?: string; size?: number }) {
  if (url) {
    return <img src={url} alt={name ?? ""} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: "linear-gradient(145deg, rgb(var(--brand)/.85), rgb(var(--brand)/.35))" }}
      aria-label="sem foto"
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="white" opacity="0.92">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5v.5H4V20z" />
      </svg>
    </div>
  );
}

interface ImportRow { name: string; document?: string | null; phone?: string | null; whatsappPhone?: string | null; email?: string | null; postalCode?: string | null; addressLine?: string | null; addressNumber?: string | null; birthDate?: string | null; documentType?: "cpf" | "cnpj"; source?: string }

/** Parser de CSV de clientes (cabeçalho por nome de coluna, separador , ou ;). */
function parseClientsCsv(text: string): ImportRow[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const splitLine = (line: string): string[] => {
    const out: string[] = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === sep && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = splitLine(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iCpf = idx(["cpf", "cpfcnpj", "documento"]);
  const iName = idx(["nome", "cliente", "name"]);
  const iPhone = idx(["telefone", "celular", "whatsapp", "fone"]);
  const iEmail = idx(["email", "email"]);
  const iCep = idx(["cep"]);
  const iRua = idx(["rua", "endereco", "logradouro"]);
  const iNum = idx(["numero", "num"]);
  const iNasc = idx(["nascimento", "datanascimento", "dtnascimento"]);
  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitLine(lines[i]!);
    const name = (iName >= 0 ? c[iName] : "")?.trim() ?? "";
    if (name.length < 2) continue;
    const doc = (iCpf >= 0 ? c[iCpf] : "")?.replace(/\D/g, "") || null;
    const phone = (iPhone >= 0 ? c[iPhone] : "")?.replace(/\D/g, "") || null;
    let birth: string | null = null;
    const rawBirth = iNasc >= 0 ? c[iNasc]?.trim() : "";
    if (rawBirth) {
      if (/^\d{4}-\d{2}-\d{2}/.test(rawBirth)) birth = rawBirth.slice(0, 10);
      else { const m = rawBirth.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) birth = `${m[3]}-${m[2]}-${m[1]}`; }
    }
    rows.push({
      name,
      document: doc, documentType: doc && doc.length > 11 ? "cnpj" : "cpf",
      phone, whatsappPhone: phone,
      email: (iEmail >= 0 ? c[iEmail] : "")?.trim() || null,
      postalCode: (iCep >= 0 ? c[iCep] : "")?.replace(/\D/g, "") || null,
      addressLine: (iRua >= 0 ? c[iRua] : "")?.trim() || null,
      addressNumber: (iNum >= 0 ? c[iNum] : "")?.trim() || null,
      birthDate: birth,
      source: "import",
    });
  }
  return rows;
}

export function ClientesClient({ initial }: { initial: Customer[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);

  async function openDetail(id: string) {
    setErr(null);
    setDocs([]);
    try {
      const res = await fetch(`/api/customers/${id}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setDetail(data.customer);
      // documentos enviados pelo cliente (best-effort)
      fetch(`/api/customers/${id}/documents`, { credentials: "include", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setDocs(d.items ?? []))
        .catch(() => undefined);
    } catch (e: any) { dialog.toast(e.message, "error"); }
  }

  function setField(k: string, v: any) {
    setDetail((d: any) => ({ ...d, [k]: v }));
  }

  async function saveDetail() {
    if (!detail) return;
    setSavingDetail(true);
    try {
      const body: any = {};
      for (const k of ["name", "email", "phone", "whatsappPhone", "document", "city", "state", "postalCode",
        "addressLine", "addressNumber", "addressComplement", "neighborhood"]) {
        body[k] = detail[k] ?? null;
      }
      const res = await fetch(`/api/customers/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      dialog.toast("Dados atualizados.", "success");
      setDetail(null);
      router.refresh();
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setSavingDetail(false); }
  }

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return initial.slice(0, 100);
    const d = s.replace(/\D/g, "");
    return initial
      .filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          (d.length >= 3 && (c.document ?? "").replace(/\D/g, "").includes(d)) ||
          (d.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(d)) ||
          (c.email ?? "").toLowerCase().includes(s),
      )
      .slice(0, 100);
  }, [q, initial]);

  async function resetPassword(c: Customer) {
    const ok = await dialog.confirm({
      title: "Resetar senha do portal",
      message: `Resetar a senha do portal de ${c.name}? Ele voltará a entrar com o CPF/CNPJ e terá que criar uma nova senha no próximo acesso.`,
      confirmLabel: "Resetar",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(c.id); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/customers/${c.id}/reset-portal-password`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setMsg(`Senha do portal de ${c.name} resetada.`);
      dialog.toast("Senha do portal resetada.", "success");
      router.refresh();
    } catch (e: any) { setErr(e.message); dialog.toast(e.message, "error"); } finally { setBusyId(null); }
  }

  // Abre o documento via fetch autenticado (credentials) → blob. Evita a "página
  // em branco" ao abrir a URL crua da API numa aba nova (que pode perder o
  // cookie de sessão/sameSite). Abre a janela antes do await pra não cair no
  // bloqueador de pop-up.
  async function openDoc(docId: string) {
    if (!detail) return;
    await openDocBlob(`/api/customers/${detail.id}/documents/${docId}/file`);
  }

  async function importCsv(file: File) {
    setImporting(true); setErr(null); setMsg(null);
    try {
      const text = await file.text();
      const rows = parseClientsCsv(text);
      if (rows.length === 0) throw new Error("Nenhuma linha válida no CSV (verifique o cabeçalho).");
      const res = await fetch("/api/customers/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha na importação");
      setMsg(`Importação concluída: ${d.created} criados · ${d.matched} já existiam · ${d.errors} com erro.`);
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setImporting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail"
          className="input-base flex-1"
        />
        <button onClick={() => setCreating(true)} className="btn-grad">
          + Novo cliente
        </button>
        <label className="cursor-pointer rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand">
          {importing ? "Importando..." : "Importar CSV"}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.currentTarget.value = ""; }} />
        </label>
      </div>
      {creating && <NewCustomerModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} />}
      <p className="text-[11px] text-muted">CSV com colunas: CPF, Nome, Telefone, Email, CEP, Rua, Numero, Nascimento. Duplicados (CPF/telefone) são ignorados; o restante o cliente completa no portal.</p>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
      {msg && <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-200">{msg}</p>}

      {list.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhum cliente.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Cidade</th>
                <th className="px-4 py-3 font-medium">Portal</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2.5">
                      <Avatar url={c.avatarUrl} name={c.name} size={32} />
                      <span>{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{c.document ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {c.whatsappPhone ?? c.phone ?? "—"}
                    {c.email && <div>{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{c.city ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => openDetail(c.id)}
                        className="rounded-lg border border-line px-3 py-1 text-xs transition hover:border-brand"
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => resetPassword(c)}
                        disabled={busyId === c.id}
                        className="rounded-lg border border-line px-3 py-1 text-xs transition hover:border-brand disabled:opacity-50"
                      >
                        {busyId === c.id ? "..." : "Resetar senha"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* detalhe / edição do cliente (inclui o que ele preencheu no portal) */}
      {detail && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line p-6">
            <div className="mb-4 flex items-center gap-3">
              <Avatar url={detail.avatarUrl} name={detail.name} size={56} />
              <div>
                <h2 className="text-lg font-semibold">{detail.name}</h2>
                <p className="text-xs text-muted">{detail.document ?? "sem documento"}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DField label="Nome" value={detail.name ?? ""} onChange={(v) => setField("name", v)} />
              <DField label="CPF/CNPJ" value={detail.document ?? ""} onChange={(v) => setField("document", v)} />
              <DField label="E-mail" value={detail.email ?? ""} onChange={(v) => setField("email", v)} />
              <DField label="WhatsApp" value={detail.whatsappPhone ?? ""} onChange={(v) => setField("whatsappPhone", v)} />
              <DField label="Telefone" value={detail.phone ?? ""} onChange={(v) => setField("phone", v)} />
              <DField label="CEP" value={detail.postalCode ?? ""} onChange={(v) => setField("postalCode", v)} />
              <DField label="Endereço" value={detail.addressLine ?? ""} onChange={(v) => setField("addressLine", v)} />
              <DField label="Número" value={detail.addressNumber ?? ""} onChange={(v) => setField("addressNumber", v)} />
              <DField label="Complemento" value={detail.addressComplement ?? ""} onChange={(v) => setField("addressComplement", v)} />
              <DField label="Bairro" value={detail.neighborhood ?? ""} onChange={(v) => setField("neighborhood", v)} />
              <DField label="Cidade" value={detail.city ?? ""} onChange={(v) => setField("city", v)} />
              <DField label="UF" value={detail.state ?? ""} onChange={(v) => setField("state", v)} />
            </div>

            {detail.incomeCents != null && (
              <p className="mt-3 text-xs text-muted">
                Renda informada no portal: {(Number(detail.incomeCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            )}

            {/* Documentos enviados pelo cliente */}
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Documentos enviados</p>
              {docs.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">Nenhum documento enviado.</p>
              ) : (
                <ul className="space-y-1.5">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <span>{d.kind === "image" ? "🖼️" : d.kind === "pdf" ? "📄" : "📎"}</span>
                        <span>{DOC_LABEL[d.docType] ?? d.docType}</span>
                        <span className="text-[10px] text-muted">{new Date(d.createdAt).toLocaleDateString("pt-BR")}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => openDoc(d.id)}
                        className="text-xs text-brand hover:underline"
                      >
                        ver
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDetail(null)} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Fechar</button>
              <button onClick={saveDetail} disabled={savingDetail} className="btn-grad px-5 disabled:opacity-50">
                {savingDetail ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base"
      />
    </label>
  );
}

/** Cadastro completo de cliente (nem todo cliente vem de agenda/venda). */
function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    name: "", document: "", documentType: "cpf", birthDate: "", gender: "unspecified",
    email: "", phone: "", whatsappPhone: "", phoneSecondary: "", prefersChannel: "whatsapp",
    postalCode: "", state: "", city: "", neighborhood: "", addressLine: "", addressNumber: "", addressComplement: "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (f.name.trim().length < 2) { setErr("Informe o nome"); return; }
    setBusy(true);
    try {
      const body: any = { name: f.name.trim(), documentType: f.documentType, prefersChannel: f.prefersChannel, gender: f.gender, source: "manual" };
      for (const k of ["document", "birthDate", "email", "phone", "whatsappPhone", "phoneSecondary",
        "postalCode", "state", "city", "neighborhood", "addressLine", "addressNumber", "addressComplement"]) {
        const v = f[k]?.trim();
        if (v) body[k] = k === "state" ? v.toUpperCase().slice(0, 2) : v;
      }
      const res = await fetch("/api/customers", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao cadastrar"); return; }
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo cliente</h3>
        {err && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><DField label="Nome completo *" value={f.name} onChange={(v) => set("name", v)} /></div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Tipo de documento</span>
            <select value={f.documentType} onChange={(e) => set("documentType", e.target.value)} className="input-base">
              <option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="passport">Passaporte</option><option value="other">Outro</option>
            </select>
          </label>
          <DField label="Documento" value={f.document} onChange={(v) => set("document", v)} />
          <DField label="Nascimento (AAAA-MM-DD)" value={f.birthDate} onChange={(v) => set("birthDate", v)} />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Sexo</span>
            <select value={f.gender} onChange={(e) => set("gender", e.target.value)} className="input-base">
              <option value="unspecified">Não informado</option><option value="female">Feminino</option><option value="male">Masculino</option><option value="other">Outro</option>
            </select>
          </label>
          <DField label="E-mail" value={f.email} onChange={(v) => set("email", v)} />
          <DField label="WhatsApp" value={f.whatsappPhone} onChange={(v) => set("whatsappPhone", v)} />
          <DField label="Telefone" value={f.phone} onChange={(v) => set("phone", v)} />
          <DField label="Telefone 2" value={f.phoneSecondary} onChange={(v) => set("phoneSecondary", v)} />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Canal preferido</span>
            <select value={f.prefersChannel} onChange={(e) => set("prefersChannel", e.target.value)} className="input-base">
              <option value="whatsapp">WhatsApp</option><option value="phone">Telefone</option><option value="email">E-mail</option><option value="sms">SMS</option><option value="none">Nenhum</option>
            </select>
          </label>
          <DField label="CEP" value={f.postalCode} onChange={(v) => set("postalCode", v)} />
          <DField label="UF" value={f.state} onChange={(v) => set("state", v)} />
          <DField label="Cidade" value={f.city} onChange={(v) => set("city", v)} />
          <DField label="Bairro" value={f.neighborhood} onChange={(v) => set("neighborhood", v)} />
          <DField label="Endereço" value={f.addressLine} onChange={(v) => set("addressLine", v)} />
          <DField label="Número" value={f.addressNumber} onChange={(v) => set("addressNumber", v)} />
          <div className="sm:col-span-2"><DField label="Complemento" value={f.addressComplement} onChange={(v) => set("addressComplement", v)} /></div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Cancelar</button>
          <button disabled={busy} onClick={submit} className="btn-grad px-5 disabled:opacity-50">
            {busy ? "Salvando…" : "Cadastrar cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
