"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

type Conv = {
  id: string; channel: string; status: string; priority: string; subject: string | null;
  customerId?: string | null;
  contactName: string | null; contactPhone: string | null; contactEmail?: string | null; lastMessageAt: string | null;
  unreadAgent: number; assigneeMembershipId: string | null; messageCount?: number;
  assigneeName?: string | null; teamName?: string | null; tokenStatus?: string;
  lockedByOther?: boolean; assignedToMe?: boolean;
  messages?: { content: string | null; direction: string; createdAt: string }[];
  labels?: { label: { id: string; name: string; color: string | null } }[];
};
type Agent = { membershipId: string; name: string };
type Team = { id: string; name: string };
type Msg = { id: string; direction: string; authorType: string; authorName: string | null; content: string | null; contentType?: string; mediaUrl?: string | null; mediaMime?: string | null; isPrivate: boolean; createdAt: string };
type Detail = Omit<Conv, "messages"> & { messages: Msg[]; pendingAppointment?: { id: string; startsAt: string; serviceName: string | null } | null };
type Canned = { id: string; shortcut: string; title: string | null; body: string; scope?: string; mine?: boolean };

const STATUS: Record<string, string> = { open: "Aberta", pending: "Pendente", snoozed: "Adiada", resolved: "Resolvida" };
const CH_ICON: Record<string, string> = { whatsapp: "🟢", email: "✉️", webchat: "💬" };

/** Renderiza texto destacando @nome em chip colorido. Usado em notas internas
 *  pra realçar quem foi mencionado. Faz split simples por regex. */
function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[\p{L}][\p{L}0-9_]*)/u);
  return parts.map((p, i) => p.startsWith("@") ? (
    <span key={i} className="rounded bg-brand/20 px-1 font-medium text-brand">{p}</span>
  ) : p);
}

/** Selo de SLA: tempo que o cliente está aguardando resposta (última mensagem
 *  é do cliente e ainda não respondemos). Verde até agentMin, âmbar até
 *  customerMin, vermelho acima (limiares configuráveis no Call Center). */
