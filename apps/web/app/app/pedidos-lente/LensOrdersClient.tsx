"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface Supplier { id: string; name: string; type: string }
interface Customer { id: string; name: string; document: string | null }
interface ProductLite { id: string; name: string; category: string | null; priceCashCents: number | null; costCents: number | null }
interface Order {
  id: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  doctorSupplierId: string | null;
  doctorName: string | null;
  labSupplierId: string | null;
  labName: string | null;
  labBatchId: string | null;
  batchCode: string | null;
  prescription: any;
  examAttachmentUrl: string | null;
  customerPriceCents: string | null;
  labCostCents: string | null;
  late: boolean;
  expectedAt: string | null;
  notes: string | null;
  productDescription: string | null;
  productPhotoUrl: string | null;
  nfNumber: string | null;
  nfUrl: string | null;
  deliveryConfirmedAt: string | null;
}

/** Sobe um arquivo da empresa (imagem/PDF) e devolve a URL pública. */
async function uploadOrgFile(file: File, purpose: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("purpose", purpose);
  const res = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "Falha no upload");
  return data.url as string;
}
interface Batch {
  id: string;
  code: string;
  status: string;
  labSupplierId: string | null;
  sentAt: string | null;
  _count?: { orders: number };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  medido: { label: "Medido", cls: "bg-blue-500/20 text-blue-300" },
  solicitado: { label: "Solicitado", cls: "bg-purple-500/20 text-purple-300" },
  chegou: { label: "Chegou", cls: "bg-teal-500/20 text-teal-300" },
  avisado: { label: "Avisado", cls: "bg-orange-500/20 text-orange-300" },
  entregue: { label: "Entregue", cls: "bg-green-500/20 text-green-300" },
};

