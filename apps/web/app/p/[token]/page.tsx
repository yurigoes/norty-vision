"use client";

import { use, useEffect, useState } from "react";

interface PublicSurvey {
  token: string;
  kind: string;
  answered: boolean;
  sellerName: string | null;
  storeBrand: { name: string; primaryColor: string | null; logoUrl: string | null } | null;
}

export default function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [loading, setLoading] = useState(true);
  const [nps, setNps] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/surveys/public/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PublicSurvey | null) => {
        setSurvey(d);
        if (d?.answered) setDone(true);
        const hex = d?.storeBrand?.primaryColor;
        if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
          const int = parseInt(hex.slice(1), 16);
          document.documentElement.style.setProperty("--brand", `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const isAppointment = survey?.kind === "appointment";

  async function submit() {
    if (isAppointment) {
      if (rating == null) { setErr("Escolha de 1 a 5 estrelas."); return; }
    } else if (nps == null) {
      setErr("Escolha uma nota de 0 a 10."); return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/surveys/public/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isAppointment
            ? { sellerRating: rating, comment: comment.trim() || null }
            : { npsScore: nps, sellerRating: rating, comment: comment.trim() || null },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao enviar");
      setDone(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (loading) return <Centered>Carregando...</Centered>;
  if (!survey) return <Centered>Pesquisa não encontrada.</Centered>;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        {survey.storeBrand?.logoUrl ? (
          <img src={survey.storeBrand.logoUrl} alt="" className="mx-auto h-12 w-auto max-w-[180px] object-contain" />
        ) : (
          <h2 className="text-xl font-semibold text-brand">{survey.storeBrand?.name ?? "Pesquisa"}</h2>
        )}
      </div>

      {done ? (
        <div className="glass rounded-2xl border border-line p-8 text-center">
          <p className="text-4xl">🙏</p>
          <h1 className="mt-3 text-xl font-semibold">Obrigado pela resposta!</h1>
          <p className="mt-2 text-sm text-muted">Sua opinião nos ajuda a melhorar.</p>
        </div>
      ) : (
        <div className="glass space-y-6 rounded-2xl border border-line p-6">
          {isAppointment ? (
            <div>
              <h1 className="text-lg font-semibold">Como foi seu atendimento?</h1>
              <p className="mt-1 text-sm text-muted">Dê uma nota de 1 a 5 estrelas (1 = ruim, 5 = ótimo).</p>
              <div className="mt-4 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setRating(s)}
                    className={"text-4xl transition " + ((rating ?? 0) >= s ? "text-yellow-400" : "text-line hover:text-yellow-300")}
                    aria-label={`${s} estrelas`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div>
            <h1 className="text-lg font-semibold">Como foi sua experiência?</h1>
            <p className="mt-1 text-sm text-muted">
              De 0 a 10, o quanto você recomendaria a gente para um amigo?
            </p>
            <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-11">
              {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                <button
                  key={n}
                  onClick={() => setNps(n)}
                  className={
                    "aspect-square rounded-lg border text-sm font-medium transition " +
                    (nps === n
                      ? "border-brand bg-brand text-white"
                      : "border-line hover:border-brand")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>Não recomendaria</span>
              <span>Recomendaria muito</span>
            </div>
          </div>
          )}

          {!isAppointment && survey.sellerName && (
            <div>
              <p className="text-sm">Como você avalia o atendimento de <strong>{survey.sellerName}</strong>?</p>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setRating(s)}
                    className={"text-2xl transition " + ((rating ?? 0) >= s ? "text-yellow-400" : "text-line hover:text-yellow-300")}
                    aria-label={`${s} estrelas`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Comentário (opcional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Conte o que achou..."
              className="input-base"
            />
          </div>

          {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="btn-grad w-full py-2.5 text-sm"
          >
            {busy ? "Enviando..." : "Enviar avaliação"}
          </button>
        </div>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">{children}</div>;
}
