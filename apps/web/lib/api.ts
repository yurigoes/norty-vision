import { cookies } from "next/headers";

/**
 * Helper pra fazer fetch interno do RSC com os cookies da request.
 * Usa rede docker (API_INTERNAL_URL) quando disponivel.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";

  try {
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        cookie: cookieHeader,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
