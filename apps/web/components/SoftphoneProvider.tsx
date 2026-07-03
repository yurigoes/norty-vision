"use client";

// SoftphoneProvider — softphone APP-WIDE: monta no /app/layout e mantém o
// ramal vivo em qualquer tela. Toca o ringtone Yugo, mostra modal global de
// chamada entrante e bar flutuante quando em ligação. Assina Web Push pra
// receber chamada com o app fechado, e dispara /voip/ring quando ESTE
// operador liga (notifica o callee). Engine dual: P2P (Cloudflare TURN) e
// SIP (FreeSWITCH na VPS externa) — server decide pelo register().

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { playYugoRing } from "../lib/ringtone";

// Notificador simples sem depender de DialogProvider (que pode não estar acima).
// Usa setError pra mostrar banner + console pra debug.
function micError(setError: (e: string | null) => void, e: any) {
  const name = e?.name ?? "Erro";
  let msg = `Falha no microfone: ${name}`;
  if (name === "NotAllowedError" || name === "SecurityError") msg = "Permita o microfone do site no navegador (cadeado da barra → permissões)";
  else if (name === "NotFoundError" || name === "DevicesNotFoundError") msg = "Microfone não encontrado neste dispositivo";
  console.error("[voip:mic]", name, e);
  setError(msg);
}

// JsSIP é importado dinamicamente do bundle (dep do app). Sem CDN — evita CSP /
// problemas de rede. O dynamic import faz o chunk só baixar quando entrar em SIP.

type SipCfg = { wsUri: string; sipUri: string; domain: string; password: string };
type Cfg = { mode: "p2p" | "sip"; extension: string; displayName: string; iceServers: any[]; confUrl: string; sip?: SipCfg };
type Op = { extension: string; name: string; online: boolean };
type Status = "off" | "connecting" | "online" | "failed";
type CallState = "idle" | "outgoing" | "incoming" | "in_call";
type SigMsg = { id: string; fromExt: string; fromName: string; callId: string; type: string; sdp?: string; reason?: string };

interface SoftphoneContextValue {
  cfg: Cfg | null;
  status: Status;
  ops: Op[];
  callState: CallState;
  peerName: string;
  peerExt: string;
  muted: boolean;
  dur: number;
  error: string | null;
  pushEnabled: boolean;
  connect: () => void;
  disconnect: () => void;
  refreshDir: () => void;
  startCall: (op: Op) => void;
  startNumberCall: (digits: string, label?: string) => void;
  answer: () => void;
  hangup: () => void;
  toggleMute: () => void;
  openConference: () => void;
}

const Ctx = createContext<SoftphoneContextValue | null>(null);
export function useSoftphone(): SoftphoneContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSoftphone fora do SoftphoneProvider");
  return v;
}

async function jget(url: string) {
  const r = await fetch(url, { credentials: "include", headers: { "x-no-loading": "1" } });
  return r.ok ? r.json() : null;
}
async function jpost(url: string, body: any) {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-no-loading": "1" }, body: JSON.stringify(body) });
  return r.ok ? r.json().catch(() => ({})) : null;
}
function fmtDur(s: number) { const m = Math.floor(s / 60); return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
function newId() { return (crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36); }
function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, 2500);
  });
}
async function loadJsSip(): Promise<any> {
  // import dinâmico — não bloqueia o bundle inicial; só baixa quando entra em SIP.
  const mod: any = await import("jssip");
  return mod.default ?? mod;
}
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const AUTO_KEY = "yugo:softphone:autoconnect"; // 1 = auto-conectar quando o app abrir

