// Adaptadores de exportação para folhas externas (skeleton, evolutivo).
// Cada folha (Domínio, Senior, TOTVS…) tem um leiaute de importação próprio.
// Aqui montamos a estrutura: a partir das LINHAS do fechamento (summary.rows),
// um layout define separador, formato de hora/decimal e as colunas.
//
// IMPORTANTE: os leiautes abaixo são PONTOS DE PARTIDA. O arquivo definitivo de
// cada cliente deve ser conferido contra o manual de importação da folha dele
// (códigos de rubrica, ordem de colunas, cabeçalho/rodapé) antes de usar em produção.

export interface PayrollRow {
  employerName?: string | null;
  cpf?: string | null;
  pis?: string | null;
  matricula?: string | null;
  matEsocial?: string | null;
  name: string;
  expectedMin: number;
  workedMin: number;
  extraMin: number;
  nightMin: number;
  lateMin: number;
  faltaMin: number;
  balanceMin: number;
  bankBalanceMin: number;
}

export type TimeFormat = "hhmm" | "decimal" | "minutes";

export interface PayrollLayout {
  key: string;
  label: string;
  description: string;
  ext: "csv" | "txt";
  sep: string;
  decimal: "," | ".";
  time: TimeFormat;
  /** colunas: rótulo do cabeçalho + extrator do valor da linha */
  columns: Array<{ h: string; v: (r: PayrollRow) => string }>;
  /** cabeçalho de colunas? (alguns leiautes posicionais não usam) */
  header: boolean;
}

function fmtTime(min: number, fmt: TimeFormat, decimal: "," | "."): string {
  const neg = min < 0 ? "-" : "";
  const a = Math.abs(min);
  if (fmt === "minutes") return `${neg}${a}`;
  if (fmt === "decimal") { const s = (a / 60).toFixed(2); return `${neg}${decimal === "," ? s.replace(".", ",") : s}`; }
  return `${neg}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
const onlyDigits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

export const PAYROLL_LAYOUTS: PayrollLayout[] = [
  {
    key: "generic",
    label: "Genérico (h:mm)",
    description: "CSV legível, horas em h:mm — bom para conferência e importações simples.",
    ext: "csv", sep: ";", decimal: ",", time: "hhmm", header: true,
    columns: [
      { h: "empresa", v: (r) => r.employerName ?? "" },
      { h: "cpf", v: (r) => r.cpf ?? "" },
      { h: "matricula", v: (r) => r.matricula ?? "" },
      { h: "mat_esocial", v: (r) => r.matEsocial ?? "" },
      { h: "nome", v: (r) => r.name },
      { h: "previstas", v: (r) => fmtTime(r.expectedMin, "hhmm", ",") },
      { h: "trabalhadas", v: (r) => fmtTime(r.workedMin, "hhmm", ",") },
      { h: "extras", v: (r) => fmtTime(r.extraMin, "hhmm", ",") },
      { h: "noturnas", v: (r) => fmtTime(r.nightMin, "hhmm", ",") },
      { h: "atrasos", v: (r) => fmtTime(r.lateMin, "hhmm", ",") },
      { h: "faltas", v: (r) => fmtTime(r.faltaMin, "hhmm", ",") },
      { h: "saldo_mes", v: (r) => fmtTime(r.balanceMin, "hhmm", ",") },
      { h: "banco_horas", v: (r) => fmtTime(r.bankBalanceMin, "hhmm", ",") },
    ],
  },
  {
    key: "dominio",
    label: "Domínio (Thomson Reuters)",
    description: "CSV ; com horas decimais (vírgula). Confirmar códigos de rubrica no manual de importação da Domínio.",
    ext: "txt", sep: ";", decimal: ",", time: "decimal", header: true,
    columns: [
      { h: "matricula", v: (r) => r.matricula ?? onlyDigits(r.cpf) },
      { h: "cpf", v: (r) => onlyDigits(r.cpf) },
      { h: "nome", v: (r) => r.name },
      { h: "horas_normais", v: (r) => fmtTime(r.workedMin, "decimal", ",") },
      { h: "horas_extras", v: (r) => fmtTime(r.extraMin, "decimal", ",") },
      { h: "adicional_noturno", v: (r) => fmtTime(r.nightMin, "decimal", ",") },
      { h: "faltas_horas", v: (r) => fmtTime(r.faltaMin, "decimal", ",") },
      { h: "atrasos_horas", v: (r) => fmtTime(r.lateMin, "decimal", ",") },
    ],
  },
  {
    key: "senior",
    label: "Senior (Rubi/HCM)",
    description: "CSV ; com horas em minutos inteiros. Confirmar mapa de eventos (códigos) no Senior.",
    ext: "csv", sep: ";", decimal: ".", time: "minutes", header: true,
    columns: [
      { h: "cpf", v: (r) => onlyDigits(r.cpf) },
      { h: "pis", v: (r) => onlyDigits(r.pis) },
      { h: "matricula", v: (r) => r.matricula ?? "" },
      { h: "nome", v: (r) => r.name },
      { h: "min_normais", v: (r) => fmtTime(r.workedMin, "minutes", ".") },
      { h: "min_extras", v: (r) => fmtTime(r.extraMin, "minutes", ".") },
      { h: "min_noturno", v: (r) => fmtTime(r.nightMin, "minutes", ".") },
      { h: "min_faltas", v: (r) => fmtTime(r.faltaMin, "minutes", ".") },
      { h: "min_atrasos", v: (r) => fmtTime(r.lateMin, "minutes", ".") },
    ],
  },
  {
    key: "totvs",
    label: "TOTVS (Protheus/RM)",
    description: "CSV ; com horas decimais (ponto). Confirmar layout de importação de apontamentos no Protheus/RM.",
    ext: "csv", sep: ";", decimal: ".", time: "decimal", header: true,
    columns: [
      { h: "matricula", v: (r) => r.matricula ?? "" },
      { h: "cpf", v: (r) => onlyDigits(r.cpf) },
      { h: "nome", v: (r) => r.name },
      { h: "he_normais", v: (r) => fmtTime(r.workedMin, "decimal", ".") },
      { h: "he_extras", v: (r) => fmtTime(r.extraMin, "decimal", ".") },
      { h: "adic_noturno", v: (r) => fmtTime(r.nightMin, "decimal", ".") },
      { h: "faltas", v: (r) => fmtTime(r.faltaMin, "decimal", ".") },
      { h: "atrasos", v: (r) => fmtTime(r.lateMin, "decimal", ".") },
    ],
  },
];

export function getPayrollLayout(key?: string | null): PayrollLayout {
  return PAYROLL_LAYOUTS.find((l) => l.key === (key ?? "generic")) ?? PAYROLL_LAYOUTS[0]!;
}

export function renderPayroll(layout: PayrollLayout, rows: PayrollRow[]): string {
  const esc = (s: string) => (s.includes(layout.sep) || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
  const body = rows.map((r) => layout.columns.map((c) => esc(c.v(r) ?? "")).join(layout.sep));
  const head = layout.header ? [layout.columns.map((c) => c.h).join(layout.sep)] : [];
  return [...head, ...body].join("\r\n");
}
