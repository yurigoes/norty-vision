"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function rxSummary(rx: any): string {
  if (!rx || typeof rx !== "object") return "—";
  const eye = (e: any) => e ? `esf ${e.esf ?? "-"} cil ${e.cil ?? "-"} eixo ${e.eixo ?? "-"}` : "-";
  return [rx.od ? `OD: ${eye(rx.od)}` : "", rx.oe ? `OE: ${eye(rx.oe)}` : "", rx.tipo].filter(Boolean).join(" | ") || "—";
}

export default function SupplierDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [patients, setPatients] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [productionQueue, setProductionQueue] = useState<any[]>([]);
  const [tab, setTab] = useState<"pacientes" | "pagamentos" | "producao">("pacientes");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/supplier-portal/me", { credentials: "include" });
      if (meRes.status === 401) { router.push("/f/login"); return; }
      const meData = await meRes.json();
      if (meData?.supplier?.mustReset) { router.push("/f/redefinir"); return; }
      setMe(meData.supplier);
      const isCostureira = meData.supplier?.type === "costureira";
      const calls: Promise<any>[] = [
        fetch("/api/supplier-portal/payments", { credentials: "include" }).then((r) => r.json()),
      ];
      if (isCostureira) {
        setTab("producao");
        calls.unshift(fetch("/api/supplier-portal/production/queue", { credentials: "include" }).then((r) => r.json()));
      } else {
        calls.unshift(fetch("/api/supplier-portal/patients", { credentials: "include" }).then((r) => r.json()));
      }
      const [first, pay] = await Promise.all(calls);
      if (isCostureira) setProductionQueue(first?.items ?? []);
      else setPatients(first);
      setPayments(pay?.items ?? []);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [router]);

  async function logout() {
    await fetch("/api/supplier-portal/auth/logout", { method: "POST", credentials: "include" });
    router.push("/f/login");
  }

  if (loading) return <Centered>Carregando...</Centered>;
  if (!me) return <Centered>Sessão expirada.</Centered>;
  const isCostureira = me.type === "costureira";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Olá, {me.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted">{me.type === "medico" ? "Médico" : me.type === "laboratorio" ? "Laboratório" : me.type === "costureira" ? "Costureira" : "Fornecedor"}</p>
        </div>
        <button onClick={logout} className="text-sm text-muted transition-colors hover:text-danger">Sair</button>
      </header>

      {isCostureira ? (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Stat label="OSs na fila" value={String(productionQueue.length)} />
          <Stat label="Peças pendentes" value={String(productionQueue.reduce((s, o) => s + (o.totalPieces ?? 0), 0))} />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Stat label="Pacientes atendidos" value={String(patients?.patientsCount ?? 0)} />
          <Stat label="Pedidos" value={String(patients?.ordersCount ?? 0)} />
        </div>
      )}

      <div className="mb-4 flex gap-2 border-b border-line">
        {isCostureira ? (
          <Tab active={tab === "producao"} onClick={() => setTab("producao")}>Minha fila</Tab>
        ) : (
          <Tab active={tab === "pacientes"} onClick={() => setTab("pacientes")}>Pacientes</Tab>
        )}
        <Tab active={tab === "pagamentos"} onClick={() => setTab("pagamentos")}>Pagamentos</Tab>
        {isCostureira && (
          <Link href="/f/producao/relatorio" className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted hover:text-fg">Relatório</Link>
        )}
      </div>

      {isCostureira && tab === "producao" ? (
        <div className="space-y-2">
          {productionQueue.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted shadow-[var(--shadow-sm)]">Nenhuma OS na sua fila no momento. Quando o admin atribuir uma, ela aparece aqui.</p>
          ) : (
            productionQueue.map((o: any) => (
              <Link key={o.id} href={`/f/producao/${o.id}`} className="block rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold">#{o.shortCode ?? "—"}</p>
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">{o.totalPieces ?? 0} pç</span>
                </div>
                <p className="mt-1 text-xs text-muted">{o.description ?? "—"}</p>
                {o.dueDate && (
                  <p className="mt-1 text-[11px] text-amber-300">prazo {new Date(o.dueDate).toLocaleDateString("pt-BR")}</p>
                )}
              </Link>
            ))
          )}
          <p className="pt-2 text-[11px] text-muted">Toque numa OS para ver a arte + ficha de tamanhos. Quando terminar, abra a OS e toque em "Pedido pronto".</p>
        </div>
      ) : tab === "pacientes" ? (
        <div className="space-y-2">
          {(patients?.items ?? []).length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted shadow-[var(--shadow-sm)]">Nenhum paciente.</p>
          ) : (
            (patients.items as any[]).map((o) => (
              <div key={o.id} className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{o.patientName}</p>
                  <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleDateString("pt-BR")} · {o.status}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted">{rxSummary(o.prescription)}</p>
              </div>
            ))
          )}
          <p className="pt-2 text-[11px] text-muted">Por privacidade, telefone e endereço dos pacientes não são exibidos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payments.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted shadow-[var(--shadow-sm)]">Nenhum pagamento.</p>
          ) : (
            payments.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                <div>
                  <p className="text-sm font-medium">{brl(s.totalCents)}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase ${s.status === "paid" ? "bg-green-500/20 text-green-300" : "bg-orange-500/20 text-orange-300"}`}>
                      {s.status === "paid" ? "pago" : "pendente"}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{s.items?.length ?? 0} item(ns){s.paidAt ? ` · ${new Date(s.paidAt).toLocaleDateString("pt-BR")}` : ""}</p>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/supplier-portal/payments/${s.id}/receipt`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">Recibo</a>
                  {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">Comprovante</a>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{children}</button>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">{children}</div>;
}
