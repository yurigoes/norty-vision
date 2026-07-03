// Campos fixos da batida do dia (sem campo a mais): entrada, almoço, [lanche], saída.
// Usado no ajuste do ponto (espelho RH e painel do líder) — substitui o dia (não duplica).
export const PUNCH_FIELDS = [
  { key: "entrada", label: "Entrada" },
  { key: "saidaAlmoco", label: "Saída almoço" },
  { key: "voltaAlmoco", label: "Volta almoço" },
  { key: "saidaLanche", label: "Saída lanche", snack: true },
  { key: "voltaLanche", label: "Volta lanche", snack: true },
  { key: "saida", label: "Saída" },
] as const;

export type PunchForm = { entrada: string; saidaAlmoco: string; voltaAlmoco: string; saidaLanche: string; voltaLanche: string; saida: string };
export const emptyPunchForm = (): PunchForm => ({ entrada: "", saidaAlmoco: "", voltaAlmoco: "", saidaLanche: "", voltaLanche: "", saida: "" });

/** Distribui as batidas existentes (cronológicas) nos campos rotulados. */
export function punchesToForm(p: string[]): { form: PunchForm; snack: boolean } {
  const f = emptyPunchForm(); const n = p.length;
  if (n >= 6) { f.entrada = p[0] ?? ""; f.saidaAlmoco = p[1] ?? ""; f.voltaAlmoco = p[2] ?? ""; f.saidaLanche = p[3] ?? ""; f.voltaLanche = p[4] ?? ""; f.saida = p[5] ?? ""; return { form: f, snack: true }; }
  if (n === 5) { f.entrada = p[0] ?? ""; f.saidaAlmoco = p[1] ?? ""; f.voltaAlmoco = p[2] ?? ""; f.saidaLanche = p[3] ?? ""; f.saida = p[4] ?? ""; return { form: f, snack: true }; }
  if (n === 4) { f.entrada = p[0] ?? ""; f.saidaAlmoco = p[1] ?? ""; f.voltaAlmoco = p[2] ?? ""; f.saida = p[3] ?? ""; return { form: f, snack: false }; }
  if (n === 3) { f.entrada = p[0] ?? ""; f.saidaAlmoco = p[1] ?? ""; f.voltaAlmoco = p[2] ?? ""; return { form: f, snack: false }; }
  if (n === 2) { f.entrada = p[0] ?? ""; f.saida = p[1] ?? ""; return { form: f, snack: false }; }
  if (n === 1) { f.entrada = p[0] ?? ""; return { form: f, snack: false }; }
  return { form: f, snack: false };
}

/** Sequência cronológica das batidas preenchidas (entrada → almoço → [lanche] → saída). */
export function formToTimes(f: PunchForm, snack: boolean): string[] {
  const seq = [f.entrada, f.saidaAlmoco, f.voltaAlmoco, ...(snack ? [f.saidaLanche, f.voltaLanche] : []), f.saida];
  return seq.map((t) => (t || "").trim()).filter(Boolean);
}
