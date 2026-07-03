"use client";

import { useEffect, useState } from "react";

/**
 * Banner promocional flutuante da loja. Aparece ao carregar a página (com um
 * pequeno atraso pra não competir com a primeira pintura) e pode ser fechado.
 * Lembra o fechamento por algumas horas via localStorage pra não incomodar.
 */
export function VitrinePromoBanner({
  imageUrl,
  linkUrl,
  storageKey,
}: {
  imageUrl: string;
  linkUrl: string | null;
  storageKey: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const until = Number(localStorage.getItem(storageKey) ?? 0);
      if (Date.now() < until) return;
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [storageKey]);

  function close() {
    setOpen(false);
    try {
      // não mostra de novo por 8 horas
      localStorage.setItem(storageKey, String(Date.now() + 8 * 3600_000));
    } catch {
      /* ignore */
    }
  }

  if (!open) return null;

  const Img = (
    <img src={imageUrl} alt="Promoção" className="block max-h-[70vh] w-full rounded-xl object-contain" />
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={close}
          aria-label="Fechar"
          className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold text-black shadow-lg transition hover:scale-105"
        >
          ×
        </button>
        {linkUrl ? (
          <a href={linkUrl} target="_blank" rel="noreferrer" className="block">
            {Img}
          </a>
        ) : (
          Img
        )}
      </div>
    </div>
  );
}
