"use client";

import { useEffect, useState } from "react";

/**
 * Entrada de marca da Central de Leads (exibida ao abrir uma sessão do produto).
 * A linha desenha o C → desenha o L (com gap 3D sobreposto ao C) → a ponta de
 * baixo do C encontra a perna do L → acende a ponta verde → as reticências dão
 * pop (verde perto do L → cinza) → o nome surge → some revelando o app.
 *
 * Recriação vetorial da logo (não usa o PNG), pra poder animar os elementos.
 * Auto-dispensa em ~2,9s (ou instantâneo com prefers-reduced-motion).
 */
export function CentralLeadsBoot({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduce ? 200 : 2900;
    const t1 = setTimeout(() => setPhase("out"), hold);
    const t2 = setTimeout(() => {
      setPhase("gone");
      onDone?.();
    }, hold + 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  if (phase === "gone") return null;

  return (
    <div aria-hidden="true" className={`clb-stage${phase === "out" ? " clb-out" : ""}`}>
      <div className="clb-aura" />

      <svg className="clb-mark" viewBox="0 0 200 160" fill="none" aria-label="Central de Leads">
        {/* C: arco aberto à direita; a ponta de baixo encontra a perna do L */}
        <path
          className="clb-draw"
          style={{ ["--d" as string]: ".15s" }}
          pathLength={1}
          d="M111.4 37.9 A52 52 0 1 0 100 119"
          stroke="#F3F6F5"
          strokeWidth={17}
          strokeLinecap="round"
          fill="none"
        />
        {/* L com efeito 3D: halo escuro (gap) sob o branco, sobreposto ao C */}
        <path
          className="clb-draw"
          style={{ ["--d" as string]: ".92s" }}
          pathLength={1}
          d="M66 34 L66 118 L112 118"
          stroke="#0A0E0B"
          strokeWidth={25}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          className="clb-draw"
          style={{ ["--d" as string]: ".95s" }}
          pathLength={1}
          d="M66 34 L66 118 L112 118"
          stroke="#F3F6F5"
          strokeWidth={16}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* ponta verde: fim da perna do L */}
        <rect className="clb-pop clb-glow" style={{ ["--d" as string]: "1.5s" }} x={103} y={110} width={20} height={17} rx={7} fill="#9FE640" />
        {/* reticências saindo da boca: verde (perto do L) → cinza */}
        <circle className="clb-pop clb-glow" style={{ ["--d" as string]: "1.6s" }} cx={92} cy={80} r={5.5} fill="#9FE640" />
        <circle className="clb-pop" style={{ ["--d" as string]: "1.72s" }} cx={110} cy={80} r={5.5} fill="#7E8A66" />
        <circle className="clb-pop" style={{ ["--d" as string]: "1.84s" }} cx={128} cy={80} r={5.5} fill="#49543B" />
      </svg>

      <div className="clb-word">
        {/* nome estático = recorte da logo original (fonte idêntica). Só o CL anima. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cl-nome.png" alt="Central de Leads" />
      </div>

      <style jsx>{`
        .clb-stage {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 50% 46%, #0d130f 0%, #050706 74%);
        }
        .clb-aura {
          position: absolute;
          width: 560px;
          height: 560px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(159, 230, 64, 0.16), rgba(159, 230, 64, 0) 60%);
          filter: blur(22px);
          animation: clb-aura-drift 6s ease-in-out infinite;
        }
        .clb-mark {
          width: 210px;
          max-width: 64vw;
          height: auto;
          overflow: visible;
        }
        .clb-draw {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          animation: clb-draw 0.72s cubic-bezier(0.65, 0, 0.35, 1) var(--d) forwards;
        }
        .clb-pop {
          transform-box: fill-box;
          transform-origin: center;
          transform: scale(0);
          opacity: 0;
          animation: clb-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) var(--d) both;
        }
        .clb-glow {
          filter: drop-shadow(0 0 6px rgba(159, 230, 64, 0.65));
        }
        .clb-word {
          margin-top: 18px;
          opacity: 0;
          animation: clb-word-in 0.7s ease 2.05s both;
        }
        .clb-word img {
          width: 330px;
          max-width: 80vw;
          height: auto;
          display: block;
        }
        @keyframes clb-draw {
          to {
            stroke-dashoffset: 0;
          }
        }
        @keyframes clb-pop {
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes clb-aura-drift {
          0%,
          100% {
            transform: translate(-22px, -12px) scale(1);
          }
          50% {
            transform: translate(22px, 14px) scale(1.08);
          }
        }
        @keyframes clb-word-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        .clb-out {
          animation: clb-stage-out 0.6s ease forwards;
        }
        @keyframes clb-stage-out {
          to {
            opacity: 0;
            transform: scale(1.04);
            visibility: hidden;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .clb-draw {
            stroke-dashoffset: 0;
            animation: none;
          }
          .clb-pop {
            transform: none;
            opacity: 1;
            animation: none;
          }
          .clb-word,
          .clb-tag {
            opacity: 1;
            animation: none;
          }
          .clb-aura {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
