"use client";

import { useEffect, useRef, useState } from "react";

type Boot = {
  device: { name: string; requireGeo: boolean; requireSelfie: boolean; requireLiveness: boolean; faceIdentify?: boolean; geo: { lat: number; lng: number; radiusM: number } | null };
  employer: string; bgImageUrl: string | null; noticesGeral: string[];
};
type Ident = { id: string; name: string; requiresPin: boolean };
type QItem = { employeeId: string; employeeName: string; pin?: string; lat?: number; lng?: number; accuracy?: number; selfie?: string; livenessOk?: boolean; deviceAt: string };

const TOKEN_KEY = "ponto_device_token";
const QUEUE_KEY = "ponto_offline_queue";
const getQueue = (): QItem[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; } };
const setQueue = (q: QItem[]) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
const WD = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default function PontoApp() {
  const [token, setToken] = useState<string | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(new Date());
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("/ponto-sw.js", { scope: "/ponto-app" }).catch(() => {});
    const url = new URL(window.location.href);
    const d = url.searchParams.get("d");
    if (d) { localStorage.setItem(TOKEN_KEY, d); url.searchParams.delete("d"); window.history.replaceState({}, "", url.toString()); }
    setToken(localStorage.getItem(TOKEN_KEY));
    setOnline(navigator.onLine); setQueued(getQueue().length);
    const on = () => { setOnline(true); flush(); }; const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, []);

  const loadBoot = () => { if (!token) return; fetch(`/api/ponto-pwa/bootstrap?token=${encodeURIComponent(token)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setBoot).catch(() => setErr("Dispositivo inválido ou revogado. Peça um novo link ao administrador.")); };
  useEffect(() => { loadBoot(); }, [token]);

  async function flush() {
    const tk = localStorage.getItem(TOKEN_KEY); if (!tk) return;
    const q = getQueue(); if (q.length === 0) return;
    const keep: QItem[] = [];
    for (const it of q) {
      try { const res = await fetch("/api/ponto-pwa/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tk, ...it, offline: true }) }); if (!res.ok && res.status >= 500) keep.push(it); }
      catch { keep.push(it); }
    }
    setQueue(keep); setQueued(keep.length);
  }

  if (err) return <Center><p className="text-red-300">{err}</p></Center>;
  if (!token) return <Center><p className="text-white/70">Abra usando o link do dispositivo gerado no painel (Ponto → Dispositivos).</p></Center>;

  const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
  const dateStr = `${WD[now.getDay()]}, ${now.getDate()} de ${MO[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-neutral-950 text-white select-none" onClick={() => !open && setOpen(true)}>
      {boot?.bgImageUrl
        ? <img src={boot.bgImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0 bg-gradient-to-br from-violet-900 via-neutral-900 to-black" />}
      <div className="absolute inset-0 bg-black/35" />

      <AnalogClock now={now} />

      <div className="absolute inset-0 flex flex-col justify-end p-10 sm:p-16">
        <div className="drop-shadow-lg">
          <div className="text-[clamp(64px,16vw,200px)] font-semibold leading-none tracking-tight tabular-nums">{hh}:{mm}</div>
          <div className="mt-2 text-[clamp(16px,3vw,32px)] capitalize text-white/85">{dateStr}</div>
          <div className="mt-1 text-sm uppercase tracking-widest text-white/55">{boot?.employer} · {boot?.device.name}</div>
        </div>
        {boot?.noticesGeral?.length ? (
          <div className="mt-6 max-w-2xl rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
            {boot.noticesGeral.map((n, i) => <p key={i} className="text-sm text-white/90">📢 {n}</p>)}
          </div>
        ) : null}
        <div className="mt-8 flex items-center gap-3">
          <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="rounded-full bg-white/90 px-8 py-4 text-lg font-semibold text-neutral-900 shadow-lg backdrop-blur transition hover:bg-white">Bater ponto</button>
          <span className={`rounded-full px-3 py-1 text-xs ${online ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>{online ? "online" : "offline"}{queued > 0 ? ` · ${queued} na fila` : ""}</span>
        </div>
      </div>

      {open && <PunchModal boot={boot!} token={token} onClose={() => setOpen(false)} onQueued={() => setQueued(getQueue().length)} />}
    </main>
  );
}

function AnalogClock({ now }: { now: Date }) {
  const s = now.getSeconds(), m = now.getMinutes(), h = now.getHours() % 12;
  const sec = s * 6, min = m * 6 + s * 0.1, hour = h * 30 + m * 0.5;
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line x1="100" y1="100" x2={100 + len * Math.sin((deg * Math.PI) / 180)} y2={100 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <div className="pointer-events-none absolute top-1/2 -translate-y-1/2" style={{ right: "min(-15vw,-150px)" }}>
      <svg viewBox="0 0 200 200" className="h-[min(85vh,640px)] w-[min(85vh,640px)] opacity-90 drop-shadow-2xl">
        <circle cx="100" cy="100" r="96" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          return <line key={i} x1={100 + 84 * Math.sin(a)} y1={100 - 84 * Math.cos(a)} x2={100 + 92 * Math.sin(a)} y2={100 - 92 * Math.cos(a)} stroke="rgba(255,255,255,0.6)" strokeWidth="2" />;
        })}
        {hand(hour, 48, 5, "rgba(255,255,255,0.95)")}
        {hand(min, 70, 4, "rgba(255,255,255,0.95)")}
        {hand(sec, 80, 2, "#f59e0b")}
        <circle cx="100" cy="100" r="4" fill="#f59e0b" />
      </svg>
    </div>
  );
}

function PunchModal({ boot, token, onClose, onQueued }: { boot: Boot; token: string; onClose: () => void; onQueued: () => void }) {
  const [step, setStep] = useState<"id" | "pin" | "done">("id");
  const [ident, setIdent] = useState<Ident | null>(null);
  const [code, setCode] = useState(""); const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ name: string; nsr: string; at: string; notices: string[] } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null); const streamRef = useRef<MediaStream | null>(null);
  const needCam = boot.device.requireSelfie || boot.device.requireLiveness || !!boot.device.faceIdentify;

  useEffect(() => {
    if (needCam && step !== "done") {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" } }).then((s) => { streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; }).catch(() => {});
    }
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [step, needCam]);

  // sucesso fecha em 6s; telas de identificação fecham sozinhas após inatividade
  // (privacidade do kiosk — volta pra tela de bloqueio). Reinicia a cada digitação.
  const [secsLeft, setSecsLeft] = useState(6);
  useEffect(() => {
    if (step === "done") {
      setSecsLeft(6);
      const iv = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
      const t = setTimeout(onClose, 6000);
      return () => { clearInterval(iv); clearTimeout(t); };
    }
    const idle = setTimeout(onClose, 40000); // 40s parado → fecha
    return () => clearTimeout(idle);
  }, [step, code, pin]);

  const vibrate = (p: number | number[]) => { try { (navigator as any).vibrate?.(p); } catch { /* */ } };
  const fail = (m: string) => { setMsg(m); vibrate([60, 40, 60]); };
  const greet = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

  function snap(): string | undefined {
    const v = videoRef.current; if (!v || !v.videoWidth) return undefined;
    const c = document.createElement("canvas"); c.width = 360; c.height = Math.round((v.videoHeight / v.videoWidth) * 360);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.75);
  }
  async function liveness(): Promise<{ selfie?: string; livenessOk: boolean }> {
    const v = videoRef.current; if (!v || !v.videoWidth) return { livenessOk: false };
    const W = 64, H = Math.round((v.videoHeight / v.videoWidth) * W), c = document.createElement("canvas"); c.width = W; c.height = H; const cx = c.getContext("2d")!;
    const fr: Uint8ClampedArray[] = [];
    for (let i = 0; i < 4; i++) { cx.drawImage(v, 0, 0, W, H); fr.push(cx.getImageData(0, 0, W, H).data.slice()); await new Promise((r) => setTimeout(r, 320)); }
    let md = 0; for (let i = 1; i < fr.length; i++) { let sum = 0; const a = fr[i - 1]!, b = fr[i]!; for (let p = 0; p < a.length; p += 4) sum += Math.abs(a[p]! - b[p]!); md = Math.max(md, sum / (a.length / 4)); }
    return { selfie: snap(), livenessOk: md > 4 };
  }
  function geo(): Promise<{ lat?: number; lng?: number; accuracy?: number }> {
    return new Promise((res) => { if (!navigator.geolocation) return res({}); navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => res({}), { enableHighAccuracy: true, timeout: 8000 }); });
  }

  async function identify() {
    const id = code.trim(); if (!id) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/ponto-pwa/identify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, identifier: id }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { fail(d?.error?.message ?? "Não encontrei esse funcionário."); setCode(""); return; }
      setIdent(d);
      if (d.requiresPin) setStep("pin"); else await confirmar(d);
    } catch { fail("Sem conexão. Tente novamente."); } finally { setBusy(false); }
  }

  async function reconhecerRosto() {
    setBusy(true); setMsg("");
    try {
      const g = boot.device.requireGeo || boot.device.geo ? await geo() : {};
      let selfie: string | undefined, livenessOk: boolean | undefined;
      if (boot.device.requireLiveness) { const lv = await liveness(); selfie = lv.selfie; livenessOk = lv.livenessOk; if (!livenessOk) { fail("Prova de vida falhou — mexa o rosto e tente de novo."); return; } }
      else selfie = snap();
      if (!selfie) { fail("Não consegui capturar o rosto (libere a câmera)."); return; }
      const res = await fetch("/api/ponto-pwa/face-punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, selfie, ...g, livenessOk }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { fail(d?.error?.message ?? "Rosto não reconhecido. Use o código."); return; }
      vibrate(40); setResult({ name: d.employeeName, nsr: d.nsr, at: new Date(d.punchedAt).toLocaleTimeString("pt-BR"), notices: d.notices ?? [] }); setStep("done");
    } catch { fail("Sem conexão. Tente novamente."); } finally { setBusy(false); }
  }

  async function confirmar(who?: Ident) {
    const emp = who ?? ident; if (!emp) return;
    if (emp.requiresPin && !pin.trim()) { fail("Digite o PIN"); return; }
    setBusy(true); setMsg("");
    try {
      const g = boot.device.requireGeo || boot.device.geo ? await geo() : {};
      let selfie: string | undefined, livenessOk: boolean | undefined;
      if (boot.device.requireLiveness) { const lv = await liveness(); selfie = lv.selfie; livenessOk = lv.livenessOk; if (!livenessOk) { fail("Prova de vida falhou — mexa o rosto e tente de novo."); return; } }
      else if (boot.device.requireSelfie) selfie = snap();
      const payload = { employeeId: emp.id, pin: pin || undefined, ...g, selfie, livenessOk };
      let res: Response | null = null;
      try { res = await fetch("/api/ponto-pwa/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...payload }) }); } catch { res = null; }
      if (!res) {
        const q = getQueue(); q.push({ employeeId: emp.id, employeeName: emp.name, pin: pin || undefined, ...g, selfie, livenessOk, deviceAt: new Date().toISOString() }); setQueue(q); onQueued();
        vibrate(40); setResult({ name: emp.name, nsr: "—", at: new Date().toLocaleTimeString("pt-BR"), notices: ["Sem internet: marcação salva e será enviada ao reconectar."] }); setStep("done"); return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok) { fail(d?.error?.message ?? "Falha ao registrar"); return; }
      vibrate(40); setResult({ name: emp.name, nsr: d.nsr, at: new Date(d.punchedAt).toLocaleTimeString("pt-BR"), notices: d.notices ?? [] }); setStep("done");
    } finally { setBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        {needCam && step !== "done" && <video ref={videoRef} autoPlay playsInline muted className="mb-4 aspect-video w-full rounded-2xl bg-black/40 object-cover" />}

        {step === "id" && (
          <>
            <h2 className="text-2xl font-semibold">Identifique-se</h2>
            <p className="mt-1 text-sm text-white/70">Passe o crachá no leitor, ou digite CPF / matrícula.</p>
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && identify()} placeholder="Código, CPF ou matrícula" inputMode="numeric"
              className="mt-5 w-full rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-center text-xl tracking-wider placeholder-white/40 outline-none focus:border-white/60" />
            {msg && <p className="mt-3 rounded-xl bg-red-500/25 px-3 py-2 text-center text-sm font-medium text-red-100">{msg}</p>}
            <Keypad onDigit={(d) => setCode((c) => (c + d).slice(0, 20))} onBack={() => setCode((c) => c.slice(0, -1))} />
            <button disabled={busy || !code.trim()} onClick={() => identify()} className="mt-3 w-full rounded-2xl bg-white py-4 text-lg font-semibold text-neutral-900 disabled:opacity-50">{busy ? "…" : "Continuar"}</button>
            {boot.device.faceIdentify && (
              <>
                <div className="my-4 flex items-center gap-3 text-xs text-white/50"><span className="h-px flex-1 bg-white/20" />ou</div>
                <button disabled={busy} onClick={reconhecerRosto} className="w-full rounded-2xl border border-white/30 py-4 text-lg font-semibold disabled:opacity-50">{busy ? "Reconhecendo…" : "🙂 Bater pelo rosto"}</button>
              </>
            )}
            <button onClick={onClose} className="mt-3 w-full py-2 text-sm text-white/50 hover:text-white/80">Cancelar</button>
          </>
        )}

        {step === "pin" && ident && (
          <>
            <h2 className="text-2xl font-semibold">{ident.name}</h2>
            <p className="mt-1 text-sm text-white/70">Confirme com seu PIN para bater o ponto.</p>
            <input autoFocus type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmar()} placeholder="PIN" inputMode="numeric"
              className="mt-5 w-full rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-center text-2xl tracking-[0.4em] placeholder-white/40 outline-none focus:border-white/60" />
            {msg && <p className="mt-3 rounded-xl bg-red-500/25 px-3 py-2 text-center text-sm font-medium text-red-100">{msg}</p>}
            <Keypad onDigit={(d) => setPin((p) => (p + d).slice(0, 10))} onBack={() => setPin((p) => p.slice(0, -1))} />
            <div className="mt-3 flex gap-3">
              <button onClick={() => { setStep("id"); setIdent(null); setPin(""); setMsg(""); }} className="flex-1 rounded-2xl border border-white/25 py-4">Voltar</button>
              <button disabled={busy} onClick={() => confirmar()} className="flex-1 rounded-2xl bg-white py-4 font-semibold text-neutral-900 disabled:opacity-50">{busy ? "…" : "Bater ponto"}</button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/30 text-4xl">✓</div>
            <h2 className="mt-4 text-2xl font-semibold">{greet()}, {result.name.split(" ")[0]}! ✅</h2>
            <p className="mt-1 text-sm text-white/80">Ponto registrado às <b>{result.at}</b>{result.nsr !== "—" ? ` · NSR ${result.nsr}` : ""}</p>
            {result.notices.map((n, i) => <p key={i} className="mt-3 rounded-xl bg-white/10 p-3 text-sm">📢 {n}</p>)}
            <button onClick={onClose} className="mt-5 w-full rounded-2xl bg-white py-3 font-semibold text-neutral-900">Fechar ({secsLeft})</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Teclado numérico na tela — para kiosks touch sem leitor de crachá/teclado. */
function Keypad({ onDigit, onBack }: { onDigit: (d: string) => void; onBack: () => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      {keys.map((k, i) => k === "" ? <span key={i} /> : (
        <button key={i} type="button"
          onClick={() => (k === "⌫" ? onBack() : onDigit(k))}
          className="rounded-2xl border border-white/20 bg-white/10 py-4 text-2xl font-semibold text-white transition active:scale-95 active:bg-white/25">
          {k}
        </button>
      ))}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex h-screen items-center justify-center bg-neutral-950 p-6 text-center text-white"><div className="max-w-sm">{children}</div></main>;
}