function waitBadge(lastMsg?: { direction: string; createdAt: string } | null, agentMin = 2, customerMin = 10): { label: string; cls: string } | null {
  if (!lastMsg || lastMsg.direction !== "in") return null;
  const mins = Math.max(0, Math.floor((Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000));
  const cls = mins >= customerMin ? "bg-red-500/20 text-red-300" : mins >= agentMin ? "bg-amber-500/20 text-amber-300" : "bg-green-500/20 text-green-300";
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : `${mins}m`;
  return { label: `⏱ ${label}`, cls };
}

export function AtendimentoClient() {
  const dialog = useDialog();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("open");
  // Filtro pela conversa: busca por nome/telefone/protocolo + range de datas
  // (operador busca conversas antigas — mês passado, semana específica, etc).
  // Quando o range estiver setado, força o filter pra "all" pra mostrar resolvidas também.
  const [searchQ, setSearchQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [canned, setCanned] = useState<Canned[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [tabulations, setTabulations] = useState<{ id: string; name: string; groupName: string | null }[]>([]);
  const [resolving, setResolving] = useState(false);
  const [tabSel, setTabSel] = useState("");
  const [tabNote, setTabNote] = useState("");
  const [sellOpen, setSellOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [tokenCode, setTokenCode] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalUnread, setInternalUnread] = useState(0);
  const [counts, setCounts] = useState({ open: 0, pendingReplied: 0, newBoxes: 0, bot: 0, mine: 0, waiting: 0 });
  // Drawer com notas permanentes + timeline cross-canal do cliente
  const [customerDrawer, setCustomerDrawer] = useState(false);
  // Macros pra executar em 1 clique sobre a conversa aberta
  const [macros, setMacros] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  // Operadores pra autocomplete de @menção em notas internas
  const [mentionables, setMentionables] = useState<Array<{ membershipId: string; fullName: string; firstName: string }>>([]);
  const [mentionOpen, setMentionOpen] = useState<{ query: string } | null>(null);
  useEffect(() => {
    fetch("/api/inbox/macros", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMacros(d.items ?? []))
      .catch(() => undefined);
    fetch("/api/inbox/mentionables", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMentionables(d.items ?? []))
      .catch(() => undefined);
  }, []);
  // Se URL veio com ?open=<convId> (notificação push de menção/etc), abre direto
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const id = p.get("open");
    if (id) {
      setOpenId(id);
      // limpa o param da URL pra não reabrir em refresh
      const u = new URL(window.location.href);
      u.searchParams.delete("open");
      window.history.replaceState({}, "", u.toString());
    }
  }, []);
  // detecta @palavra no fim do texto da nota interna pra abrir autocomplete
  function handleReplyChange(v: string) {
    setReply(v);
    if (!internal) { setMentionOpen(null); return; }
    const m = v.match(/@(\p{L}[\p{L}0-9_]*)$/u);
    setMentionOpen(m ? { query: m[1].toLowerCase() } : null);
  }
  function pickMention(firstName: string) {
    setReply((prev) => prev.replace(/@(\p{L}[\p{L}0-9_]*)$/u, `@${firstName} `));
    setMentionOpen(null);
  }
  async function runMacroOnOpen(macroId: string) {
    if (!openId) return;
    const r = await fetch(`/api/inbox/conversations/${openId}/run-macro/${macroId}`, { method: "POST", credentials: "include" });
    if (r.ok) { dialog.toast("Macro executada ✅", "success"); loadDetail(openId); loadConvs(); }
    else { const d = await r.json().catch(() => ({})); dialog.toast(d?.error?.message ?? "Falha", "error"); }
  }
  // Bulk actions: ids selecionados na lista lateral
  const [bulkSel, setBulkSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleBulk = (id: string) => setBulkSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearBulk = () => setBulkSel(new Set());
  async function runBulk(action: string, extra?: Record<string, unknown>) {
    if (bulkSel.size === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/inbox/conversations/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ids: Array.from(bulkSel), action, ...(extra ?? {}) }),
      });
      const d = await r.json();
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      dialog.toast(`${d?.affected ?? 0} conversa(s) atualizada(s)`, "success");
      clearBulk();
      loadConvs();
    } finally { setBulkBusy(false); }
  }
  const [presence, setPresence] = useState<{ status: string; activeCount: number; maxConcurrent: number }>({ status: "offline", activeCount: 0, maxConcurrent: 6 });
  const [sla, setSla] = useState({ slaCustomerMin: 10, slaAgentMin: 2 });
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const hasModule = useCallback((key: string) => enabledModules === null || enabledModules.includes(key), [enabledModules]);
  // config botão-a-botão do call center (null = segue os módulos)
  const [callcenterCfg, setCallcenterCfg] = useState<string[] | null>(null);
  const showBtn = useCallback((btn: string, moduleKey: string) => (callcenterCfg === null ? hasModule(moduleKey) : callcenterCfg.includes(btn)), [callcenterCfg, hasModule]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const notifPrevRef = useRef<Record<string, number>>({});
  const notifReadyRef = useRef(false);
  const openIdRef = useRef<string | null>(null);
  useEffect(() => { openIdRef.current = openId; }, [openId]);

  const loadPresence = useCallback(() => {
    fetch("/api/inbox/presence/me", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setPresence(d)).catch(() => {});
  }, []);
  async function changePresence(status: "online" | "paused" | "offline") {
    if (status === "online" && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
    }
    const res = await fetch("/api/inbox/presence", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    const d = await res.json().catch(() => null);
    if (d) setPresence(d);
    loadConvs();
  }
  useEffect(() => { loadPresence(); }, [loadPresence]);
  useEffect(() => { fetch("/api/inbox/settings", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setSla(d)).catch(() => {}); }, []);
  const loadInternalUnread = useCallback(() => {
    fetch("/api/inbox/internal/unread", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setInternalUnread(d.count ?? 0)).catch(() => {});
  }, []);
  useEffect(() => { loadInternalUnread(); const t = setInterval(loadInternalUnread, 20000); return () => clearInterval(t); }, [loadInternalUnread]);
  const loadCounts = useCallback(() => {
    fetch("/api/inbox/counts", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setCounts(d)).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); const t = setInterval(loadCounts, 10000); return () => clearInterval(t); }, [loadCounts]);

  async function sendTranscript() {
    if (!openId) return;
    const email = await dialog.prompt({ title: "Enviar transcrição por e-mail", message: "Para qual e-mail?", defaultValue: detail?.contactEmail ?? "", placeholder: "cliente@email.com" });
    if (email === null) return;
    const res = await fetch(`/api/inbox/conversations/${openId}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim() || undefined }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) dialog.toast(d?.error?.message ?? "Não foi possível enviar", "error");
    else dialog.toast(`Transcrição enviada para ${d.email} ✅`, "success");
  }
  // batimento de presença (mantém online + puxa da fila)
  useEffect(() => {
    if (presence.status !== "online") return;
    const t = setInterval(() => {
      fetch("/api/inbox/presence/heartbeat", { method: "POST", credentials: "include", headers: { "x-no-loading": "1" } }).catch(() => {});
      loadPresence(); loadConvs();
    }, 30000);
    return () => clearInterval(t);
  }, [presence.status, loadPresence]);

  const loadCanned = useCallback(() => {
    fetch("/api/inbox/canned", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanned(d.items ?? [])).catch(() => {});
  }, []);

  async function requestToken() {
    if (!openId) return;
    await fetch(`/api/inbox/conversations/${openId}/token/request`, { method: "POST", credentials: "include" });
    loadDetail(openId);
  }
  async function validateToken() {
    if (!openId || tokenCode.length !== 4) return;
    const res = await fetch(`/api/inbox/conversations/${openId}/token/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ code: tokenCode }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) dialog.toast(d?.error?.message ?? "Código incorreto", "error");
    else dialog.toast("Token validado ✅", "success");
    setTokenCode(""); loadDetail(openId);
  }

  const loadOrders = useCallback((id: string) => {
    fetch(`/api/inbox/conversations/${id}/orders`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setOrders(d.items ?? [])).catch(() => {});
  }, []);
  async function cancelOrder(orderId: string) {
    const ok = await dialog.confirm({ title: "Cancelar cobrança", message: "Suspende esta cobrança pendente. Confirma?" });
    if (!ok) return;
    const res = await fetch(`/api/inbox/orders/${orderId}/cancel`, { method: "POST", credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok) dialog.toast(d?.error?.message ?? "Não foi possível cancelar", "error");
    if (openId) { loadOrders(openId); loadDetail(openId); }
  }
  useEffect(() => { if (openId) loadOrders(openId); }, [openId, loadOrders]);
  // autorefresh dos pedidos pendentes
  useEffect(() => {
    if (!openId || !orders.some((o) => o.status === "pending")) return;
    const t = setInterval(() => {
      orders.filter((o) => o.status === "pending").forEach((o) => {
        fetch(`/api/inbox/orders/${o.id}/check`, { method: "POST", credentials: "include", headers: { "x-no-loading": "1" } })
          .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.status === "paid") loadOrders(openId); }).catch(() => {});
      });
    }, 5000);
    return () => clearInterval(t);
  }, [openId, orders, loadOrders]);

  const loadConvs = useCallback(() => {
    // Constrói querystring com filtros opcionais. Quando há range de data ou busca,
    // força status=all pra incluir conversas resolvidas (histórico).
    const params = new URLSearchParams();
    const hasFilter = !!(searchQ || dateFrom || dateTo);
    params.set("status", hasFilter ? "all" : filter);
    if (searchQ.trim()) params.set("q", searchQ.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    fetch(`/api/inbox/conversations?${params.toString()}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const items: Conv[] = d.items ?? [];
        // notificação rápida no navegador quando o cliente responde
        if (notifReadyRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const c of items) {
            const prev = notifPrevRef.current[c.id] ?? 0;
            if (c.unreadAgent > prev && c.id !== openIdRef.current) {
              try {
                const n = new Notification(c.contactName || c.contactPhone || "Nova mensagem", { body: (c.messages?.[0]?.content ?? "Você recebeu uma nova mensagem").slice(0, 120), tag: c.id });
                n.onclick = () => { window.focus(); setOpenId(c.id); n.close(); };
              } catch {}
            }
          }
        }
        const map: Record<string, number> = {};
        for (const c of items) map[c.id] = c.unreadAgent;
        notifPrevRef.current = map;
        notifReadyRef.current = true;
        setConvs(items);
      })
      .catch(() => {});
  }, [filter, searchQ, dateFrom, dateTo]);

  const loadDetail = useCallback((id: string) => {
    fetch(`/api/inbox/conversations/${id}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setDetail(d); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50); } })
      .catch(() => {});
  }, []);

  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => { const t = setInterval(loadConvs, 8000); return () => clearInterval(t); }, [loadConvs]);
  useEffect(() => { loadCanned(); }, [loadCanned]);
  useEffect(() => {
    fetch("/api/inbox/agents", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setAgents(d.items ?? [])).catch(() => {});
    fetch("/api/inbox/teams", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTeams(d.items ?? [])).catch(() => {});
    fetch("/api/inbox/tabulations", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTabulations(d.items ?? [])).catch(() => {});
    fetch("/api/organizations/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const org = d?.organization ?? d;
      if (org) {
        setEnabledModules(Array.isArray(org.enabledModules) ? org.enabledModules : null);
        setCallcenterCfg(Array.isArray(org.callcenterConfig) ? org.callcenterConfig : null);
      }
    }).catch(() => {});
  }, []);

  async function doResolve() {
    if (!openId) return;
    const res = await fetch(`/api/inbox/conversations/${openId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ tabulationId: tabSel || null, note: tabNote || undefined }),
    });
    const d = await res.json().catch(() => null);
    setResolving(false); setTabSel(""); setTabNote("");
    if (res.ok && d?.protocol) dialog.alert({ title: "Atendimento finalizado", message: `Protocolo ${d.protocol} — enviado também ao cliente.` });
    loadDetail(openId); loadConvs();
  }
  useEffect(() => { if (openId) loadDetail(openId); }, [openId, loadDetail]);
  useEffect(() => {
    if (!openId) return;
    const t = setInterval(() => loadDetail(openId), 5000);
    return () => clearInterval(t);
  }, [openId, loadDetail]);

  async function send() {
    if (!reply.trim() || !openId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/conversations/${openId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ body: reply, isPrivate: internal }),
      });
      if (res.ok) { setReply(""); loadDetail(openId); loadConvs(); }
      else { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Não foi possível enviar", "error"); if (openId) loadDetail(openId); }
    } finally { setBusy(false); }
  }

  async function act(path: string, body: any) {
    if (!openId) return;
    const res = await fetch(`/api/inbox/conversations/${openId}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Ação não permitida", "error"); }
    loadDetail(openId); loadConvs();
  }

  async function confirmAppointment(aptId: string) {
    const res = await fetch(`/api/appointments/${aptId}/confirm`, { method: "PATCH", credentials: "include" });
    if (!res.ok) dialog.toast("Não foi possível confirmar", "error");
    else dialog.toast("Agendamento confirmado ✅", "success");
    if (openId) loadDetail(openId);
  }

  async function setPending() {
    const reason = await dialog.prompt({ title: "Deixar pendente", message: "Por que esta conversa fica pendente? (vai pro histórico)", placeholder: "Ex.: aguardando retorno do cliente" });
    if (reason === null) return;
    if (!reason.trim()) { dialog.toast("Informe o motivo", "error"); return; }
    await act("status", { status: "pending", reason: reason.trim() });
  }

  // upload (anexo/imagem/áudio) -> envia como mensagem com mídia
  async function sendMedia(file: File | Blob, filename: string, mime: string) {
    if (!openId) return;
    const fd = new FormData();
    fd.append("file", file, filename);
    fd.append("purpose", "inbox");
    const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
    const ud = await up.json().catch(() => null);
    if (!up.ok || !ud?.url) { dialog.toast(ud?.error?.message ?? "Falha no upload", "error"); return; }
    const contentType = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "file";
    await fetch(`/api/inbox/conversations/${openId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ body: contentType === "image" ? "" : filename, contentType, mediaUrl: ud.url, mediaMime: mime, isPrivate: internal }),
    });
    loadDetail(openId); loadConvs();
  }

  // gravação de áudio (MediaRecorder)
  const recRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        setRecording(false);
        sendMedia(blob, `audio-${Date.now()}.webm`, "audio/webm");
      };
      recRef.current = mr; mr.start(); setRecording(true);
    } catch { dialog.toast("Não foi possível acessar o microfone.", "error"); }
  }

  return (
    <div className="flex h-[calc(100vh-180px)] gap-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      {/* lista de conversas */}
      <div className="flex w-72 shrink-0 flex-col border-r border-line">
        {/* presença do operador */}
        <div className="flex items-center justify-between gap-2 border-b border-line p-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${presence.status === "online" ? "bg-green-400" : presence.status === "paused" ? "bg-amber-400" : "bg-zinc-500"}`} />
            <select value={presence.status} onChange={(e) => changePresence(e.target.value as any)}
              className="rounded-md border border-line bg-bg/40 px-1.5 py-1 text-xs">
              <option value="online">🟢 Disponível</option>
              <option value="paused">⏸ Pausado</option>
              <option value="offline">⚫ Offline</option>
            </select>
          </div>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${presence.activeCount >= presence.maxConcurrent ? "bg-red-500/20 text-red-300" : "bg-line text-muted"}`} title="Conversas ativas / limite">
            {presence.activeCount}/{presence.maxConcurrent}
          </span>
        </div>
        <div className="flex gap-1 border-b border-line p-2">
          <button onClick={() => setStartOpen(true)} className="flex-1 rounded-md bg-brand/15 px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand/25">➕ Iniciar conversa</button>
          <button onClick={() => setProtocolOpen(true)} className="rounded-md border border-line px-2 py-1.5 text-xs hover:border-brand" title="Buscar por protocolo/CPF/nome">🔎</button>
          <button onClick={() => { setInternalOpen(true); }} className="relative rounded-md border border-line px-2 py-1.5 text-xs hover:border-brand" title="Conversa interna entre atendentes">
            💬
            {internalUnread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{internalUnread}</span>}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-line p-2 text-xs">
          {(["mine", "waiting", "open", "bot", "pending", "snoozed", "resolved", "all"] as const).map((s) => {
            const badge =
              s === "mine" ? counts.mine
              : s === "waiting" ? counts.waiting
              : s === "open" ? counts.newBoxes
              : s === "pending" ? counts.pendingReplied
              : s === "bot" ? counts.bot
              : 0;
            const label =
              s === "mine" ? "Minhas"
              : s === "waiting" ? "Aguardando"
              : s === "open" ? "Abertas"
              : s === "bot" ? "🤖 Bot"
              : s === "pending" ? "Pendentes"
              : s === "snoozed" ? "💤 Adiadas"
              : s === "resolved" ? "Resolvidas"
              : "Todas";
            const badgeColor =
              s === "pending" ? "bg-amber-500"
              : s === "bot" ? "bg-blue-500"
              : s === "waiting" ? "bg-orange-500"
              : s === "mine" ? "bg-brand"
              : "bg-red-500";
            return (
              <button key={s} onClick={() => setFilter(s)} className={`relative rounded-md px-2 py-1 ${filter === s ? "bg-brand/20 text-fg" : "text-muted hover:bg-line"}`}>
                {label}
                {badge > 0 && <span className={`ml-1 rounded-full px-1 text-[9px] font-bold text-white ${badgeColor}`}>{badge}</span>}
              </button>
            );
          })}
        </div>
        {/* Filtros: busca textual + range de datas (operador procura histórico antigo) */}
        <div className="space-y-1.5 border-b border-line p-2">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Buscar por nome, telefone ou assunto…"
            className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs outline-none transition focus:border-brand"
          />
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-muted">📅</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface-2 px-1.5 py-1 text-[11px] outline-none transition focus:border-brand"
              title="Conversas a partir desta data"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface-2 px-1.5 py-1 text-[11px] outline-none transition focus:border-brand"
              title="Conversas até esta data"
            />
            {(searchQ || dateFrom || dateTo) && (
              <button onClick={() => { setSearchQ(""); setDateFrom(""); setDateTo(""); }} className="rounded-md border border-line px-1.5 py-1 text-[11px] text-muted hover:border-brand hover:text-fg" title="Limpar filtros">✕</button>
            )}
          </div>
          {(searchQ || dateFrom || dateTo) && (
            <p className="text-[10px] text-muted">Filtro ativo: busca em todas as conversas (inclusive resolvidas).</p>
          )}
        </div>
        <div className="scroll-themed flex-1 overflow-y-auto">
          {bulkSel.size > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-line bg-bg/95 p-2 text-xs backdrop-blur">
              <span className="mr-auto font-semibold text-brand">{bulkSel.size} selecionada(s)</span>
              <button disabled={bulkBusy} onClick={() => runBulk("resolve")} className="rounded-md border border-green-500/50 px-2 py-1 text-green-300 hover:bg-green-500/10 disabled:opacity-40">Resolver</button>
              <button disabled={bulkBusy} onClick={async () => {
                const teams = await fetch("/api/inbox/teams", { credentials: "include" }).then((r) => r.json()).then((d) => d?.items ?? []).catch(() => []);
                if (!teams.length) { dialog.toast("Sem equipes pra transferir", "error"); return; }
                const choice = await dialog.prompt({ title: "Transferir pra equipe", message: `Digite o nome da equipe (${teams.map((t: any) => t.name).join(", ")})`, placeholder: "Equipe" });
                if (!choice) return;
                const team = teams.find((t: any) => t.name.toLowerCase() === choice.toLowerCase());
                if (!team) { dialog.toast("Equipe não encontrada", "error"); return; }
                runBulk("transfer", { teamId: team.id });
              }} className="rounded-md border border-line px-2 py-1 hover:border-brand disabled:opacity-40">Transferir</button>
              <button disabled={bulkBusy} onClick={() => runBulk("assign", { assigneeMembershipId: null })} className="rounded-md border border-line px-2 py-1 text-muted hover:border-brand disabled:opacity-40">Tirar dono</button>
              <button onClick={clearBulk} className="rounded-md border border-line px-2 py-1 text-muted hover:border-brand">Limpar</button>
            </div>
          )}
          {convs.length === 0 ? (
            <p className="p-4 text-xs text-muted">Nenhuma conversa.</p>
          ) : convs.map((c) => (
            <div key={c.id}
              className={`flex w-full items-start gap-2 border-b border-line/50 p-3 transition hover:bg-line/40 ${openId === c.id ? "bg-brand/10" : ""}`}>
              <input
                type="checkbox"
                checked={bulkSel.has(c.id)}
                onChange={(e) => { e.stopPropagation(); toggleBulk(c.id); }}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand"
                title="Selecionar pra ação em lote"
              />
              <button onClick={() => setOpenId(c.id)} className="flex flex-1 flex-col gap-0.5 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {CH_ICON[c.channel] ?? ""} {c.contactName || c.contactPhone || "Desconhecido"}
                    {typeof c.messageCount === "number" && c.messageCount > 0 && <span className="ml-1 text-[10px] font-normal text-muted">💬{c.messageCount}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {(() => { const b = waitBadge(c.messages?.[0], sla.slaAgentMin, sla.slaCustomerMin); return b ? <span className={`rounded-full px-1.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span> : null; })()}
                    {c.unreadAgent > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{c.unreadAgent}</span>}
                  </span>
                </div>
                <span className="truncate text-xs text-muted">{c.messages?.[0]?.content ?? c.subject ?? "—"}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex flex-1 flex-col">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Selecione uma conversa</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium">
                  <span>{detail.contactName || detail.contactPhone || "Desconhecido"}</span>
                  {/* Botão pra renomear o contato — operador corrige nomes errados
                     do WhatsApp (pushName genérico, nome de empresa, etc) */}
                  <button
                    onClick={async () => {
                      const nome = await dialog.prompt({
                        title: "Renomear contato",
                        message: "Como você quer que esse contato apareça?",
                        defaultValue: detail.contactName ?? "",
                        placeholder: "Nome do cliente",
                      });
                      if (!nome || !nome.trim()) return;
                      const res = await fetch(`/api/inbox/conversations/${detail.id}/rename-contact`, {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: nome.trim() }),
                      });
                      const j = await res.json().catch(() => null);
                      if (res.ok) { dialog.toast("Nome atualizado ✅", "success"); loadDetail(detail.id); loadConvs(); }
                      else dialog.toast(j?.error?.message ?? "Falha ao renomear", "error");
                    }}
                    title="Renomear contato (atualiza em toda a base, se vinculado a um cliente)"
                    className="text-xs text-muted hover:text-brand"
                  >✏️</button>
                  {(() => { const b = waitBadge(detail.messages[detail.messages.length - 1], sla.slaAgentMin, sla.slaCustomerMin); return b ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`} title="Cliente aguardando resposta">{b.label}</span> : null; })()}
                </p>
                <p className="text-xs text-muted">{CH_ICON[detail.channel]} {detail.channel} · {STATUS[detail.status] ?? detail.status}{detail.subject ? ` · ${detail.subject}` : ""}</p>
                <p className="mt-0.5 text-[11px]">
                  {detail.assigneeName
                    ? <span className="text-brand">Atribuído a {detail.assigneeName}</span>
                    : detail.teamName
                      ? <span className="text-orange-300">Equipe {detail.teamName} · aguardando atendente</span>
                      : <span className="text-muted">Sem atendente</span>}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  {detail.tokenStatus === "validated"
                    ? <span className="rounded-full bg-green-500/20 px-2 py-0.5 font-semibold text-green-300">🟢 token validado</span>
                    : detail.tokenStatus === "pending"
                      ? <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">🟡 token não validado</span>
                      : detail.tokenStatus === "failed"
                        ? <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-semibold text-red-300">🔴 token falhou</span>
                        : <span className="rounded-full bg-line px-2 py-0.5 text-muted">⚪ token não solicitado</span>}
                  {detail.tokenStatus === "pending" ? (
                    <>
                      <input value={tokenCode} onChange={(e) => setTokenCode(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" inputMode="numeric"
                        className="w-16 rounded border border-line bg-bg/40 px-1 py-0.5 text-center font-mono" />
                      <button onClick={validateToken} className="text-brand hover:underline">validar</button>
                      <button onClick={requestToken} className="text-muted hover:text-fg">reenviar</button>
                    </>
                  ) : detail.tokenStatus !== "validated" && (
                    <button onClick={requestToken} className="text-brand hover:underline">solicitar token</button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                {detail.assigneeName
                  ? <span className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-brand" title="Responsável">✓ {detail.assigneeName}</span>
                  : <button onClick={() => act("assign", { membershipId: "me" })} className="rounded-md border border-line px-2 py-1 hover:border-brand" title="Atribuir a mim">Pegar</button>}
                <button onClick={() => setTransferOpen(true)} className="rounded-md border border-line px-2 py-1 hover:border-brand">Transferir</button>
                {showBtn("vender", "vendas") && <button onClick={() => setSellOpen(true)} className="rounded-md border border-brand/50 px-2 py-1 text-brand hover:bg-brand/10">Vender</button>}
                {showBtn("agenda", "agenda") && <button onClick={() => setAgendaOpen(true)} className="rounded-md border border-line px-2 py-1 hover:border-brand" title="Agendar/confirmar/cancelar sem sair do atendimento">📅 Agenda</button>}
                {detail.customerId && <button onClick={() => setCustomerDrawer(true)} className="rounded-md border border-line px-2 py-1 hover:border-brand" title="Notas permanentes + histórico do cliente em todos os canais">📒 Cliente</button>}
                {macros.length > 0 && (
                  <select
                    onChange={async (e) => { const id = e.target.value; e.currentTarget.value = ""; if (id) await runMacroOnOpen(id); }}
                    defaultValue=""
                    title="Executar macro (1 clique faz várias ações)"
                    className="rounded-md border border-line bg-bg/40 px-2 py-1 text-xs"
                  >
                    <option value="">⚡ macros…</option>
                    {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                <button onClick={sendTranscript} className="rounded-md border border-line px-2 py-1 hover:border-brand" title="Enviar transcrição por e-mail">✉️</button>
                {detail.status === "snoozed" ? (
                  <button onClick={async () => { if (!openId) return; await fetch(`/api/inbox/conversations/${openId}/unsnooze`, { method: "POST", credentials: "include" }); dialog.toast("Conversa reativada", "success"); loadDetail(openId); loadConvs(); }} className="rounded-md border border-sky-500/50 px-2 py-1 text-sky-300 hover:bg-sky-500/10" title="Tirar do snooze e voltar para fila">▶ Reativar</button>
                ) : (
                  <select
                    onChange={async (e) => {
                      const until = e.target.value; e.currentTarget.value = "";
                      if (!until || !openId) return;
                      const r = await fetch(`/api/inbox/conversations/${openId}/snooze`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ until }) });
                      if (r.ok) { dialog.toast("Conversa adiada 💤", "success"); setOpenId(null); loadConvs(); }
                      else { const d = await r.json().catch(() => ({})); dialog.toast(d?.error?.message ?? "Falha", "error"); }
                    }}
                    defaultValue=""
                    title="Adiar conversa (reaparece quando o tempo passar)"
                    className="rounded-md border border-line bg-bg/40 px-2 py-1 text-xs"
                  >
                    <option value="">💤 adiar…</option>
                    <option value="1h">+1 hora</option>
                    <option value="4h">+4 horas</option>
                    <option value="tomorrow_9am">amanhã 9h</option>
                    <option value="next_monday_9am">próxima 2ª-feira 9h</option>
                  </select>
                )}
                {detail.status === "open" && <button onClick={setPending} className="rounded-md border border-amber-500/50 px-2 py-1 text-amber-300 hover:bg-amber-500/10">Pendente</button>}
                {detail.status !== "resolved" && (
                  <button
                    onClick={async () => {
                      if (!openId) return;
                      await fetch(`/api/inbox/conversations/${openId}/mark-unread`, { method: "POST", credentials: "include" });
                      dialog.toast("Marcada como não lida (volta pra fila)", "success");
                      setOpenId(null); loadConvs();
                    }}
                    className="rounded-md border border-sky-500/40 px-2 py-1 text-sky-300 hover:bg-sky-500/10"
                    title="Marcar como não lida — volta pra sua fila"
                  >
                    ✉ Não lida
                  </button>
                )}
                {detail.status !== "resolved"
                  ? <button onClick={() => setResolving(true)} className="rounded-md border border-green-500/50 px-2 py-1 text-green-300 hover:bg-green-500/10">Resolver</button>
                  : <button onClick={() => act("status", { status: "open" })} className="rounded-md border border-line px-2 py-1 hover:border-brand">Reabrir</button>}
              </div>
            </div>
            {detail.pendingAppointment && (
              <div className="flex items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <span>⚠️ Agendamento <strong>pendente de confirmação</strong>: {new Date(detail.pendingAppointment.startsAt).toLocaleString("pt-BR")}{detail.pendingAppointment.serviceName ? ` · ${detail.pendingAppointment.serviceName}` : ""}</span>
                <span className="flex shrink-0 gap-2">
                  <button onClick={() => confirmAppointment(detail.pendingAppointment!.id)} className="rounded-md border border-green-500/50 px-2 py-0.5 text-green-300 hover:bg-green-500/10">confirmar</button>
                  <button onClick={() => setAgendaOpen(true)} className="rounded-md border border-line px-2 py-0.5 hover:border-brand">agenda</button>
                </span>
              </div>
            )}
            {resolving && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResolving(false)}>
                <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-base font-semibold">Finalizar atendimento</h3>
                  <p className="mt-1 text-xs text-muted">Tabule o motivo (vai pros relatórios) e gere o protocolo.</p>
                  <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">Tabulação</p>
                  <select value={tabSel} onChange={(e) => setTabSel(e.target.value)} className="input-base mt-1">
                    <option value="">Selecione…</option>
                    {tabulations.map((t) => <option key={t.id} value={t.id}>{t.groupName ? `${t.groupName} · ` : ""}{t.name}</option>)}
                  </select>
                  <textarea value={tabNote} onChange={(e) => setTabNote(e.target.value)} rows={2} placeholder="Observação (opcional)"
                    className="input-base mt-2" />
                  <div className="mt-4 flex gap-2">
                    <button onClick={doResolve} className="btn-grad flex-1 py-2">Finalizar e gerar protocolo</button>
                    <button onClick={() => setResolving(false)} className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
                  </div>
                </div>
              </div>
            )}
            {transferOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTransferOpen(false)}>
                <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-base font-semibold">Transferir atendimento</h3>
                  <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">Para uma pessoa</p>
                  <select onChange={(e) => { if (e.target.value) { act("transfer", { toMembershipId: e.target.value }); setTransferOpen(false); } }} defaultValue=""
                    className="input-base mt-1">
                    <option value="">Selecione…</option>
                    {agents.map((a) => <option key={a.membershipId} value={a.membershipId}>{a.name}</option>)}
                  </select>
                  <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">Para uma equipe (fica pendente até alguém pegar)</p>
                  <select onChange={(e) => { if (e.target.value) { act("transfer", { toTeamId: e.target.value }); setTransferOpen(false); } }} defaultValue=""
                    className="input-base mt-1">
                    <option value="">Selecione…</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button onClick={() => setTransferOpen(false)} className="mt-4 w-full rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
                </div>
              </div>
            )}

            <div className="scroll-themed flex-1 space-y-2 overflow-y-auto p-3">
              {detail.messages.map((m) => {
                const out = m.direction === "out";
                const bot = m.authorType === "bot";
                const sys = m.authorType === "system" || m.contentType === "event";
                // Resposta enviada pelo DONO direto no WhatsApp (fora do sistema) —
                // visualmente diferente pra ficar óbvio que NÃO veio pelo painel.
                const direct = m.authorType === "whatsapp_direto";
                if (m.isPrivate) {
                  return <div key={m.id} className="mx-auto max-w-[90%] rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">📝 {m.content}</div>;
                }
                const mime = m.mediaMime ?? "";
                const bubbleCls = direct
                  ? "ml-auto border-2 border-dashed border-emerald-500/40 bg-emerald-500/10"
                  : out ? "ml-auto bg-brand/15" : "bg-line/60";
                return (
                  <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${bubbleCls}`}>
                    {direct && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">📱 enviado pelo WhatsApp (fora do sistema)</p>
                    )}
                    {m.mediaUrl && (m.contentType === "image" || mime.startsWith("image/")) && (
                      <a href={m.mediaUrl} target="_blank" rel="noreferrer"><img src={m.mediaUrl} alt="" className="mb-1 max-h-60 rounded-md object-contain" /></a>
                    )}
                    {m.mediaUrl && (m.contentType === "audio" || mime.startsWith("audio/")) && (
                      <audio controls src={m.mediaUrl} className="mb-1 w-56" />
                    )}
                    {m.mediaUrl && (m.contentType === "video" || mime.startsWith("video/")) && (
                      <video controls src={m.mediaUrl} className="mb-1 max-h-60 rounded-md" />
                    )}
                    {m.mediaUrl && m.contentType === "file" && (
                      <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block text-brand underline">📎 {m.content || "anexo"}</a>
                    )}
                    {m.content && m.contentType !== "image" && <p className="whitespace-pre-wrap">{renderWithMentions(m.content)}</p>}
                    <p className="mt-1 text-[10px] text-muted">{bot ? "🤖 Bot" : out ? (m.authorName || "Você") : (m.authorName || "Cliente")} · {new Date(m.createdAt).toLocaleString("pt-BR")}</p>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {orders.length > 0 && (
              <div className="border-t border-line px-3 py-2">
                {orders.map((o) => (
                  <div key={o.id} className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span>🛒 {o.orderNumber} · {(Number(o.totalCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {o.method === "pix" ? "Pix" : "Cartão"}</span>
                    {o.status === "paid"
                      ? <span className="rounded-full bg-green-500/20 px-2 py-0.5 font-semibold text-green-300">pago</span>
                      : o.status === "canceled"
                        ? <span className="rounded-full bg-line px-2 py-0.5 font-semibold text-muted">cancelada</span>
                        : (
                          <span className="flex items-center gap-2">
                            <span className="rounded-full bg-orange-500/20 px-2 py-0.5 font-semibold text-orange-300">aguardando pagamento</span>
                            <button onClick={() => cancelOrder(o.id)} className="text-[11px] text-red-300 hover:underline">cancelar</button>
                          </span>
                        )}
                  </div>
                ))}
              </div>
            )}
            {sellOpen && <SellModal conversationId={openId!} onClose={() => setSellOpen(false)} onSent={() => { setSellOpen(false); if (openId) { loadOrders(openId); loadDetail(openId); } }} />}

            {detail.lockedByOther ? (
              <div className="border-t border-line p-4 text-center text-sm text-amber-300">
                🔒 Em atendimento por <strong>{detail.assigneeName ?? "outro operador"}</strong>. Só ele (ou um admin) pode responder.
              </div>
            ) : (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-muted">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> nota interna
                </label>
                {canned.length > 0 && (
                  <select
                    onChange={async (e) => {
                      const c = canned.find((x) => x.id === e.target.value);
                      e.currentTarget.value = "";
                      if (!c || !openId) return;
                      // Renderiza com variáveis substituídas pelo contexto da conversa
                      try {
                        const r = await fetch(`/api/inbox/conversations/${openId}/render-canned`, {
                          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                          body: JSON.stringify({ body: c.body }),
                        });
                        const d = await r.json();
                        setReply((prev) => prev + (d?.rendered ?? c.body));
                      } catch {
                        setReply((prev) => prev + c.body);
                      }
                    }}
                    className="rounded-md border border-line bg-bg/40 px-2 py-1 text-xs">
                    <option value="">resposta rápida…</option>
                    {canned.map((c) => <option key={c.id} value={c.id}>/{c.shortcut} {c.title ? `— ${c.title}` : ""} {c.scope === "private" ? "🔒" : c.scope === "shared" ? "👥" : ""}</option>)}
                  </select>
                )}
                <button onClick={() => setCannedOpen(true)} className="text-muted hover:text-fg" title="Gerenciar respostas rápidas">⚙️</button>
              </div>
              <div className="flex items-end gap-2">
                <label className="cursor-pointer rounded-lg border border-line px-2 py-2 text-sm hover:border-brand" title="Anexar arquivo/imagem">
                  📎
                  <input type="file" accept="image/*,application/pdf,audio/*,video/mp4" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMedia(f, f.name, f.type || "application/octet-stream"); e.currentTarget.value = ""; }} />
                </label>
                <button onClick={toggleRecord} title="Gravar áudio" className={`rounded-lg border px-2 py-2 text-sm ${recording ? "border-red-500 text-red-300 animate-pulse" : "border-line hover:border-brand"}`}>
                  {recording ? "⏹" : "🎤"}
                </button>
                <div className="relative flex-1">
                  <textarea value={reply} onChange={(e) => handleReplyChange(e.target.value)} rows={2} placeholder={internal ? "Nota interna (cliente não vê). Use @nome pra avisar alguém…" : "Responder…"}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !mentionOpen) { e.preventDefault(); send(); } }}
                    className={`w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:ring-2 ${internal ? "border-amber-500/50" : "border-line focus:border-brand"}`} style={{ ["--tw-ring-color" as any]: "rgb(var(--ring) / 0.35)" }} />
                  {mentionOpen && internal && (() => {
                    const q = mentionOpen.query;
                    const matches = mentionables.filter((m) => m.firstName.toLowerCase().startsWith(q)).slice(0, 6);
                    if (matches.length === 0) return null;
                    return (
                      <div className="absolute bottom-full left-0 mb-1 max-h-48 w-56 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                        {matches.map((m) => (
                          <button key={m.membershipId} onClick={() => pickMention(m.firstName)} className="block w-full px-3 py-2 text-left text-xs hover:bg-line/40">
                            <span className="font-medium">@{m.firstName}</span>
                            <span className="ml-2 text-muted">{m.fullName}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <button disabled={busy || !reply.trim()} onClick={send} className="btn-grad self-stretch px-4 disabled:opacity-50">Enviar</button>
              </div>
            </div>
            )}
          </>
        )}
      </div>

      {startOpen && <StartConversationModal onClose={() => setStartOpen(false)} onStarted={(id) => { setStartOpen(false); setOpenId(id); setFilter("open"); loadConvs(); }} />}
      {protocolOpen && <ProtocolSearchModal onClose={() => setProtocolOpen(false)} onOpen={(id) => { setProtocolOpen(false); setOpenId(id); setFilter("all"); loadConvs(); }} />}
      {cannedOpen && <CannedManager items={canned} onClose={() => setCannedOpen(false)} onChanged={loadCanned} />}
      {agendaOpen && detail && <AgendaModal customerId={detail.customerId ?? null} customerName={detail.contactName ?? detail.contactPhone ?? "cliente"} contactPhone={detail.contactPhone ?? null} conversationId={openId ?? ""} onClose={() => setAgendaOpen(false)} onChanged={() => { if (openId) loadDetail(openId); }} />}
      {customerDrawer && detail?.customerId && <CustomerDrawer customerId={detail.customerId} customerName={detail.contactName ?? detail.contactPhone ?? "cliente"} onClose={() => setCustomerDrawer(false)} />}
      {internalOpen && <InternalChatModal onClose={() => { setInternalOpen(false); loadInternalUnread(); }} onRead={loadInternalUnread} />}
    </div>
  );
}

