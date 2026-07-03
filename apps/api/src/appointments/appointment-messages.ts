/**
 * Mensagens de agendamento (WhatsApp). As datas/horários são formatados em
 * UTC porque os slots são gravados como Date.UTC(ano,mês,dia,HH,MM) — ou seja,
 * o "relógio de parede" digitado pelo operador. Formatar em UTC devolve o
 * mesmo HH:MM que foi aberto na agenda.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export function genShortCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDateBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtTimeBR(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
}

/** Dias inteiros entre hoje (UTC) e a data do agendamento. */
export function daysUntil(d: Date): number {
  const startOfDay = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = startOfDay(d) - startOfDay(new Date());
  return Math.max(0, Math.round(diff / 86400_000));
}

/**
 * Janelas de chegada (início de cada faixa). O exame é SEMPRE por ordem de
 * chegada: a mensagem nunca anuncia o horário exato do slot, e sim o início da
 * janela em que ele cai. Ex.: agendado 07:00 → "a partir das 06:30". Isso evita
 * que o paciente chegue na hora exata e reduz atrasos/aglomeração.
 */
export const DEFAULT_ARRIVAL_WINDOWS = ["06:30", "07:30", "08:30", "09:30", "10:30", "11:30", "13:00"];

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Início da janela de chegada em que o horário do slot cai. */
export function arrivalWindowLabel(startsAt: Date, windows: string[] = DEFAULT_ARRIVAL_WINDOWS): string {
  const total = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
  const mins = windows
    .map((w) => ({ label: w, total: hhmmToMin(w) }))
    .sort((a, b) => a.total - b.total);
  if (mins.length === 0) return fmtTimeBR(startsAt);
  for (let i = 0; i < mins.length; i++) {
    const atual = mins[i]!;
    const prox = mins[i + 1];
    if (!prox || total < prox.total) return atual.label;
  }
  return mins[mins.length - 1]!.label;
}

function whenLine(startsAt: Date, windows?: string[]): string {
  return `a partir das ${arrivalWindowLabel(startsAt, windows)} por Ordem de Chegada`;
}

export interface ApptMsgCtx {
  name: string;
  startsAt: Date;
  byArrival: boolean;            // (legado) slot com capacidade > 1 — não usado: sempre por chegada
  storeName: string;
  examPriceCents: number;
  paymentNote: string;           // ex.: "no Pix ou dinheiro"
  portalUrl?: string | null;     // link /a/{code}
  serviceName?: string | null;
  arrivalWindows?: string[];     // janelas configuráveis (default DEFAULT_ARRIVAL_WINDOWS)
}

/** Mensagem enviada AO AGENDAR. */
export function buildBookedMessage(c: ApptMsgCtx): string {
  const first = (c.name || "Cliente").split(" ")[0];
  const dias = daysUntil(c.startsAt);
  const exame = c.serviceName || "exame de vista";
  const linkBlock = c.portalUrl
    ? `\nConfirme pelo link: ${c.portalUrl}\n\nOu responda aqui mesmo:`
    : `\nResponda:`;
  return (
    `📅 Olá ${first}\n\n` +
    `Passando para informar que seu ${exame} é dia ${fmtDateBR(c.startsAt)} ${whenLine(c.startsAt, c.arrivalWindows)}.\n\n` +
    `⏳ Faltam ${dias} dia(s).\n\n` +
    `💳 Valor do exame: ${brl(c.examPriceCents)} ${c.paymentNote}.\n` +
    linkBlock + `\n` +
    `1️⃣ CONFIRMAR\n` +
    `2️⃣ CANCELAR\n` +
    `3️⃣ REAGENDAR\n\n` +
    `> Sistema de Confirmação YUGO+`
  );
}

/** Lembrete (cron 24h). Mesmo padrão do agendamento, com tom de lembrete. */
export function buildReminderMessage(c: ApptMsgCtx): string {
  const first = (c.name || "Cliente").split(" ")[0];
  const dias = daysUntil(c.startsAt);
  const exame = c.serviceName || "exame de vista";
  const linkBlock = c.portalUrl
    ? `\nConfirme pelo link: ${c.portalUrl}\n\nOu responda aqui mesmo:`
    : `\nResponda:`;
  return (
    `⏰ Olá ${first}, lembrete do seu agendamento!\n\n` +
    `Seu ${exame} é dia ${fmtDateBR(c.startsAt)} ${whenLine(c.startsAt, c.arrivalWindows)}.\n\n` +
    `⏳ ${dias === 0 ? "É hoje!" : `Faltam ${dias} dia(s).`}\n\n` +
    `💳 Valor do exame: ${brl(c.examPriceCents)} ${c.paymentNote}.\n` +
    linkBlock + `\n` +
    `1️⃣ CONFIRMAR\n` +
    `2️⃣ CANCELAR\n` +
    `3️⃣ REAGENDAR\n\n` +
    `> Sistema de Confirmação YUGO+`
  );
}

/** Mensagem enviada AO CONFIRMAR. */
export function buildConfirmedMessage(c: ApptMsgCtx): string {
  return (
    `📅✅ Agendamento Confirmado!\n` +
    `Seu agendamento foi confirmado com sucesso 🎉\n` +
    `📍 Local: ${c.storeName}\n` +
    `🗓️ Data: ${fmtDateBR(c.startsAt)}\n` +
    `⏰ Horário: A partir das ${arrivalWindowLabel(c.startsAt, c.arrivalWindows)} por ordem de chegada\n` +
    `💳 Valor do exame: ${brl(c.examPriceCents)} ${c.paymentNote}\n` +
    `Estamos te esperando para oferecer o melhor atendimento 🤓✨\n` +
    `Se precisar reagendar ou tiver qualquer dúvida, é só responder essa mensagem 😉\n` +
    `Até breve! 👓💙\n\n` +
    `> Sistema de Confirmação YUGO+`
  );
}

/** Mensagem enviada AO CANCELAR. */
export function buildCanceledMessage(c: Pick<ApptMsgCtx, "name" | "startsAt" | "storeName">): string {
  const first = (c.name || "Cliente").split(" ")[0];
  return (
    `❌ Olá ${first}, seu agendamento de ${fmtDateBR(c.startsAt)} em ${c.storeName} foi *cancelado*.\n` +
    `Quando quiser remarcar, é só responder esta mensagem que a gente te ajuda. 💙\n\n` +
    `> Sistema de Confirmação YUGO+`
  );
}
