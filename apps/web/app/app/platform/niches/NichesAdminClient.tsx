"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODULE_GROUPS } from "../../../../lib/modules";
import { useDialog } from "../../../../components/SystemDialog";

interface Niche {
  id: string;
  key: string;
  label: string;
  hiddenModuleKeys: string[];
  isActive: boolean;
  displayOrder: number;
}

export function NichesAdminClient({ initial }: { initial: Niche[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Niche | null>(null);
  const [busy, setBusy] = useState(false);

  // estado do formulário
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(true);
  const [order, setOrder] = useState(0);

  function openCreate() {
    setEditing(null); setCreating(true);
    setKey(""); setLabel(""); setHidden(new Set()); setIsActive(true); setOrder((initial.at(-1)?.displayOrder ?? 0) + 1);
  }
  function openEdit(n: Niche) {
    setCreating(false); setEditing(n);
    setKey(n.key); setLabel(n.label); setHidden(new Set(n.hiddenModuleKeys ?? [])); setIsActive(n.isActive); setOrder(n.displayOrder);
  }
  function closeForm() { setCreating(false); setEditing(null); }

  function toggleHidden(k: string) {
    setHidden((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  async function save() {
    setBusy(true);
    try {
      const payload = { label, hiddenModuleKeys: [...hidden], isActive, displayOrder: order, ...(creating ? { key } : {}) };
      const url = editing ? `/api/niches/${editing.id}` : "/api/niches";
      const res = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      const j = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(j?.error?.message ?? "Falha ao salvar", "error"); return; }
      dialog.toast("Nicho salvo ✅", "success"); closeForm(); router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(n: Niche) {
    if (!(await dialog.confirm({ title: "Excluir nicho", message: `Excluir o nicho "${n.label}"? Empresas que usam esse nicho precisam ser migradas antes.`, tone: "danger" }))) return;
    const res = await fetch(`/api/niches/${n.id}`, { method: "DELETE", credentials: "include" });
    const j = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(j?.error?.message ?? "Não foi possível excluir", "error"); return; }
    dialog.toast("Nicho excluído", "success"); router.refresh();
  }

  const formOpen = creating || editing;
  const totalModules = MODULE_GROUPS.reduce((n, g) => n + g.modules.length, 0);

  return (
    <div className="space-y-6">
      {!formOpen && (
        <button onClick={openCreate} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white">+ Novo nicho</button>
      )}

      {formOpen && (
        <div className="space-y-5 rounded-xl border border-line bg-bg/60 p-6">
          <h2 className="text-lg font-semibold">{editing ? `Editar — ${editing.label}` : "Novo nicho"}</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Chave (slug)</span>
              <input value={key} disabled={!!editing} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="joalheria" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm disabled:opacity-60" />
              <span className="mt-1 block text-[10px] text-muted">{editing ? "não pode mudar" : "2-40 caracteres: minúsculas, números, hífen"}</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Nome</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Joalheria" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Ordem</span>
              <input type="number" value={order} onChange={(e) => setOrder(parseInt(e.target.value || "0", 10) || 0)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
          </div>

          {/* Módulos: marcado = aparece pra esse nicho. Internamente guardamos
              a deny-list (os DESMARCADOS), pra módulo novo aparecer por padrão. */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">Módulos que aparecem pra esse nicho</span>
              <span className="text-[11px] text-muted">{totalModules - hidden.size}/{totalModules} visíveis</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {MODULE_GROUPS.map((g) => (
                <div key={g.group} className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">{g.group}</p>
                  <div className="space-y-1.5">
                    {g.modules.map((m) => (
                      <label key={m.key} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" checked={!hidden.has(m.key)} onChange={() => toggleHidden(m.key)} className="h-4 w-4" />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">Desmarcar = esconde o módulo da sidebar das empresas desse nicho. Módulos core (Lojas/Usuários/Permissões/Integrações/Assinatura) aparecem sempre.</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
            Ativo (aparece na lista de nichos pra escolher)
          </label>

          <div className="flex items-center gap-2">
            <button onClick={closeForm} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <button onClick={save} disabled={busy || (creating && key.length < 2) || label.length < 2} className="ml-auto rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      )}

      {initial.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum nicho cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Chave</th>
                <th className="px-4 py-3">Módulos visíveis</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((n) => (
                <tr key={n.id} className="border-t border-line/50">
                  <td className="px-4 py-3 font-medium">{n.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{n.key}</td>
                  <td className="px-4 py-3 text-xs text-muted">{totalModules - (n.hiddenModuleKeys?.length ?? 0)}/{totalModules}</td>
                  <td className="px-4 py-3 text-xs">{n.isActive ? "✅" : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(n)} className="text-xs text-brand hover:underline">editar</button>
                    <button onClick={() => remove(n)} className="ml-3 text-xs text-red-400 hover:underline">excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
