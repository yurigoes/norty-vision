"use server";

import { getSession } from "../../../../lib/session";
import { RUNBOOK, type Section } from "./content";

export interface UnlockState {
  ok: boolean;
  error?: string;
  content?: Section[];
}

/**
 * Libera o runbook só pra master e só com a senha correta (RUNBOOK_PASSWORD).
 * O conteúdo só sai do servidor depois da validação — não vai no payload inicial.
 */
export async function unlockRunbook(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const session = await getSession();
  if (!session.master) return { ok: false, error: "Acesso restrito ao master." };

  const pw = String(formData.get("password") ?? "");
  const expected = process.env.RUNBOOK_PASSWORD ?? "";
  if (!expected) {
    return { ok: false, error: "RUNBOOK_PASSWORD não configurado no servidor (.env.production)." };
  }
  if (pw.length === 0 || pw !== expected) {
    return { ok: false, error: "Senha incorreta." };
  }
  return { ok: true, content: RUNBOOK };
}
