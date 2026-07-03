/**
 * Helpers de telefone BR.
 *
 * Armazenamento (backend): 55 + DDD + numero  ->  5511999998888
 * Exibicao:                (11) 99999-8888
 */

/** Formata pra exibicao: (DD) NXXXX-XXXX ou (DD) XXXX-XXXX. */
export function formatBRPhone(raw?: string | null): string {
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // tira o 55 pra exibir
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

/** Mascara em tempo real enquanto digita (sem o 55, so DDD+numero). */
export function maskBRPhoneInput(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
