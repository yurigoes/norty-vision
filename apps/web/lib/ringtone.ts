// Toque "Yugo" — exclusivo, minimalista, sintetizado via Web Audio (sem arquivo).
// Motivo de 2 notas (sol-mi, terça menor descendente) + harmônico suave; loop a
// cada ~2.4s. Curto, claro, agradável; volume moderado pra não assustar.
//
// Uso:
//   const stop = playYugoRing();   // começa a tocar (idempotente)
//   stop();                        // para
//
// Importante: o navegador exige interação do usuário antes do 1º áudio. Como a
// chamada entrante é precedida por interação no app (ou click na notificação),
// chamar daí funciona. Se o AudioContext sair "suspended", a função tenta
// resume() automaticamente.

let ctx: AudioContext | null = null;
let timer: any = null;
let active = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const A = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!A) return null;
  if (!ctx) ctx = new A();
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

// Toca uma nota com envelope ADSR-leve (ataque/decay suaves → som "polido").
function blip(c: AudioContext, when: number, freq: number, dur: number, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, when);
  // 2º oscilador (oitava acima, baixo nível) dá "brilho" sem ficar agudo
  const osc2 = c.createOscillator();
  const gain2 = c.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(freq * 2, when);
  gain2.gain.setValueAtTime(0, when);
  gain2.gain.linearRampToValueAtTime(peak * 0.18, when + 0.02);
  gain2.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  osc.connect(gain).connect(c.destination);
  osc2.connect(gain2).connect(c.destination);
  osc.start(when); osc.stop(when + dur + 0.02);
  osc2.start(when); osc2.stop(when + dur + 0.02);
}

function scheduleRing(c: AudioContext, t0: number) {
  // motivo Yugo: G5 → E5 (terça menor descendente), com "respiro" no final
  const G5 = 783.99;
  const E5 = 659.25;
  blip(c, t0,        G5, 0.32, 0.22);
  blip(c, t0 + 0.36, E5, 0.42, 0.22);
}

/** Começa a tocar o ringtone em loop. Retorna fn pra parar. Idempotente. */
export function playYugoRing(): () => void {
  if (active) return stopYugoRing;
  const c = getCtx();
  if (!c) return () => undefined;
  active = true;
  const loop = () => {
    if (!active || !ctx) return;
    scheduleRing(ctx, ctx.currentTime + 0.02);
  };
  loop();
  timer = setInterval(loop, 2400); // intervalo entre toques
  return stopYugoRing;
}

/** Para o ringtone. */
export function stopYugoRing(): void {
  active = false;
  if (timer) { clearInterval(timer); timer = null; }
}