type Prod = { id: string; name: string; sku?: string | null; priceCashCents: number | null };
function SellModal({ conversationId, onClose, onSent }: { conversationId: string; onClose: () => void; onSent: () => void }) {
  const dialog = useDialog();
  const [prods, setProds] = useState<Prod[]>([]);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Array<{ name: string; qty: number; unitCents: number }>>([]);
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/products?activeOnly=true", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setProds(d.items ?? [])).catch(() => {});
  }, []);
  const filtered = q.trim() ? prods.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(q.toLowerCase())) : prods.slice(0, 30);
  const total = cart.reduce((s, i) => s + i.qty * i.unitCents, 0);
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function add(p: Prod) {
    setCart((c) => {
      const ex = c.find((x) => x.name === p.name);
      if (ex) return c.map((x) => (x.name === p.name ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { name: p.name, qty: 1, unitCents: p.priceCashCents ?? 0 }];
    });
  }
  async function submit() {
    if (!cart.length) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ items: cart, method }),
      });
      if (res.ok) onSent(); else dialog.toast("Falha ao gerar a cobrança", "error");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Vender pelo chat</h3>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto (nome/SKU)" className="input-base mt-3" />
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {filtered.map((p) => (
            <button key={p.id} onClick={() => add(p)} className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-left text-sm transition hover:border-brand">
              <span className="truncate">{p.name}</span><span className="text-xs text-muted">{brl(p.priceCashCents ?? 0)}</span>
            </button>
          ))}
        </div>
        {cart.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-surface-2 p-2">
            {cart.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate">{i.name}</span>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} value={i.qty} onChange={(e) => setCart((c) => c.map((x, j) => (j === idx ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} className="w-14 rounded-lg border border-line bg-surface px-1 py-0.5 text-xs" />
                  <span className="w-20 text-right text-xs">{brl(i.qty * i.unitCents)}</span>
                  <button onClick={() => setCart((c) => c.filter((_, j) => j !== idx))} className="text-danger">×</button>
                </div>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-sm font-semibold"><span>Total</span><span>{brl(total)}</span></div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-muted">Pagamento:</span>
          <label className="flex items-center gap-1"><input type="radio" checked={method === "pix"} onChange={() => setMethod("pix")} className="accent-brand" /> Pix</label>
          <label className="flex items-center gap-1"><input type="radio" checked={method === "card"} onChange={() => setMethod("card")} className="accent-brand" /> Cartão</label>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy || cart.length === 0} onClick={submit} className="btn-grad flex-1 py-2 disabled:opacity-50">
            {busy ? "Enviando…" : `Enviar cobrança (${brl(total)})`}
          </button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
        <p className="mt-2 text-[10px] text-muted">Envia a descrição + valores e o {method === "pix" ? "Pix copia-e-cola" : "link de cartão"} pro cliente. O status atualiza sozinho quando pagar.</p>
      </div>
    </div>
  );
}

