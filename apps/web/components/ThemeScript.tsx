/**
 * Script inline injetado no <head> ANTES de qualquer outro JS.
 * Aplica 'light'/'dark' no <html> imediatamente, evitando flash.
 *
 * Padrão = CLARO. O escuro é opcional: só entra se o usuário escolher pelo
 * toggle (grava 'yugo-theme' no localStorage). Não seguimos mais o
 * prefers-color-scheme do SO pra não forçar escuro sem o usuário pedir.
 */
export function ThemeScript() {
  // default por build: yugo = light; Central de Leads builda com
  // NEXT_PUBLIC_DEFAULT_THEME=dark. O toggle do usuário (localStorage) sempre vence.
  const def =
    process.env.NEXT_PUBLIC_DEFAULT_THEME === "dark" ? "dark" : "light";
  const raw = `
(function() {
  try {
    var stored = localStorage.getItem('yugo-theme');
    var theme = (stored === 'light' || stored === 'dark') ? stored : '${def}';
    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('${def}');
  }
})();`;
  return <script dangerouslySetInnerHTML={{ __html: raw }} />;
}
