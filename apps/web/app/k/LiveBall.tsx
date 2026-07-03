"use client";

import { useEffect, useState } from "react";

/**
 * Indicador "ao vivo" dos painéis de TV: um ícone (SVG limpo) que dá uma volta a
 * cada atualização dos dados (prop `tick` muda) — mostra que o painel está online.
 * variant: "ball" (futebol, p/ gráfica/sports) ou "glasses" (óculos, p/ ótica).
 * Tamanho de elemento de cabeçalho, no mesmo padrão visual do sistema.
 */
export function LiveBall({ tick, size = 44, variant = "ball" }: { tick: number; size?: number; variant?: "ball" | "glasses" }) {
  const [deg, setDeg] = useState(0);
  useEffect(() => { setDeg((d) => d + 360); }, [tick]);
  return (
    <div className="flex items-center gap-2" title="Painel online — gira a cada atualização">
      <svg
        width={size} height={size} viewBox="0 0 100 100" aria-hidden
        style={{ transition: "transform 1s cubic-bezier(.34,1.4,.64,1)", transform: `rotate(${deg}deg)` }}
      >
        {variant === "glasses" ? (
          <g fill="none" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
            {/* lentes */}
            <circle cx="28" cy="54" r="18" fill="#0ea5e9" fillOpacity="0.18" />
            <circle cx="72" cy="54" r="18" fill="#0ea5e9" fillOpacity="0.18" />
            {/* ponte */}
            <path d="M46 50 q4 -6 8 0" />
            {/* hastes */}
            <path d="M10 48 L2 40" />
            <path d="M90 48 L98 40" />
          </g>
        ) : (
          <>
            <defs><clipPath id="liveball-clip"><circle cx="50" cy="50" r="46" /></clipPath></defs>
            <circle cx="50" cy="50" r="46" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
            <g clipPath="url(#liveball-clip)" fill="#0f172a">
              <polygon points="50,37 62.4,46 57.6,60.5 42.4,60.5 37.6,46" />
              <polygon points="50,2 57,8 54,17 46,17 43,8" />
              <polygon points="92,28 99,33 97,42 89,42 86,34" />
              <polygon points="77,80 84,85 82,94 73,94 71,85" />
              <polygon points="23,80 29,85 27,94 18,94 16,85" />
              <polygon points="8,28 15,34 12,42 4,42 1,33" />
            </g>
            <g clipPath="url(#liveball-clip)" stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
              <line x1="50" y1="37" x2="50" y2="8" />
              <line x1="62.4" y1="46" x2="91" y2="35" />
              <line x1="57.6" y1="60.5" x2="77" y2="86" />
              <line x1="42.4" y1="60.5" x2="23" y2="86" />
              <line x1="37.6" y1="46" x2="7" y2="35" />
            </g>
          </>
        )}
      </svg>
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-green-400">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
        ao vivo
      </span>
    </div>
  );
}