// ---- Iniciar conversa (cliente cadastrado OU telefone avulso) ----
type Cust = { id: string; name: string; document?: string | null; phone?: string | null; whatsappPhone?: string | null };
function StartConversationModal({ onClose, onStarted }: { onClose: () => void; onStarted: (conversationId: string) => void }) {
  const dialog = useDialog();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cust[]>([]);
  const [picked, setPicked] = useState<Cust | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(term)}&limit=8`, { credentials: "include", headers: { "x-no-loading": "1" } })
        .then((r) => (r.ok ? r.json() : null)).then((d) => d && setResults(d.items ?? [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function submit() {
    const body: any = { message: message.trim() || undefined };
    if (picked) body.customerId = picked.id;
    else { if (!phone.trim()) { dialog.toast("Informe um telefone ou escolha um cliente", "error"); return; } body.phone = phone.trim(); body.name = name.trim() || undefined; }
    setBusy(true);
    try {
      const res = await fetch("/api/inbox/conversations/start", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.conversationId) { dialog.toast(d?.error?.message ?? "Não foi possível iniciar", "error"); return; }
      if (d.pendingAppointment) {
        const dt = new Date(d.pendingAppointment.startsAt).toLocaleString("pt-BR");
        await dialog.alert({ title: "⚠️ Agendamento pendente de confirmação", message: `Este cliente tem um agendamento ainda não confirmado para ${dt}${d.pendingAppointment.serviceName ? ` (${d.pendingAppointment.serviceName})` : ""}.` });
      }
      onStarted(d.conversationId);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Iniciar conversa</h3>
        <p className="mt-1 text-xs text-muted">Busque um cliente cadastrado ou digite um telefone avulso.</p>

        {picked ? (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
            <span className="truncate">👤 {picked.name}{picked.document ? ` · ${picked.document}` : ""}</span>
            <button onClick={() => setPicked(null)} className="text-xs text-danger hover:underline">trocar</button>
          </div>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome / CPF / telefone" className="input-base mt-3" />
            {results.length > 0 && (
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {results.map((c) => (
                  <button key={c.id} onClick={() => { setPicked(c); setResults([]); setQ(""); }} className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-left text-sm transition hover:border-brand">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted">{c.whatsappPhone || c.phone || c.document || ""}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-line" />ou telefone avulso<span className="h-px flex-1 bg-line" /></div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone (ex.: 71 99999-9999)" inputMode="tel" className="input-base" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (opcional)" className="input-base mt-2" />
          </>
        )}

        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Primeira mensagem (opcional)" className="input-base mt-3" />
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={submit} className="btn-grad flex-1 py-2 disabled:opacity-50">{busy ? "Iniciando…" : "Iniciar conversa"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
        <p className="mt-2 text-[10px] text-muted">O telefone é normalizado automaticamente (adiciona 55 se faltar).</p>
      </div>
    </div>
  );
}

// ---- Conversa interna entre atendentes ----
type Peer = { membershipId: string; name: string; unread: number };
type IMsg = { id: string; mine: boolean; body: string; createdAt: string };
function InternalChatModal({ onClose, onRead }: { onClose: () => void; onRead: () => void }) {
  const dialog = useDialog();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [sel, setSel] = useState<Peer | null>(null);
  const [msgs, setMsgs] = useState<IMsg[]>([]);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadPeers = useCallback(() => {
    fetch("/api/inbox/internal", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setPeers(d.items ?? [])).catch(() => {});
  }, []);
  const loadThread = useCallback((peerId: string) => {
    fetch(`/api/inbox/internal/${peerId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setMsgs(d.items ?? []); setTimeout(() => endRef.current?.scrollIntoView(), 50); } }).catch(() => {});
  }, []);
  useEffect(() => { loadPeers(); }, [loadPeers]);
  useEffect(() => {
    if (!sel) return;
    loadThread(sel.membershipId); onRead();
    const t = setInterval(() => { loadThread(sel.membershipId); loadPeers(); }, 4000);
    return () => clearInterval(t);
  }, [sel, loadThread, loadPeers, onRead]);

  async function send() {
    if (!sel || !text.trim()) return;
    const body = text.trim(); setText("");
    const res = await fetch(`/api/inbox/internal/${sel.membershipId}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ body }) });
    if (!res.ok) { dialog.toast("Não foi possível enviar", "error"); return; }
    loadThread(sel.membershipId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex h-[70vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-56 shrink-0 flex-col border-r border-line">
          <div className="border-b border-line p-3 text-sm font-semibold">💬 Equipe</div>
          <div className="flex-1 overflow-y-auto">
            {peers.length === 0 ? <p className="p-3 text-xs text-muted">Nenhum colega.</p> : peers.map((p) => (
              <button key={p.membershipId} onClick={() => setSel(p)} className={`flex w-full items-center justify-between gap-2 border-b border-line/50 p-3 text-left text-sm hover:bg-line/40 ${sel?.membershipId === p.membershipId ? "bg-brand/10" : ""}`}>
                <span className="truncate">{p.name}</span>
                {p.unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{p.unread}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          {!sel ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Escolha um colega</div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line p-3">
                <span className="font-medium">{sel.name}</span>
                <button onClick={onClose} className="text-xs text-muted hover:text-fg">fechar</button>
              </div>
              <div className="scroll-themed flex-1 space-y-2 overflow-y-auto p-3">
                {msgs.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.mine ? "ml-auto bg-brand/15" : "bg-line/60"}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[10px] text-muted">{new Date(m.createdAt).toLocaleString("pt-BR")}</p>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="flex items-end gap-2 border-t border-line p-3">
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Mensagem interna…"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  className="input-base flex-1" />
                <button disabled={!text.trim()} onClick={send} className="btn-grad px-4 py-2 disabled:opacity-50">Enviar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Agenda dentro do atendimento (agendar / confirmar / cancelar) ----
type Apt = { id: string; status: string; startsAt: string; serviceName: string | null; professional?: { name: string } | null };
type Slot = { id: string; startsAt: string; slotStatus: string; professional?: { name: string } | null };
const APT_STATUS: Record<string, string> = { pending: "Pendente", confirmed: "Confirmado", rescheduled: "Remarcado", canceled: "Cancelado", attended: "Atendido", no_show: "Faltou", in_progress: "Em atendimento" };
function AgendaModal({ customerId, customerName, contactPhone, conversationId, onClose, onChanged }: { customerId: string | null; customerName: string; contactPhone: string | null; conversationId: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [apts, setApts] = useState<Apt[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  // vincular cliente quando a conversa não tem cadastro
  const [linkName, setLinkName] = useState(customerName && !/^\+?\d/.test(customerName) ? customerName : "");
  const [linkPhone, setLinkPhone] = useState(contactPhone ?? "");
  const [linking, setLinking] = useState(false);

  async function linkCustomer() {
    if (linkName.trim().length < 2) { dialog.toast("Informe o nome do cliente", "error"); return; }
    setLinking(true);
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}/link-customer`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ name: linkName.trim(), phone: linkPhone.trim() || undefined }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Não foi possível vincular", "error"); return; }
      dialog.toast("Cliente vinculado ✅", "success");
      onChanged(); // recarrega o detalhe → customerId definido → agenda aparece
    } finally { setLinking(false); }
  }

  const loadApts = useCallback(() => {
    if (!customerId) return;
    fetch(`/api/appointments?customerId=${customerId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setApts(d.items ?? [])).catch(() => {});
  }, [customerId]);
  useEffect(() => { loadApts(); }, [loadApts]);
  useEffect(() => {
    if (!showNew) return;
    fetch(`/api/schedule/slots?startDate=${date}&endDate=${date}&availableOnly=true`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setSlots((d.items ?? []).filter((s: Slot) => s.slotStatus === "free")); }).catch(() => {});
  }, [date, showNew]);

  const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  async function confirmApt(id: string) {
    const res = await fetch(`/api/appointments/${id}/confirm`, { method: "PATCH", credentials: "include" });
    if (!res.ok) dialog.toast("Não foi possível confirmar", "error");
    loadApts(); onChanged();
  }
  async function cancelApt(id: string) {
    if (!(await dialog.confirm({ title: "Cancelar agendamento", message: "Confirma o cancelamento?", tone: "danger" }))) return;
    const res = await fetch(`/api/appointments/${id}/cancel`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ actor: "staff", reason: "Cancelado no atendimento" }) });
    if (!res.ok) dialog.toast("Não foi possível cancelar", "error");
    loadApts(); onChanged();
  }
  async function createApt() {
    if (!customerId || !slotId) { dialog.toast("Escolha um horário", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ slotId, customerId, serviceName: service.trim() || undefined }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Não foi possível agendar", "error"); return; }
      dialog.toast("Agendamento criado ✅", "success");
      setShowNew(false); setSlotId(""); setService(""); loadApts(); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Agenda — {customerName}</h3>
        {!customerId ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">Esta conversa ainda não tem cliente cadastrado. Informe o nome para vincular (o número já vem da conversa) e agendar.</p>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Telefone</span>
              <input value={linkPhone} onChange={(e) => setLinkPhone(e.target.value)} placeholder="(71) 99999-9999" className="input-base" />
            </label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Nome do cliente</span>
              <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Nome completo" autoFocus className="input-base" />
            </label>
            <button disabled={linking || linkName.trim().length < 2} onClick={linkCustomer} className="btn-grad w-full py-2 disabled:opacity-50">{linking ? "Vinculando…" : "Vincular e continuar"}</button>
          </div>
        ) : (
          <>
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
              {apts.length === 0 ? <p className="text-xs text-muted">Nenhum agendamento.</p> : apts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{fmt(a.startsAt)}</span>
                    <span className="block truncate text-xs text-muted">{a.professional?.name ?? ""}{a.serviceName ? ` · ${a.serviceName}` : ""} · {APT_STATUS[a.status] ?? a.status}</span>
                  </div>
                  {!["canceled", "attended", "no_show"].includes(a.status) && (
                    <div className="flex shrink-0 gap-2 text-xs">
                      {a.status !== "confirmed" && <button onClick={() => confirmApt(a.id)} className="text-success hover:underline">confirmar</button>}
                      <button onClick={() => cancelApt(a.id)} className="text-danger hover:underline">cancelar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!showNew ? (
              <button onClick={() => setShowNew(true)} className="btn-grad mt-3">+ Novo agendamento</button>
            ) : (
              <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-[10px] uppercase text-muted">Dia</label>
                  <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlotId(""); }} className="input-base w-auto" />
                </div>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {slots.length === 0 ? <p className="text-xs text-muted">Sem horários livres nesse dia.</p> : slots.map((s) => (
                    <button key={s.id} onClick={() => setSlotId(s.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-left text-sm transition ${slotId === s.id ? "border-brand bg-brand/10" : "border-line bg-surface hover:border-brand"}`}>
                      <span>{fmtTime(s.startsAt)}</span><span className="text-xs text-muted">{s.professional?.name ?? ""}</span>
                    </button>
                  ))}
                </div>
                <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Serviço (opcional)" className="input-base mt-2" />
                <div className="mt-2 flex gap-2">
                  <button disabled={busy || !slotId} onClick={createApt} className="btn-grad flex-1 py-2 disabled:opacity-50">{busy ? "Agendando…" : "Confirmar agendamento"}</button>
                  <button onClick={() => setShowNew(false)} className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition hover:text-fg">voltar</button>
                </div>
              </div>
            )}
          </>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">fechar</button>
      </div>
    </div>
  );
}