export function LensOrdersClient({
  initialOrders, initialBatches, doctors, labs, customers, products = [],
}: {
  initialOrders: Order[];
  initialBatches: Batch[];
  doctors: Supplier[];
  labs: Supplier[];
  customers: Customer[];
  products?: ProductLite[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"pedidos" | "lotes">("pedidos");
  const [err, setErr] = useState<string | null>(null);

  async function act(url: string, method = "POST", body?: any) {
    setErr(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data?.error?.message ?? "Falha"); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line">
        <TabBtn active={tab === "pedidos"} onClick={() => setTab("pedidos")}>Pedidos</TabBtn>
        <TabBtn active={tab === "lotes"} onClick={() => setTab("lotes")}>Lotes</TabBtn>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {tab === "pedidos" ? (
        <OrdersTab orders={initialOrders} doctors={doctors} labs={labs} customers={customers} products={products} act={act} />
      ) : (
        <BatchesTab batches={initialBatches} orders={initialOrders} labs={labs} act={act} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}

function OrdersTab({ orders, doctors, labs, customers, products, act }: {
  orders: Order[]; doctors: Supplier[]; labs: Supplier[]; customers: Customer[]; products: ProductLite[];
  act: (url: string, method?: string, body?: any) => Promise<boolean>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLab, setBatchLab] = useState("");

  const list = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [filter, orders],
  );

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function createBatch() {
    const ok = await act("/api/optical/batches", "POST", {
      labSupplierId: batchLab || null,
      orderIds: [...selected],
    });
    if (ok) { setSelected(new Set()); setBatchLab(""); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {["all", "medido", "solicitado", "chegou", "avisado", "entregue"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs transition ${filter === f ? "border-brand bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}>
              {f === "all" ? "Todos" : STATUS[f]?.label ?? f}
            </button>
          ))}
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
            Novo pedido
          </button>
        )}
      </div>

      {creating && (
        <OrderForm doctors={doctors} labs={labs} customers={customers} products={products} onCancel={() => setCreating(false)}
          onSaved={() => { setCreating(false); router.refresh(); }} />
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          <span>{selected.size} pedido(s) selecionado(s)</span>
          <select value={batchLab} onChange={(e) => setBatchLab(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">— laboratório —</option>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button onClick={createBatch} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Criar lote</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-fg">limpar</button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum pedido.</p>
      ) : (
        <div className="space-y-2">
          {list.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {o.status === "medido" && (
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="accent-brand" />
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {o.customerName ?? "Sem cliente"}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS[o.status]?.cls ?? "bg-line text-muted"}`}>
                      {STATUS[o.status]?.label ?? o.status}
                    </span>
                    {o.late && <span className="text-[10px] font-semibold text-red-300">⚠ atrasado</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {o.doctorName ? `Dr(a). ${o.doctorName}` : "sem médico"}
                    {o.labName ? ` · ${o.labName}` : ""}
                    {o.batchCode ? ` · lote ${o.batchCode}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {o.examAttachmentUrl && (
                  <a href={o.examAttachmentUrl} target="_blank" rel="noreferrer" className="rounded border border-line px-2 py-1 text-[11px] transition hover:border-brand">exame</a>
                )}
                {o.status === "solicitado" && (
                  <ActBtn onClick={() => act(`/api/optical/orders/${o.id}/arrived`)}>Chegou</ActBtn>
                )}
                {o.status === "chegou" && (
                  <ActBtn onClick={() => act(`/api/optical/orders/${o.id}/notify`)}>Avisar</ActBtn>
                )}
                {o.status === "avisado" && (
                  <ActBtn onClick={() => act(`/api/optical/orders/${o.id}/deliver`)}>Entregar</ActBtn>
                )}
                {o.status === "entregue" && <NfButton order={o} act={act} />}
                {o.status === "entregue" && o.deliveryConfirmedAt && (
                  <span className="rounded px-2 py-1 text-[10px] font-semibold text-green-500" title="Recebimento confirmado pelo cliente">✓ assinado</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded border border-brand px-2.5 py-1 text-[11px] text-brand transition hover:bg-brand hover:text-white">
      {children}
    </button>
  );
}

/** Botão de anexar/baixar Nota Fiscal de um pedido entregue. */
function NfButton({ order, act }: { order: Order; act: (url: string, method?: string, body?: any) => Promise<boolean> }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setBusy(true);
    try {
      const url = await uploadOrgFile(file, "nota-fiscal");
      const nfNumber = (await dialog.prompt({ title: "Anexar nota fiscal", message: "Número da NF (opcional):", placeholder: "Ex.: 12345" })) || null;
      await act(`/api/optical/orders/${order.id}/invoice`, "POST", { nfUrl: url, nfNumber });
      dialog.toast("Nota fiscal anexada e enviada ao cliente.", "success");
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setBusy(false); }
  }

  if (order.nfUrl) {
    return (
      <a href={order.nfUrl} target="_blank" rel="noreferrer" className="rounded border border-line px-2 py-1 text-[11px] transition hover:border-brand">
        NF{order.nfNumber ? ` ${order.nfNumber}` : ""}
      </a>
    );
  }
  return (
    <label className="cursor-pointer rounded border border-brand px-2.5 py-1 text-[11px] text-brand transition hover:bg-brand hover:text-white">
      {busy ? "..." : "+ NF"}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.currentTarget.value = ""; }}
      />
    </label>
  );
}

function OrderForm({ doctors, labs, customers, products, onCancel, onSaved }: {
  doctors: Supplier[]; labs: Supplier[]; customers: Customer[]; products: ProductLite[];
  onCancel: () => void; onSaved: () => void;
}) {
  const [custQuery, setCustQuery] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [doctorId, setDoctorId] = useState("");
  const [labId, setLabId] = useState("");
  const [examFile, setExamFile] = useState<File | null>(null);
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [frameProductId, setFrameProductId] = useState("");
  const [lensProductId, setLensProductId] = useState("");
  const [outroValor, setOutroValor] = useState(false);
  const [osNumber, setOsNumber] = useState("");
  // automação: vendas pagas do cliente p/ puxar a compra
  const [eligibleSales, setEligibleSales] = useState<any[]>([]);
  const [saleId, setSaleId] = useState("");

  // ao escolher a lente (produto), puxa preço e custo — salvo se "outro valor"
  function pickLens(id: string) {
    setLensProductId(id);
    if (!outroValor) {
      const p = products.find((x) => x.id === id);
      if (p) {
        if (p.priceCashCents != null) setPrice((p.priceCashCents / 100).toFixed(2));
        if (p.costCents != null) setCost((p.costCents / 100).toFixed(2));
      }
    }
  }

  // ao escolher o cliente, busca as compras pagas dele
  useEffect(() => {
    if (!customerId) { setEligibleSales([]); setSaleId(""); return; }
    fetch(`/api/optical/eligible-sales?customerId=${customerId}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEligibleSales(d?.items ?? []))
      .catch(() => setEligibleSales([]));
  }, [customerId]);

  // puxa óculos + lente + lab da compra escolhida (auto-preenche, evita erro)
  function pickSale(s: any) {
    setSaleId(s.id);
    if (s.frame?.id) setFrameProductId(s.frame.id);
    if (s.lens?.id) { pickLens(s.lens.id); if (s.lens.labSupplierId) setLabId(s.lens.labSupplierId); }
  }
  const [od, setOd] = useState({ esf: "", cil: "", eixo: "", dnp: "", altura: "", adicao: "" });
  const [oe, setOe] = useState({ esf: "", cil: "", eixo: "", dnp: "", altura: "", adicao: "" });
  const [tipo, setTipo] = useState("");
  const [tratamentos, setTratamentos] = useState("");
  const [armacao, setArmacao] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPhotoUrl, setProductPhotoUrl] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const d = q.replace(/\D/g, "");
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) || (d.length >= 3 && (c.document ?? "").replace(/\D/g, "").includes(d)),
    ).slice(0, 8);
  }, [custQuery, customers]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const toCents = (v: string) => { const n = Number(v.replace(",", ".")); return isNaN(n) ? null : Math.round(n * 100); };
      const res = await fetch("/api/optical/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerId: customerId || null,
          saleId: saleId || null,
          doctorSupplierId: doctorId || null,
          labSupplierId: labId || null,
          frameProductId: frameProductId || null,
          lensProductId: lensProductId || null,
          osNumber: osNumber.trim() || null,
          // só manda preço/custo explícito quando "outro valor" (senão o backend puxa da lente)
          customerPriceCents: outroValor ? toCents(price) : (lensProductId ? undefined : toCents(price)),
          labCostCents: outroValor ? toCents(cost) : (lensProductId ? undefined : toCents(cost)),
          notes: notes.trim() || null,
          productDescription: productDescription.trim() || null,
          productPhotoUrl: productPhotoUrl || null,
          prescription: { od, oe, tipo: tipo || null, tratamentos: tratamentos || null, armacao: armacao || null },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      // upload direto do exame (sem link) — anexa ao pedido recém-criado
      if (examFile && data.order?.id) {
        const fd = new FormData(); fd.append("file", examFile);
        await fetch(`/api/optical/orders/${data.order.id}/exam`, { method: "POST", body: fd, credentials: "include" }).catch(() => undefined);
      }
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Novo pedido de lente</h2>

      {/* cliente */}
      <div>
        <span className="mb-1 block text-[10px] uppercase text-muted">Cliente</span>
        {customerId ? (
          <div className="flex items-center justify-between gap-2 rounded border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
            <span>{customerName}</span>
            <button onClick={() => { setCustomerId(""); setCustomerName(""); }} className="text-muted hover:text-red-300">×</button>
          </div>
        ) : (
          <div className="relative">
            <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder="Buscar por nome ou CPF" className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            {matches.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-line bg-bg shadow-xl">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { setCustomerId(c.id); setCustomerName(c.name); setCustQuery(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-line">
                      {c.name}{c.document ? <span className="text-xs text-muted"> · {c.document}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Puxar a compra (auto-preenche óculos + lente + lab) */}
      {customerId && eligibleSales.length > 0 && (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
          <span className="mb-1 block text-[10px] uppercase text-muted">Puxar da compra paga (auto-preenche óculos, lente e laboratório)</span>
          <div className="space-y-1">
            {eligibleSales.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pickSale(s)}
                className={`flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm transition ${saleId === s.id ? "border-brand bg-brand/10" : "border-line hover:border-brand"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{s.items.map((i: any) => `${i.qty}× ${i.name}`).join(" · ")}</span>
                  <span className="block text-[11px] text-muted">
                    {new Date(s.createdAt).toLocaleDateString("pt-BR")} · {(s.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    {s.frame ? ` · óculos: ${s.frame.name}` : ""}{s.lens ? ` · lente: ${s.lens.name}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-brand">{saleId === s.id ? "✓ puxado" : "puxar"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Médico</span>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Laboratório</span>
          <select value={labId} onChange={(e) => setLabId(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">—</option>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      {/* medidas */}
      <div className="rounded-lg border border-line bg-bg/40 p-3">
        <span className="mb-2 block text-[10px] uppercase text-muted">Medidas</span>
        <EyeRow label="OD" v={od} set={setOd} />
        <EyeRow label="OE" v={oe} set={setOe} />
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo de lente" className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
          <input value={tratamentos} onChange={(e) => setTratamentos(e.target.value)} placeholder="Tratamentos" className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
          <input value={armacao} onChange={(e) => setArmacao(e.target.value)} placeholder="Armação" className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
        </div>
      </div>

      {/* produtos: óculos (estoque) + lente (preço/custo) + OS */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Óculos / armação (estoque)</span>
          <select value={frameProductId} onChange={(e) => setFrameProductId(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="mt-0.5 block text-[10px] text-muted">baixa 1 do estoque ao salvar</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Lente (produto)</span>
          <select value={lensProductId} onChange={(e) => pickLens(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="mt-0.5 block text-[10px] text-muted">puxa preço e custo automaticamente</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">OS manual (opcional)</span>
          <input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="nº da OS feita à mão" className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={outroValor} onChange={(e) => setOutroValor(e.target.checked)} className="h-4 w-4 accent-brand" />
        Outro valor? (digitar preço/custo manualmente em vez do da lente)
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Valor cobrado (R$)</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" disabled={!!lensProductId && !outroValor} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm disabled:opacity-50" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Custo lab (R$)</span>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" disabled={!!lensProductId && !outroValor} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm disabled:opacity-50" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Exame (upload)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setExamFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
          {examFile && <span className="mt-0.5 block text-[10px] text-green-300">{examFile.name}</span>}
        </label>
      </div>

      {/* produto / óculos pronto (mostrado ao cliente no portal quando entregue) */}
      <div className="rounded-lg border border-line bg-bg/40 p-3">
        <span className="mb-2 block text-[10px] uppercase text-muted">Produto / óculos</span>
        <textarea
          value={productDescription}
          onChange={(e) => setProductDescription(e.target.value)}
          rows={2}
          placeholder="Descrição do óculos pronto (modelo da armação, lente, cor...)"
          className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          {productPhotoUrl ? (
            <img src={productPhotoUrl} alt="produto" className="h-14 w-14 rounded object-cover" />
          ) : null}
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs transition hover:border-brand">
            {photoBusy ? "Enviando..." : productPhotoUrl ? "Trocar foto" : "+ foto do produto"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]; e.currentTarget.value = "";
                if (!f) return;
                setPhotoBusy(true); setErr(null);
                try { setProductPhotoUrl(await uploadOrgFile(f, "produto")); }
                catch (er: any) { setErr(er.message); }
                finally { setPhotoBusy(false); }
              }}
            />
          </label>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase text-muted">Observações</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
      </label>

      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Salvando..." : "Salvar pedido"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Cancelar</button>
      </div>
    </section>
  );
}

function EyeRow({ label, v, set }: { label: string; v: any; set: (x: any) => void }) {
  const fields = ["esf", "cil", "eixo", "dnp", "altura", "adicao"];
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-8 text-xs font-semibold text-muted">{label}</span>
      <div className="grid flex-1 grid-cols-6 gap-1">
        {fields.map((f) => (
          <input key={f} value={v[f]} onChange={(e) => set({ ...v, [f]: e.target.value })} placeholder={f} className="rounded border border-line bg-bg/60 px-1.5 py-1 text-xs" />
        ))}
      </div>
    </div>
  );
}

function BatchesTab({ batches, orders, labs, act }: {
  batches: Batch[]; orders: Order[]; labs: Supplier[];
  act: (url: string, method?: string, body?: any) => Promise<boolean>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const labName = (id: string | null) => labs.find((l) => l.id === id)?.name ?? "—";

  if (batches.length === 0) {
    return <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum lote. Crie um na aba Pedidos selecionando pedidos medidos.</p>;
  }
  return (
    <div className="space-y-2">
      {batches.map((b) => {
        const items = orders.filter((o) => o.labBatchId === b.id);
        return (
          <div key={b.id} className="rounded-lg border border-line bg-bg/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  Lote {b.code}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${b.status === "recebido" ? "bg-green-500/20 text-green-300" : b.status === "recebido_parcial" ? "bg-orange-500/20 text-orange-300" : "bg-purple-500/20 text-purple-300"}`}>
                    {b.status}
                  </span>
                </p>
                <p className="text-xs text-muted">{labName(b.labSupplierId)} · {b._count?.orders ?? items.length} pedido(s)</p>
              </div>
              <div className="flex gap-2">
                <a href={`/api/optical/batches/${b.id}/sheet`} target="_blank" rel="noreferrer" className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">Imprimir folha</a>
                {b.status !== "recebido" && (
                  <button onClick={() => setOpenId(openId === b.id ? null : b.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">
                    {openId === b.id ? "Fechar" : "Conferir"}
                  </button>
                )}
              </div>
            </div>
            {openId === b.id && <Confer batch={b} items={items} act={act} onDone={() => setOpenId(null)} />}
          </div>
        );
      })}
    </div>
  );
}

function Confer({ batch, items, act, onDone }: {
  batch: Batch; items: Order[];
  act: (url: string, method?: string, body?: any) => Promise<boolean>;
  onDone: () => void;
}) {
  // estado por pedido: 'arrived' | 'late' | none
  const [marks, setMarks] = useState<Record<string, "arrived" | "late" | "">>({});
  const [prazos, setPrazos] = useState<Record<string, string>>({});

  async function submit() {
    const arrived = Object.entries(marks).filter(([, v]) => v === "arrived").map(([k]) => k);
    const late = Object.entries(marks).filter(([, v]) => v === "late").map(([k]) => ({ orderId: k, expectedAt: prazos[k] || null }));
    const ok = await act(`/api/optical/batches/${batch.id}/confer`, "POST", { arrived, late });
    if (ok) onDone();
  }

  return (
    <div className="mt-3 space-y-2 border-t border-line/50 pt-3">
      {items.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{o.customerName ?? "Sem cliente"} {o.status !== "solicitado" && <span className="text-[10px] text-muted">({o.status})</span>}</span>
          <label className="flex items-center gap-1 text-xs"><input type="radio" name={`m-${o.id}`} checked={marks[o.id] === "arrived"} onChange={() => setMarks((m) => ({ ...m, [o.id]: "arrived" }))} /> chegou</label>
          <label className="flex items-center gap-1 text-xs"><input type="radio" name={`m-${o.id}`} checked={marks[o.id] === "late"} onChange={() => setMarks((m) => ({ ...m, [o.id]: "late" }))} /> atrasado</label>
          {marks[o.id] === "late" && (
            <input type="date" value={prazos[o.id] ?? ""} onChange={(e) => setPrazos((p) => ({ ...p, [o.id]: e.target.value }))} className="rounded border border-line bg-bg/60 px-2 py-0.5 text-xs" />
          )}
        </div>
      ))}
      <button onClick={submit} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
        Salvar conferência
      </button>
    </div>
  );
}
