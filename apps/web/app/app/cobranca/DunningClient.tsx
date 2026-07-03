"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface Rule {
  id: string;
  name: string;
  daysAfterDue: number;
  channel: string;
  templateText: string;
  isActive: boolean;
}

export function DunningClient({ initialRules }: { initialRules: Rule[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [testChannel, setTestChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  async function sendTest() {
    if (!testTo.trim()) { dialog.toast("Informe o destino do teste.", "error"); return; }
    setTestBusy(true);
    try {
      const url = testChannel === "email" ? "/api/messaging/test/email" : "/api/messaging/test/whatsapp";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no envio");
      dialog.toast(`Teste enviado por ${testChannel === "email" ? "e-mail" : "WhatsApp"}.`, "success");
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setTestBusy(false); }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      name: String(fd.get("name") ?? "").trim(),
      daysAfterDue: Number(fd.get("daysAfterDue") ?? 0),
      channel: String(fd.get("channel") ?? "whatsapp"),
      templateText: String(fd.get("templateText") ?? "").trim(),
      isActive: fd.get("isActive") === "on",
    };
    if (editing) payload.id = editing.id;
    const res = await fetch("/api/dunning/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    setEditing(null); setCreating(false);
    startTransition(() => router.refresh());
  }

  async function runNow() {
    setRunMsg("rodando...");
    const res = await fetch("/api/dunning/run-now", { method: "POST", credentials: "include" });
    setRunMsg(res.ok ? "Ciclo de cobrança disparado." : "Falha ao disparar.");
  }

  const formOpen = creating || editing;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {!formOpen && (
          <button onClick={() => setCreating(true)} className="btn-grad px-5 py-2">
            + Nova regra
          </button>
        )}
        <button onClick={runNow} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium transition hover:border-brand">
          Rodar cobrança agora
        </button>
        {runMsg && <span className="text-xs text-muted">{runMsg}</span>}
      </div>

      {/* Testar envio (WhatsApp/email) — verifica instância/SMTP da empresa */}
      <div className="card">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">Testar envio</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={testChannel}
            onChange={(e) => setTestChannel(e.target.value as "whatsapp" | "email")}
            className="input-base w-auto"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
          </select>
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={testChannel === "email" ? "email@cliente.com" : "(11) 99999-8888"}
            className="input-base min-w-[220px] flex-1"
          />
          <button
            onClick={sendTest}
            disabled={testBusy}
            className="rounded-xl border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-white disabled:opacity-50"
          >
            {testBusy ? "Enviando..." : "Enviar teste"}
          </button>
        </div>
      </div>

      {formOpen && (
        <form onSubmit={save} className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">{editing ? "Editar regra" : "Nova regra"}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Nome</span>
              <input name="name" required defaultValue={editing?.name} className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Dias (negativo=antes)</span>
              <input name="daysAfterDue" type="number" required defaultValue={String(editing?.daysAfterDue ?? 1)} className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Canal</span>
              <select name="channel" defaultValue={editing?.channel ?? "whatsapp"} className="input-base">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="both">Ambos</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Mensagem</span>
            <textarea name="templateText" required rows={3} defaultValue={editing?.templateText} className="input-base" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? true} className="h-4 w-4 accent-brand" /> Ativa
          </label>
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setEditing(null); setCreating(false); }} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium transition hover:border-brand">Cancelar</button>
            <button type="submit" disabled={isPending} className="btn-grad px-5 py-2">Salvar</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {initialRules.map((r) => (
          <div key={r.id} className="card flex items-start justify-between gap-4 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${r.daysAfterDue < 0 ? "bg-blue-500/20 text-blue-300" : r.daysAfterDue === 0 ? "bg-yellow-500/20 text-yellow-300" : "bg-red-500/20 text-red-300"}`}>
                  {r.daysAfterDue < 0 ? `${Math.abs(r.daysAfterDue)}d antes` : r.daysAfterDue === 0 ? "no dia" : `+${r.daysAfterDue}d`}
                </span>
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted">· {r.channel}</span>
                {!r.isActive && <span className="text-xs text-muted">(inativa)</span>}
              </div>
              <p className="mt-1 text-xs text-muted">{r.templateText}</p>
            </div>
            <button onClick={() => setEditing(r)} className="text-xs text-brand hover:underline">Editar</button>
          </div>
        ))}
      </div>
    </div>
  );
}
