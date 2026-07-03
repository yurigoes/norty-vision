/**
 * Normaliza um número brasileiro para envio no WhatsApp (Evolution):
 *  - garante o país 55 (adiciona se faltar; mantém se já tiver);
 *  - garante o 9º dígito em celulares (adiciona quando o número de 8 dígitos
 *    começa com 6–9 e está sem o 9; mantém quando já tem; não mexe em fixo).
 * Devolve só dígitos (ex.: 5575999998888). Best-effort: se vier muito curto/
 * estranho, devolve o que dá pra aproveitar.
 */
export function normalizeWhatsappBR(raw?: string | null): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^0+/, ""); // tira zeros à esquerda (ex.: 0 + DDD)
  if (d.startsWith("55")) return "55" + fix9th(d.slice(2));
  if (d.length === 10 || d.length === 11) return "55" + fix9th(d); // DDD + número, sem país
  return d; // já internacional ou incompleto — mantém
}

/** rest = DDD(2) + número (8 = fixo/celular-sem-9; 9 = celular). */
function fix9th(rest: string): string {
  if (rest.length < 10) return rest; // incompleto, não arrisca
  const ddd = rest.slice(0, 2);
  let num = rest.slice(2);
  // celular sem o 9: 8 dígitos começando em 6,7,8,9 → adiciona o 9
  if (num.length === 8 && /^[6-9]/.test(num)) num = "9" + num;
  return ddd + num;
}
