"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

type Trunk = { id: string; name: string; sipHost: string; sipUser: string; register: boolean; active: boolean; callerIdName: string | null; hasPass: boolean };
type Did = { id: string; trunkId: string; number: string; label: string | null; inboundKind: string; inboundId: string | null; active: boolean };
type Group = { id: string; name: string; strategy: string; ringTimeoutS: number; memberCount: number };
type Op = { membershipId: string; name: string; role: string | null; extension: string | null };
type Member = { id: string; membershipId: string; name: string; extension: string | null; priority: number; active: boolean };

async function j<T = any>(method: string, url: string, body?: any): Promise<T | null> {
  const r = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.ok ? r.json() : null;
}

export function VoipAdminClient() {
  const [tab, setTab] = useState<"trunks" | "dids" | "groups">("trunks");
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-line">
        {([["trunks", "Linhas (SIP)"], ["dids", "Números"], ["groups", "Grupos"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{lbl}</button>
        ))}
      </nav>
      {tab === "trunks" && <TrunksTab />}
      {tab === "dids" && <DidsTab />}
      {tab === "groups" && <GroupsTab />}
    </div>
  );
}

// =============================== TRUNKS ===============================
function TrunksTab() {
  const dialog = useDialog();
  const [items, setItems] = useState<Trunk[] | null>(null);
  const [editing, setEditing] = useState<Trunk | "new" | null>(null);
  const load = useCallback(async () => {
    const d = await j<{ items: Trunk[] }>("GET", "/api/voip/admin/trunks");
    setItems(d?.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(t: Trunk) {
    if (!(await dialog.confirm(`Remover a linha "${t.name}"? Os DIDs apontando pra ela também serão afetados.`))) return;
    const r = await fetch(`/api/voip/admin/trunks/${t.id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { dialog.toast("Linha removida ✅", "success"); load(); } else dialog.toast("Falha", "error");
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setEditing("new")} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Adicionar linha</button></div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> :
        items.length === 0 ? <p className="rounded-xl border border-line p-8 text-center text-muted">Nenhuma linha cadastrada ainda.</p> :
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg/60"><tr className="text-left"><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Servidor SIP</th><th className="px-3 py-2">Usuário</th><th className="px-3 py-2">Reg.</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-muted">{t.sipHost}</td>
                  <td className="px-3 py-2 text-muted">{t.sipUser}</td>
                  <td className="px-3 py-2">{t.active && t.register ? "✅" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(t)} className="text-xs underline">Editar</button>
                    <button onClick={() => remove(t)} className="ml-3 text-xs text-red-500 underline">Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {editing && <TrunkModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function TrunkModal({ initial, onClose, onSaved }: { initial: Trunk | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(initial?.name ?? "");
  const [sipHost, setSipHost] = useState(initial?.sipHost ?? "");
  const [sipUser, setSipUser] = useState(initial?.sipUser ?? "");
  const [sipPass, setSipPass] = useState("");
  const [callerIdName, setCallerIdName] = useState(initial?.callerIdName ?? "");
  const [register, setRegister] = useState(initial?.register ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name || !sipHost || !sipUser || (!initial && !sipPass)) { dialog.toast("Preencha todos os campos obrigatórios", "error"); return; }
    setSaving(true);
    const body: any = { name, sipHost, sipUser, callerIdName, register };
    if (sipPass) body.sipPass = sipPass;
    const url = initial ? `/api/voip/admin/trunks/${initial.id}` : "/api/voip/admin/trunks";
    const method = initial ? "PUT" : "POST";
    const ok = await j(method, url, body);
    setSaving(false);
    if (ok) { dialog.toast("Salvo ✅. O PABX vai aplicar em até 30s.", "success"); onSaved(); } else dialog.toast("Falha ao salvar", "error");
  }
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">{initial ? "Editar linha" : "Adicionar linha SIP"}</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Field label="Nome (apelido)" value={name} onChange={setName} placeholder="Ex.: Sobreip Salvador" />
          <Field label="Servidor SIP (host)" value={sipHost} onChange={setSipHost} placeholder="Ex.: voz.sobreip.com.br" />
          <Field label="Usuário SIP / DID" value={sipUser} onChange={setSipUser} placeholder="Ex.: 7131800845" />
          <Field label={initial ? "Senha SIP (deixe vazio pra não alterar)" : "Senha SIP"} value={sipPass} onChange={setSipPass} type="password" />
          <Field label="Nome na bina (opcional)" value={callerIdName} onChange={setCallerIdName} placeholder="Ex.: Yugochat" />
          <label className="flex items-center gap-2"><input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} /> Registrar com a operadora</label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

// =============================== DIDs ===============================
function DidsTab() {
  const dialog = useDialog();
  const [items, setItems] = useState<Did[] | null>(null);
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [editing, setEditing] = useState<Did | "new" | null>(null);
  const load = useCallback(async () => {
    const [d, t, g] = await Promise.all([
      j<{ items: Did[] }>("GET", "/api/voip/admin/dids"),
      j<{ items: Trunk[] }>("GET", "/api/voip/admin/trunks"),
      j<{ items: Group[] }>("GET", "/api/voip/admin/groups"),
    ]);
    setItems(d?.items ?? []); setTrunks(t?.items ?? []); setGroups(g?.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(d: Did) {
    if (!(await dialog.confirm(`Remover o número ${d.number}?`))) return;
    const r = await fetch(`/api/voip/admin/dids/${d.id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { dialog.toast("Número removido ✅", "success"); load(); } else dialog.toast("Falha", "error");
  }
  const trunkName = (id: string) => trunks.find((t) => t.id === id)?.name ?? "?";
  const targetName = (kind: string, id: string | null) => {
    if (kind === "group") return groups.find((g) => g.id === id)?.name ?? "?";
    if (kind === "extension") return `Ramal`;
    if (kind === "ivr") return "URA";
    return "—";
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setEditing("new")} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Adicionar número</button></div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> :
        items.length === 0 ? <p className="rounded-xl border border-line p-8 text-center text-muted">Nenhum número cadastrado ainda. Cadastre primeiro uma linha (aba "Linhas SIP").</p> :
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg/60"><tr className="text-left"><th className="px-3 py-2">Número</th><th className="px-3 py-2">Apelido</th><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Destino</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono">{d.number}</td>
                  <td className="px-3 py-2 text-muted">{d.label ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{trunkName(d.trunkId)}</td>
                  <td className="px-3 py-2">{d.inboundKind} → {targetName(d.inboundKind, d.inboundId)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(d)} className="text-xs underline">Editar</button>
                    <button onClick={() => remove(d)} className="ml-3 text-xs text-red-500 underline">Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {editing && <DidModal initial={editing === "new" ? null : editing} trunks={trunks} groups={groups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function DidModal({ initial, trunks, groups, onClose, onSaved }: { initial: Did | null; trunks: Trunk[]; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [trunkId, setTrunkId] = useState(initial?.trunkId ?? trunks[0]?.id ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [inboundKind, setInboundKind] = useState(initial?.inboundKind ?? "group");
  const [inboundId, setInboundId] = useState<string | "">(initial?.inboundId ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!trunkId || !number || number.replace(/\D/g, "").length < 8) { dialog.toast("Preencha linha + número (com DDD).", "error"); return; }
    setSaving(true);
    const body: any = { trunkId, number, label, inboundKind, inboundId: inboundId || null };
    const url = initial ? `/api/voip/admin/dids/${initial.id}` : "/api/voip/admin/dids";
    const method = initial ? "PUT" : "POST";
    const ok = await j(method, url, body);
    setSaving(false);
    if (ok) { dialog.toast("Salvo ✅", "success"); onSaved(); } else dialog.toast("Falha ao salvar", "error");
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">{initial ? "Editar número" : "Adicionar número"}</h2>
        <div className="mt-4 space-y-3 text-sm">
          <label className="block"><span className="text-muted">Linha</span>
            <select value={trunkId} onChange={(e) => setTrunkId(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2">
              {trunks.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.sipHost})</option>)}
            </select>
          </label>
          <Field label="Número (DDD + número)" value={number} onChange={setNumber} placeholder="Ex.: 7131800845" />
          <Field label="Apelido (opcional)" value={label} onChange={setLabel} placeholder="Ex.: Vendas BA" />
          <label className="block"><span className="text-muted">Quando alguém ligar, encaminhar pra:</span>
            <select value={inboundKind} onChange={(e) => { setInboundKind(e.target.value); setInboundId(""); }} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2">
              <option value="group">Grupo de ramal</option>
              <option value="extension">Ramal específico (em breve)</option>
              <option value="ivr">URA (em breve)</option>
            </select>
          </label>
          {inboundKind === "group" && (
            <label className="block"><span className="text-muted">Grupo</span>
              <select value={inboundId} onChange={(e) => setInboundId(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2">
                <option value="">— escolha um grupo —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount} membros)</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

// =============================== GROUPS ===============================
function GroupsTab() {
  const dialog = useDialog();
  const [items, setItems] = useState<Group[] | null>(null);
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [openMembers, setOpenMembers] = useState<Group | null>(null);
  const load = useCallback(async () => {
    const d = await j<{ items: Group[] }>("GET", "/api/voip/admin/groups");
    setItems(d?.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(g: Group) {
    if (!(await dialog.confirm(`Remover o grupo "${g.name}"?`))) return;
    const r = await fetch(`/api/voip/admin/groups/${g.id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { dialog.toast("Grupo removido ✅", "success"); load(); } else dialog.toast("Falha", "error");
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setEditing("new")} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Adicionar grupo</button></div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> :
        items.length === 0 ? <p className="rounded-xl border border-line p-8 text-center text-muted">Nenhum grupo ainda.</p> :
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg/60"><tr className="text-left"><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Estratégia</th><th className="px-3 py-2">Timeout</th><th className="px-3 py-2">Membros</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{g.name}</td>
                  <td className="px-3 py-2 text-muted">{g.strategy}</td>
                  <td className="px-3 py-2 text-muted">{g.ringTimeoutS}s</td>
                  <td className="px-3 py-2">{g.memberCount}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setOpenMembers(g)} className="text-xs underline">Membros</button>
                    <button onClick={() => setEditing(g)} className="ml-3 text-xs underline">Editar</button>
                    <button onClick={() => remove(g)} className="ml-3 text-xs text-red-500 underline">Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {editing && <GroupModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {openMembers && <MembersDrawer group={openMembers} onClose={() => { setOpenMembers(null); load(); }} />}
    </div>
  );
}

function GroupModal({ initial, onClose, onSaved }: { initial: Group | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(initial?.name ?? "");
  const [strategy, setStrategy] = useState(initial?.strategy ?? "all");
  const [ringTimeoutS, setRingTimeoutS] = useState(initial?.ringTimeoutS ?? 25);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name) { dialog.toast("Nome é obrigatório", "error"); return; }
    setSaving(true);
    const body = { name, strategy, ringTimeoutS };
    const url = initial ? `/api/voip/admin/groups/${initial.id}` : "/api/voip/admin/groups";
    const method = initial ? "PUT" : "POST";
    const ok = await j(method, url, body);
    setSaving(false);
    if (ok) { dialog.toast("Salvo ✅", "success"); onSaved(); } else dialog.toast("Falha", "error");
  }
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">{initial ? "Editar grupo" : "Novo grupo"}</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Field label="Nome" value={name} onChange={setName} placeholder="Ex.: Atendimento" />
          <label className="block"><span className="text-muted">Estratégia de toque</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2">
              <option value="all">Todos tocam ao mesmo tempo</option>
              <option value="sequential">Sequencial (um por vez, por prioridade)</option>
            </select>
          </label>
          <Field label="Timeout de toque (segundos)" value={String(ringTimeoutS)} onChange={(v) => setRingTimeoutS(parseInt(v, 10) || 25)} type="number" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function MembersDrawer({ group, onClose }: { group: Group; onClose: () => void }) {
  const dialog = useDialog();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [pick, setPick] = useState<string>("");
  const load = useCallback(async () => {
    const [m, o] = await Promise.all([
      j<{ items: Member[] }>("GET", `/api/voip/admin/groups/${group.id}/members`),
      j<{ items: Op[] }>("GET", "/api/voip/admin/operators"),
    ]);
    setMembers(m?.items ?? []);
    setOps(o?.items ?? []);
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const availableOps = ops.filter((o) => !members?.some((m) => m.membershipId === o.membershipId));

  async function add() {
    if (!pick) return;
    const r = await j("POST", `/api/voip/admin/groups/${group.id}/members`, { membershipId: pick });
    if (r) { dialog.toast("Adicionado ✅", "success"); setPick(""); load(); } else dialog.toast("Falha", "error");
  }
  async function remove(m: Member) {
    const r = await fetch(`/api/voip/admin/groups/${group.id}/members/${m.id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { dialog.toast("Removido ✅", "success"); load(); } else dialog.toast("Falha", "error");
  }
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Membros · {group.name}</h2>
          <button onClick={onClose} className="text-xs text-muted underline">Fechar</button>
        </div>
        <div className="flex gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <option value="">— adicionar operador —</option>
            {availableOps.map((o) => <option key={o.membershipId} value={o.membershipId}>{o.name}{o.extension ? ` (ramal ${o.extension})` : " (sem ramal)"}</option>)}
          </select>
          <button onClick={add} disabled={!pick} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">+</button>
        </div>
        <div className="mt-4 space-y-2">
          {members === null ? <p className="text-sm text-muted">Carregando…</p> :
            members.length === 0 ? <p className="rounded-lg border border-line p-6 text-center text-muted">Nenhum membro ainda.</p> :
            members.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-line p-3 text-sm">
                <div><span className="font-medium">{m.name}</span>{m.extension && <span className="ml-2 text-xs text-muted">ramal {m.extension}</span>}</div>
                <button onClick={() => remove(m)} className="text-xs text-red-500 underline">Remover</button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// =============================== util ===============================
function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2" />
    </label>
  );
}