export function SoftphoneProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [status, setStatus] = useState<Status>("off");
  const [ops, setOps] = useState<Op[]>([]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [peerName, setPeerName] = useState("");
  const [peerExt, setPeerExt] = useState("");
  const [muted, setMuted] = useState(false);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  const cfgRef = useRef<Cfg | null>(null);
  const statusRef = useRef<Status>("off");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dirTimer = useRef<any>(null);
  const durTimer = useRef<any>(null);
  const hbTimer = useRef<any>(null);
  // P2P
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const pollTimer = useRef<any>(null);
  const ringTimer = useRef<any>(null);
  const call = useRef<{ id: string; peerExt: string; peerName: string; direction: "internal" | "inbound"; answered: boolean; startedAt: number; pendingOffer?: string } | null>(null);
  // SIP
  const uaRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const sipMeta = useRef<{ peerExt: string; peerName: string; direction: "internal" | "inbound"; answered: boolean; startedAt: number }>({ peerExt: "", peerName: "", direction: "internal", answered: false, startedAt: 0 });
  // Ringtone
  const ringStop = useRef<(() => void) | null>(null);

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { statusRef.current = status; }, [status]);

  // toca/para o ringtone Yugo conforme o estado da chamada
  useEffect(() => {
    if (callState === "incoming" || callState === "outgoing") {
      if (!ringStop.current) { try { ringStop.current = playYugoRing(); } catch { /* contexto de áudio bloqueado */ } }
    } else if (ringStop.current) {
      ringStop.current(); ringStop.current = null;
    }
  }, [callState]);

  // timer de duração
  useEffect(() => {
    if (callState === "in_call") {
      durTimer.current = setInterval(() => {
        const cur = call.current ?? (sipMeta.current.answered ? sipMeta.current : null);
        if (cur?.startedAt) setDur(Math.floor((Date.now() - cur.startedAt) / 1000));
      }, 1000);
      return () => { if (durTimer.current) { clearInterval(durTimer.current); durTimer.current = null; } };
    }
    return undefined;
  }, [callState]);

  // ========================= conectar / desconectar =========================
  const refreshDir = useCallback(async () => {
    const d = await jget("/api/voip/directory");
    setOps(Array.isArray(d?.items) ? d.items : []);
  }, []);

  const connect = useCallback(async () => {
    if (statusRef.current !== "off" && statusRef.current !== "failed") return;
    setError(null);
    setStatus("connecting");
    const c: Cfg | null = await jpost("/api/voip/register", {});
    if (!c) { setStatus("off"); setError("Não foi possível registrar seu ramal."); return; }
    setCfg(c); cfgRef.current = c;
    try { localStorage.setItem(AUTO_KEY, "1"); } catch {}
    refreshDir();
    dirTimer.current = setInterval(refreshDir, 8000);
    if (c.mode === "sip" && c.sip) await connectSip(c);
    else connectP2P();
    // assina o Web Push (não bloqueia o connect; falha silenciosa)
    subscribePush().catch(() => undefined);
  }, [refreshDir]);

  function connectP2P() {
    setStatus("online"); statusRef.current = "online";
    pollTimer.current = setInterval(pollOnce, 1200);
  }

  async function connectSip(c: Cfg) {
    try {
      const JsSIP = await loadJsSip();
      const socket = new JsSIP.WebSocketInterface(c.sip!.wsUri);
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: c.sip!.sipUri,
        password: c.sip!.password,
        display_name: c.displayName,
        register: true,
        session_timers: false,
      } as any);
      // iceGatheringTimeout do UA não tem efeito no JsSIP 3.13 — setamos
      // direto em session.iceGatheringTimeout no attachSip().
      uaRef.current = ua;
      ua.on("registered", () => { setStatus("online"); statusRef.current = "online"; });
      ua.on("unregistered", () => { setStatus("off"); statusRef.current = "off"; });
      ua.on("registrationFailed", (e: any) => { setStatus("failed"); statusRef.current = "failed"; setError(`Registro SIP falhou: ${e?.cause ?? "verifique o PABX"}`); });
      ua.on("newRTCSession", (data: any) => attachSip(data.session, data.originator));
      ua.start();
      hbTimer.current = setInterval(() => { jpost("/api/voip/register", {}).catch(() => undefined); }, 20000);
    } catch (e: any) {
      setStatus("failed"); statusRef.current = "failed";
      setError(e?.message ?? "Falha ao iniciar o softphone SIP");
    }
  }

  const disconnect = useCallback(() => {
    [pollTimer, dirTimer, hbTimer].forEach((t) => { if (t.current) { clearInterval(t.current); t.current = null; } });
    if (cfgRef.current?.mode === "sip") {
      try { sessionRef.current?.terminate?.(); } catch {}
      try { uaRef.current?.stop?.(); } catch {}
      uaRef.current = null; sessionRef.current = null;
      resetCallUi();
    } else {
      endCallP2P("bye", true);
    }
    jpost("/api/voip/unregister", {}).catch(() => undefined);
    setStatus("off"); statusRef.current = "off"; setOps([]);
    try { localStorage.setItem(AUTO_KEY, "0"); } catch {}
  }, []);

  // auto-conectar se o operador já clicou em Conectar antes (e o módulo está habilitado)
  useEffect(() => {
    if (!enabled) return;
    let auto = "1";
    try { auto = localStorage.getItem(AUTO_KEY) ?? "1"; } catch {}
    if (auto !== "0") connect();
    return () => {
      [pollTimer, dirTimer, hbTimer, durTimer, ringTimer].forEach((t) => t.current && clearInterval(t.current));
      try { pcRef.current?.close(); } catch {}
      try { sessionRef.current?.terminate?.(); } catch {}
      try { uaRef.current?.stop?.(); } catch {}
      localStream.current?.getTracks().forEach((t) => t.stop());
      ringStop.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ========================= Web Push (toca app fechado) =========================
  async function subscribePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (typeof Notification === "undefined") return;
    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await jget("/api/voip/push/vapid");
    if (!vapidRes?.publicKey) return; // servidor sem VAPID → push desligado
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
        if (perm !== "granted") return;
      } else if (Notification.permission !== "granted") return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidRes.publicKey) as BufferSource,
      });
    }
    const j: any = sub.toJSON();
    await jpost("/api/voip/push/subscribe", { endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent });
    setPushEnabled(true);
  }

  // mensagens do service worker (clique em Atender/Recusar na notificação)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const d = event.data;
      if (d?.type === "voip-notification-action") {
        if (d.action === "answer") answer();
        else if (d.action === "reject") hangup();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========================= util compartilhado =========================
  function bindRemoteAudio(stream: MediaStream | null) {
    if (audioRef.current && stream) { audioRef.current.srcObject = stream; audioRef.current.play?.().catch(() => undefined); }
  }
  function resetCallUi() {
    if (durTimer.current) { clearInterval(durTimer.current); durTimer.current = null; }
    if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
    setCallState("idle"); setPeerName(""); setPeerExt(""); setMuted(false); setDur(0);
    if (audioRef.current) audioRef.current.srcObject = null;
  }
  function reportCall(direction: string, ext: string, name: string, durationS: number) {
    jpost("/api/voip/calls", { direction, toExt: ext, calleeName: name, status: "ended", durationS }).catch(() => undefined);
  }

  // ========================= ações =========================
  function startCall(op: Op) {
    if (statusRef.current !== "online" || callState !== "idle") return;
    // Inicia o ringback Yugo DENTRO do gesto do clique (iOS Safari exige
    // user gesture síncrono — chamar via useEffect[callState] já é tarde).
    if (!ringStop.current) { try { ringStop.current = playYugoRing(); } catch {} }
    // dispara push pro callee em paralelo (toca o app dele mesmo fechado)
    jpost("/api/voip/ring", { toExt: op.extension, callId: newId() }).catch(() => undefined);
    if (cfgRef.current?.mode === "sip") return startCallSip(op);
    return startCallP2P(op);
  }

  // Liga pra um NÚMERO real (PSTN) pelo trunk. Só funciona no modo SIP.
  async function startNumberCall(rawDigits: string, label?: string) {
    if (statusRef.current !== "online" || callState !== "idle") return;
    const digits = (rawDigits || "").replace(/[^0-9]/g, "");
    if (digits.length < 8) return;
    if (cfgRef.current?.mode !== "sip" || !cfgRef.current.sip) {
      setError("Discagem pra número só funciona no modo PABX (SIP) com trunk configurado.");
      return;
    }
    // ringback dentro do gesto (necessário no iOS Safari)
    if (!ringStop.current) { try { ringStop.current = playYugoRing(); } catch {} }
    // pega o mic UMA vez e reusa no JsSIP — gUM duplicado trava no Chrome
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e: any) {
      micError(setError, e); return;
    }
    localStream.current = stream;
    sipMeta.current = { peerExt: digits, peerName: label || digits, direction: "internal", answered: false, startedAt: 0 };
    setPeerName(label || digits); setPeerExt(digits); setCallState("outgoing");
    uaRef.current.call(`sip:${digits}@${cfgRef.current.sip.domain}`, {
      mediaStream: stream,
      pcConfig: { iceServers: cfgRef.current.iceServers },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    });
  }
  function answer() { return cfgRef.current?.mode === "sip" ? answerSip() : answerP2P(); }
  function hangup() { return cfgRef.current?.mode === "sip" ? hangupSip() : hangupP2P(); }
  function toggleMute() { return cfgRef.current?.mode === "sip" ? toggleMuteSip() : toggleMuteP2P(); }
  function openConference() { if (cfgRef.current?.confUrl) window.open(cfgRef.current.confUrl, "_blank", "noopener"); }

  // ---------- P2P engine ----------
  async function getMic(): Promise<MediaStream> {
    if (localStream.current) return localStream.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.current = s; return s;
  }
  function makePc(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: cfgRef.current?.iceServers ?? [] });
    pc.ontrack = (ev) => bindRemoteAudio(ev.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") onP2PConnected();
      else if ((st === "failed" || st === "disconnected" || st === "closed") && call.current) endCallP2P("ended", false);
    };
    pcRef.current = pc; return pc;
  }
  function onP2PConnected() {
    if (!call.current || call.current.answered) return;
    call.current.answered = true; call.current.startedAt = Date.now();
    setCallState("in_call");
  }
  async function pollOnce() {
    const d = await jget("/api/voip/poll");
    for (const m of (d?.messages ?? []) as SigMsg[]) await handleSignal(m);
  }
  async function handleSignal(m: SigMsg) {
    if (m.type === "offer") {
      if (call.current) { jpost("/api/voip/signal", { toExt: m.fromExt, callId: m.callId, type: "busy" }); return; }
      call.current = { id: m.callId, peerExt: m.fromExt, peerName: m.fromName, direction: "inbound", answered: false, startedAt: 0, pendingOffer: m.sdp };
      setPeerName(m.fromName); setPeerExt(m.fromExt); setCallState("incoming");
      jpost("/api/voip/signal", { toExt: m.fromExt, callId: m.callId, type: "ringing" });
      return;
    }
    if (!call.current || m.callId !== call.current.id) return;
    if (m.type === "answer") { try { await pcRef.current?.setRemoteDescription({ type: "answer", sdp: m.sdp }); } catch {} }
    else if (m.type === "busy") { endCallP2P("bye", true); }
    else if (m.type === "bye") endCallP2P("ended", false);
  }
  async function startCallP2P(op: Op) {
    if (!op.online) return; // bolinha cinza: callee não responde via poll
    try {
      const id = newId();
      call.current = { id, peerExt: op.extension, peerName: op.name, direction: "internal", answered: false, startedAt: 0 };
      setPeerName(op.name); setPeerExt(op.extension); setCallState("outgoing");
      const stream = await getMic();
      const pc = makePc();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      await jpost("/api/voip/signal", { toExt: op.extension, callId: id, type: "offer", sdp: pc.localDescription?.sdp });
      ringTimer.current = setTimeout(() => { if (call.current && !call.current.answered) hangupP2P(); }, 45000);
    } catch {
      endCallP2P("failed", true);
    }
  }
  async function answerP2P() {
    const cur = call.current;
    if (!cur || !cur.pendingOffer) return;
    try {
      const stream = await getMic();
      const pc = makePc();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription({ type: "offer", sdp: cur.pendingOffer });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIce(pc);
      await jpost("/api/voip/signal", { toExt: cur.peerExt, callId: cur.id, type: "answer", sdp: pc.localDescription?.sdp });
    } catch {
      endCallP2P("failed", true);
    }
  }
  function hangupP2P() {
    const cur = call.current;
    if (cur) jpost("/api/voip/signal", { toExt: cur.peerExt, callId: cur.id, type: "bye" });
    endCallP2P(cur?.answered ? "ended" : "bye", false);
  }
  function endCallP2P(_status: string, _silent: boolean) {
    const cur = call.current;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    if (cur && cur.answered) reportCall(cur.direction, cur.peerExt, cur.peerName, cur.startedAt ? Math.max(0, Math.floor((Date.now() - cur.startedAt) / 1000)) : 0);
    call.current = null;
    resetCallUi();
  }
  function toggleMuteP2P() {
    const next = !muted;
    (localStream.current?.getAudioTracks() ?? []).forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  // ---------- SIP engine ----------
  function attachSip(session: any, originator: string) {
    // Limpa session "zumbi" — se a anterior já terminou (status 7/CANCELED, 8/TERMINATED)
    // mas não chamou onfailed/onended (pode acontecer após exceptions internas do JsSIP),
    // libera ela aqui em vez de rejeitar a nova com 486 Busy.
    if (sessionRef.current && session !== sessionRef.current) {
      const oldStatus = (sessionRef.current as any)._status;
      if (oldStatus === 7 || oldStatus === 8 || (sessionRef.current as any).isEnded?.() || (sessionRef.current as any).isTerminated?.()) {
        try { sessionRef.current.terminate?.(); } catch {}
        sessionRef.current = null;
        resetCallUi();
      } else {
        try { session.terminate({ status_code: 486 }); } catch {}
        return;
      }
    }
    sessionRef.current = session;
    // CRÍTICO: força corte do ICE gathering em 3s. No JsSIP 3.13.x, o
    // iceGatheringTimeout do UA constructor é ignorado. Só setando direto
    // na session ele realmente envia o INVITE com os candidatos que tem.
    try { (session as any).iceGatheringTimeout = 3000; } catch {}
    if (originator === "remote") {
      const from = session.remote_identity || {};
      const name = from.display_name || from.uri?.user || "Desconhecido";
      sipMeta.current = { peerExt: from.uri?.user ?? "", peerName: name, direction: "inbound", answered: false, startedAt: 0 };
      setPeerName(name); setPeerExt(from.uri?.user ?? ""); setCallState("incoming");
    }
    session.on("accepted", () => onSipConnected());
    session.on("confirmed", () => onSipConnected());
    session.on("ended", () => endCallSip());
    session.on("failed", (e: any) => endCallSip(e?.cause));
    session.on("peerconnection", (e: any) => {
      const pc = e.peerconnection;
      pc.ontrack = (ev: any) => bindRemoteAudio(ev.streams?.[0] ?? null);
      // Backup pra sincronizar UI se accepted/confirmed do JsSIP não vierem
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") onSipConnected();
        else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          if (sessionRef.current === session) endCallSip("pc-" + pc.connectionState);
        }
      });
      // CRÍTICO: corta o ICE gathering ASSIM QUE houver 1 candidato útil
      // (host LAN ou srflx via STUN). Não esperamos coletar 14 candidatos
      // de IPv6/Tailscale/WSL/etc. — em Chrome bagunçado isso nunca termina.
      // O JsSIP só precisa de candidato suficiente pra mídia rolar; o resto
      // de ICE pode rolar em trickle (Asterisk + Chrome lidam bem).
      //
      // Estratégia: setIceReady=true do JsSIP + dispatch dos eventos de
      // "fim" assim que vier o 1º candidato bom. Forçamos em 1500ms como
      // fallback se nenhum vier (não esperamos 3s).
      let iceForced = false;
      let candidates = 0;
      let gotUseful = false;
      const forceIceEnd = (reason: string) => {
        if (iceForced) return;
        iceForced = true;
        console.log(`[voip] ICE END (${reason}, candidatos=${candidates}, state=${pc.iceGatheringState})`);
        try { (session as any)._iceReady = true; } catch {}
        try {
          const ev: any = new Event("icecandidate");
          ev.candidate = null;
          pc.dispatchEvent(ev);
        } catch (e) { console.warn("[voip] dispatch null falhou", e); }
        try { pc.dispatchEvent(new Event("icegatheringstatechange")); } catch {}
      };
      pc.addEventListener("icecandidate", (ev: any) => {
        if (!ev.candidate) { iceForced = true; console.log(`[voip] ICE native end (${candidates} cand)`); return; }
        candidates++;
        const cand = ev.candidate.candidate || "";
        // host = LAN local, srflx = STUN reflexivo (IP público) → suficiente pra mídia
        const useful = / typ host /.test(cand) || / typ srflx /.test(cand);
        if (useful && !gotUseful) {
          gotUseful = true;
          // Pequeno delay pra deixar coletar 1-2 candidatos extras se vierem rapidinho
          setTimeout(() => forceIceEnd("got-useful"), 200);
        }
      });
      pc.addEventListener("icegatheringstatechange", () => {
        console.log("[voip] iceGatheringState →", pc.iceGatheringState);
      });
      // Fallback: se em 1.5s nada veio (cenário extremo), força mesmo assim
      setTimeout(() => forceIceEnd("timeout-1500"), 1500);
    });
    if (session.connection) session.connection.ontrack = (ev: any) => bindRemoteAudio(ev.streams?.[0] ?? null);
  }
  function onSipConnected() {
    if (sipMeta.current.answered) return;
    sipMeta.current.answered = true; sipMeta.current.startedAt = Date.now();
    setCallState("in_call");
  }
  async function startCallSip(op: Op) {
    console.log("[voip] startCallSip →", op.extension);
    // Pega o mic UMA vez e passa o stream pronto pro JsSIP. Se a gente fizer
    // getUserMedia duas vezes (test + JsSIP interno), o Chrome Windows pode
    // travar a 2a chamada — e o INVITE nunca sai.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log("[voip] mic OK, tracks=", stream.getTracks().length);
    } catch (e: any) {
      console.error("[voip] mic FALHOU", e);
      micError(setError, e); resetCallUi(); return;
    }
    localStream.current = stream;
    sipMeta.current = { peerExt: op.extension, peerName: op.name, direction: "internal", answered: false, startedAt: 0 };
    setPeerName(op.name); setPeerExt(op.extension); setCallState("outgoing");
    const target = `sip:${op.extension}@${cfgRef.current!.sip!.domain}`;
    console.log("[voip] UA.call() →", target, "ice=", cfgRef.current!.iceServers?.length ?? 0);
    try {
      const sess = uaRef.current.call(target, {
        mediaStream: stream,
        pcConfig: { iceServers: cfgRef.current!.iceServers },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      console.log("[voip] UA.call() retornou session=", !!sess);
    } catch (e: any) {
      console.error("[voip] UA.call() ESTOUROU", e);
      setError(`Falha ao iniciar chamada: ${e?.message ?? e}`);
      resetCallUi();
    }
  }
  async function answerSip() {
    const s = sessionRef.current;
    if (!s) return;
    // Guard contra duplo-click: se já está em ANSWERED ou além, não chama de novo
    const st = (s as any)._status;
    if (typeof st === "number" && st >= 5) {
      // já atendida (5=ANSWERED, 6=WAITING_FOR_ACK, 9=CONFIRMED) — só atualiza UI
      onSipConnected();
      return;
    }
    // Pega o mic e passa o stream pronto (mesmo padrão do outgoing)
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e: any) {
      micError(setError, e); try { s.terminate({ status_code: 486 }); } catch {} resetCallUi(); return;
    }
    localStream.current = stream;
    try {
      s.answer({
        mediaStream: stream,
        pcConfig: { iceServers: cfgRef.current!.iceServers },
      } as any);
    } catch (e: any) {
      // Bug do JsSIP 3.13: pode estourar INVALID_STATE_ERROR no _createLocalDescription
      // mesmo tendo iniciado o fluxo de atendimento. A chamada pode seguir viva
      // via PC connectionState — não derrubamos a sessão.
      console.warn("[voip] answer() exception (toleramos se a PC conectar):", e?.message ?? e);
    }
  }
  function hangupSip() { try { sessionRef.current?.terminate?.(); } catch {} }
  function endCallSip(_cause?: string) {
    const m = sipMeta.current;
    if (m.answered) reportCall(m.direction, m.peerExt, m.peerName, m.startedAt ? Math.max(0, Math.floor((Date.now() - m.startedAt) / 1000)) : 0);
    sessionRef.current = null;
    resetCallUi();
  }
  function toggleMuteSip() {
    const s = sessionRef.current; if (!s) return;
    if (muted) { s.unmute?.({ audio: true }); setMuted(false); } else { s.mute?.({ audio: true }); setMuted(true); }
  }

  const value = useMemo<SoftphoneContextValue>(() => ({
    cfg, status, ops, callState, peerName, peerExt, muted, dur, error, pushEnabled,
    connect, disconnect, refreshDir, startCall, startNumberCall, answer, hangup, toggleMute, openConference,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cfg, status, ops, callState, peerName, peerExt, muted, dur, error, pushEnabled]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay />
      <IncomingCallOverlay />
      <InCallFloatingBar />
    </Ctx.Provider>
  );
}

