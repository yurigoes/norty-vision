"use client";

// Página "Telefone" — agora é um consumidor leve do SoftphoneProvider (global).
// Engine, chamada entrante (modal) e barra de ligação rodam app-wide; aqui só
// renderizamos status + diretório + conferência.

import { useState } from "react";
import { useSoftphone } from "../../../components/SoftphoneProvider";

export function VoipClient() {
  const { cfg, status, ops, callState, error, connect, disconnect, refreshDir, startCall, startNumberCall, openConference, pushEnabled } = useSoftphone();
  const [filter, setFilter] = useState("");
  const [dialNumber, setDialNumber] = useState("");
  const filtered = ops.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase()) || o.extension.includes(filter));
  const canDialPstn = cfg?.mode === "sip"; // só com PABX/SIP configurado
  function dial() {
    const d = dialNumber.replace(/[^0-9]/g, "");
    if (d.length >= 8) { startNumberCall(d); setDialNumber(""); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
        <div>
          <p className="text-xs text-muted">Seu ramal {cfg?.mode === "sip" ? "· PABX" : cfg?.mode === "p2p" ? "· P2P" : ""}</p>
          <p className="text-2xl font-semibold">{cfg?.extension ?? "…"}</p>
          <p className="text-sm text-muted">{cfg?.displayName ?? ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            status === "online" ? "bg-green-500/15 text-green-600" : status === "connecting" ? "bg-amber-500/15 text-amber-600" : status === "failed" ? "bg-red-500/15 text-red-600" : "bg-muted/15 text-muted"}`}>
            <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-green-500" : status === "connecting" ? "bg-amber-500 animate-pulse" : status === "failed" ? "bg-red-500" : "bg-muted"}`} />
            {status === "online" ? "Conectado" : status === "connecting" ? "Conectando…" : status === "failed" ? "Falha" : "Desligado"}
          </span>
          {status === "off" || status === "failed" ? (
            <button onClick={connect} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Conectar</button>
          ) : (
            <button onClick={disconnect} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">Desconectar</button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}

      {status === "online" && (
        <p className="text-xs text-muted">
          {pushEnabled
            ? "🔔 Notificações ligadas — você recebe a chamada em qualquer tela, mesmo com o app fechado."
            : "Dica: instale o app na tela inicial (menu do navegador → ‘Adicionar à tela’) pra receber chamadas em qualquer tela."}
        </p>
      )}

      {canDialPstn && (
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <h2 className="mb-2 text-sm font-semibold">Discar para número externo</h2>
          <div className="flex gap-2">
            <input
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") dial(); }}
              inputMode="numeric"
              placeholder="Ex.: 7133334444 (DDD + número)"
              className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              disabled={status !== "online" || callState !== "idle"}
            />
            <button
              onClick={dial}
              disabled={status !== "online" || callState !== "idle" || dialNumber.replace(/\D/g, "").length < 8}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >📞 Ligar</button>
          </div>
          <p className="mt-2 text-xs text-muted">
            A operadora toca o "tuuu" pra você enquanto o cliente está chamando. Sai com a sua linha cadastrada na bina.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Ligar para um operador</h2>
          <div className="flex items-center gap-2">
            <button onClick={openConference} disabled={status !== "online"} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-40">🎙️ Conferência</button>
            <button onClick={refreshDir} disabled={status !== "online"} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Atualizar</button>
          </div>
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nome ou ramal…" className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
        {status !== "online" ? (
          <p className="py-6 text-center text-sm text-muted">Clique em <b>Conectar</b> pra ver os operadores online e ligar.</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{ops.length === 0 ? "Nenhum outro operador com ramal ainda." : "Nada encontrado."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((o) => (
              <li key={o.extension} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${o.online ? "bg-green-500" : "bg-muted/50"}`} title={o.online ? "online" : "offline"} />
                  <span className="font-medium">{o.name}</span> <span className="text-xs text-muted">ramal {o.extension}</span>
                </span>
                <button onClick={() => startCall(o)} disabled={callState !== "idle"} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">📞 Ligar</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">
        {cfg?.mode === "sip"
          ? "Ramais via PABX (SIP/FreeSWITCH). Ligações internas grátis; voz externa (PSTN) precisa de trunk (Fase C)."
          : "Ligações entre ramais são internas e gratuitas (WebRTC ponto-a-ponto, mídia via Cloudflare TURN). Conferência abre uma sala da sua empresa."}
        {" "}Permita o microfone quando o navegador pedir.
      </p>
    </div>
  );
}