// ---- Gerenciar respostas rápidas (privada / compartilhada / global) ----
function CannedManager({ items, onClose, onChanged }: { items: Canned[]; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"private" | "shared" | "global">("private");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() { setEditId(null); setShortcut(""); setTitle(""); setBody(""); setScope("private"); }
  function edit(c: Canned) { setEditId(c.id); setShortcut(c.shortcut); setTitle(c.title ?? ""); setBody(c.body); setScope((c.scope as any) ?? "global"); }

  async function save() {
    if (!shortcut.trim() || !body.trim()) { dialog.toast("Preencha o atalho e o texto", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/inbox/canned", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ id: editId || undefined, shortcut: shortcut.trim().replace(/^\//, ""), title: title.trim() || undefined, body: body.trim(), scope }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Não foi possível salvar", "error"); return; }
      reset(); onChanged();
    } finally { setBusy(false); }
  }
  async function remove(c: Canned) {
    if (!(await dialog.confirm({ title: "Excluir resposta", message: `Remover /${c.shortcut}?`, tone: "danger" }))) return;
    const res = await fetch(`/api/inbox/canned/${c.id}/delete`, { method: "POST", credentials: "include" });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Não foi possível excluir", "error"); return; }
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Respostas rápidas</h3>
        <p className="mt-1 text-xs text-muted">🔒 privada (só você) · 👥 compartilhada com a equipe · 🌐 global (toda a empresa, só admin). Use variáveis: {"{{cliente}} {{operador}} {{saudacao}}"}.</p>

        <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="atalho (ex.: ola)" className="input-base" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="título (opcional)" className="input-base" />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Texto da resposta…" className="input-base mt-2" />
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-muted">Escopo:</span>
          <label className="flex items-center gap-1"><input type="radio" checked={scope === "private"} onChange={() => setScope("private")} className="accent-brand" /> 🔒 privada</label>
          <label className="flex items-center gap-1"><input type="radio" checked={scope === "shared"} onChange={() => setScope("shared")} className="accent-brand" /> 👥 equipe</label>
          <label className="flex items-center gap-1"><input type="radio" checked={scope === "global"} onChange={() => setScope("global")} className="accent-brand" /> 🌐 global</label>
        </div>
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad px-4 py-2 disabled:opacity-50">{editId ? "Salvar" : "Adicionar"}</button>
          {editId && <button onClick={reset} className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition hover:text-fg">cancelar edição</button>}
        </div>

        <div className="mt-4 flex-1 space-y-1 overflow-y-auto border-t border-line pt-3">
          {items.length === 0 ? <p className="text-xs text-muted">Nenhuma resposta ainda.</p> : items.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm">
              <div className="min-w-0">
                <span className="font-mono text-brand">/{c.shortcut}</span> <span className="text-muted">{c.scope === "private" ? "🔒" : c.scope === "shared" ? "👥" : "🌐"}</span>
                <span className="block truncate text-xs text-muted">{c.title || c.body}</span>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button onClick={() => edit(c)} className="text-brand hover:underline">editar</button>
                <button onClick={() => remove(c)} className="text-danger hover:underline">excluir</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">fechar</button>
      </div>
    </div>
  );
}

// ---- Busca por protocolo / CPF / nome ----
type ProtoRow = { id: string; protocol: string | null; contactName: string | null; contactPhone: string | null; status: string; date: string; tabulationName: string | null; tabulationNote: string | null; agentName: string | null };
function ProtocolSearchModal({ onClose, onOpen }: { onClose: () => void; onOpen: (conversationId: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ProtoRow[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setSearched(false); return; }
    const t = setTimeout(() => {
      fetch(`/api/inbox/protocols/search?q=${encodeURIComponent(term)}`, { credentials: "include", headers: { "x-no-loading": "1" } })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setRows(d.items ?? []); setSearched(true); } }).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Buscar atendimento</h3>
        <p className="mt-1 text-xs text-muted">Por protocolo, nome, telefone ou CPF.</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Ex.: AT-20260522-AB12 / 123.456.789-00 / Maria" className="input-base mt-3" />
        <div className="mt-3 flex-1 overflow-y-auto">
          {searched && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhum atendimento encontrado.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full flex-col gap-0.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left text-sm transition hover:border-brand">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-brand">{r.protocol ?? "— sem protocolo —"}</span>
                    <span className="text-[11px] text-muted">{new Date(r.date).toLocaleString("pt-BR")}</span>
                  </div>
                  <span className="truncate text-xs">{r.contactName || r.contactPhone || "Desconhecido"}{r.tabulationName ? ` · ${r.tabulationName}` : ""}{r.agentName ? ` · ${r.agentName}` : ""}</span>
                  {r.tabulationNote && <span className="truncate text-[11px] text-muted">{r.tabulationNote}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">fechar</button>
      </div>
    </div>
  );
}



// =============================================================================
// CustomerDrawer — painel lateral com NOTAS permanentes + TIMELINE cross-canal
// do cliente. Sobre o lado direito da tela, fecha clicando fora ou no X.
// =============================================================================
function CustomerDrawer({ customerId, customerName, onClose }: { customerId: string; customerName: string; onClose: () => void }) {
  const [tab, setTab] = useState<"notes" | "timeline">("notes");
  const [notes, setNotes] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadNotes = () => fetch(`/api/customers/${customerId}/notes`, { credentials: "include", headers: { "x-no-loading": "1" } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => d && setNotes(d.items ?? [])).catch(() => undefined);
  const loadTimeline = () => fetch(`/api/customers/${customerId}/timeline`, { credentials: "include", headers: { "x-no-loading": "1" } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => d && setTimeline(d.items ?? [])).catch(() => undefined);

  useEffect(() => { loadNotes(); loadTimeline(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [customerId]);

  async function addNote() {
    if (!newNote.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/customers/${customerId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ body: newNote.trim(), pinned }),
      });
      setNewNote(""); setPinned(false);
      loadNotes();
    } finally { setBusy(false); }
  }
  async function delNote(id: string) {
    await fetch(`/api/customers/${customerId}/notes/${id}`, { method: "DELETE", credentials: "include" });
    loadNotes();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-md flex-col bg-surface shadow-lg">
        <header className="flex items-center justify-between border-b border-line p-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">Cliente</p>
            <h2 className="text-base font-semibold">{customerName}</h2>
          </div>
          <button onClick={onClose} className="text-2xl text-muted hover:text-fg">×</button>
        </header>
        <div className="flex gap-1 border-b border-line p-2 text-xs">
          <button onClick={() => setTab("notes")} className={`rounded px-3 py-1.5 ${tab === "notes" ? "bg-brand/20 text-fg" : "text-muted hover:bg-line"}`}>📌 Notas ({notes.length})</button>
          <button onClick={() => setTab("timeline")} className={`rounded px-3 py-1.5 ${tab === "timeline" ? "bg-brand/20 text-fg" : "text-muted hover:bg-line"}`}>🕐 Histórico ({timeline.length})</button>
        </div>

        {tab === "notes" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b border-line p-3">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={2}
                placeholder="Nova nota sobre o cliente... (ex: prefere atendimento de manhã)"
                className="input-base"
              />
              <div className="mt-2 flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-brand" /> fixar no topo
                </label>
                <button onClick={addNote} disabled={busy || !newNote.trim()} className="btn-grad ml-auto px-3 py-1.5 text-xs disabled:opacity-40">Adicionar</button>
              </div>
            </div>
            <div className="scroll-themed flex-1 space-y-2 overflow-y-auto p-3">
              {notes.length === 0 ? <p className="text-xs text-muted">Sem notas ainda.</p> : notes.map((n) => (
                <div key={n.id} className={`rounded-xl border p-3 ${n.pinned ? "border-amber-500/50 bg-amber-500/5" : "border-line bg-surface-2"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 whitespace-pre-wrap text-sm">{n.body}</p>
                    <button onClick={() => delNote(n.id)} title="Apagar" className="text-muted hover:text-danger">×</button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted">{n.pinned ? "📌 fixada · " : ""}{n.authorName ?? "—"} · {new Date(n.createdAt).toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="scroll-themed flex-1 space-y-2 overflow-y-auto p-3">
            {timeline.length === 0 ? <p className="text-xs text-muted">Sem histórico ainda.</p> : timeline.map((ev, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{ev.title}</p>
                  <p className="text-xs text-muted">{ev.subtitle}</p>
                </div>
                <div className="text-right text-[10px] text-muted">
                  <p>{new Date(ev.at).toLocaleDateString("pt-BR")}</p>
                  <p>{new Date(ev.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                  {ev.status && <span className="mt-1 inline-block rounded bg-line px-1.5 py-0.5">{ev.status}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