// =================== modal global de chamada entrante ===================
function IncomingCallOverlay() {
  const { callState, peerName, peerExt, answer, hangup } = useSoftphone();
  const [answering, setAnswering] = useState(false);
  // reseta o lock sempre que sair do estado "incoming"
  useEffect(() => { if (callState !== "incoming") setAnswering(false); }, [callState]);
  if (callState !== "incoming") return null;
  const onAnswer = () => { if (answering) return; setAnswering(true); answer(); };
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-6 text-center shadow-2xl">
        <p className="text-xs uppercase tracking-wider text-brand">Chamada entrante</p>
        <div className="mx-auto mt-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-3xl">📞</div>
        <p className="mt-3 text-xl font-semibold">{peerName || peerExt}</p>
        {peerExt && peerName !== peerExt && <p className="text-sm text-muted">ramal {peerExt}</p>}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button onClick={hangup} disabled={answering} className="rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">Recusar</button>
          <button onClick={onAnswer} disabled={answering} className="rounded-full bg-green-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{answering ? "Atendendo…" : "Atender"}</button>
        </div>
      </div>
    </div>
  );
}

// =================== barrinha flutuante quando em ligação ===================
function InCallFloatingBar() {
  const { callState, peerName, peerExt, dur, muted, toggleMute, hangup } = useSoftphone();
  if (callState !== "outgoing" && callState !== "in_call") return null;
  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex items-center gap-3 rounded-full border border-brand/40 bg-bg/95 px-4 py-2 shadow-xl backdrop-blur">
      <span className="text-sm">
        {callState === "outgoing" ? "📞 Chamando " : "📞 "}
        <strong>{peerName || peerExt}</strong>
        {callState === "in_call" && <span className="ml-2 font-mono text-xs text-muted">{String(Math.floor(dur / 60)).padStart(2, "0")}:{String(dur % 60).padStart(2, "0")}</span>}
      </span>
      {callState === "in_call" && (
        <button onClick={toggleMute} title={muted ? "Desmutar" : "Mudo"} className={`rounded-full px-2 py-1 text-xs font-semibold ${muted ? "bg-amber-500 text-white" : "border border-line"}`}>{muted ? "🔇" : "🎙️"}</button>
      )}
      <button onClick={hangup} title="Desligar" className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">Desligar</button>
    </div>
  );
}
