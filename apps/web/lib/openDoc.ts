/**
 * Abre um documento privado (KYC, comprovante, etc.) numa nova aba via fetch
 * AUTENTICADO (credentials) → blob → iframe. Resolve o "about:blank" que
 * acontecia ao apontar direto pra URL da API (cookie não ia) e ao navegar a
 * janela pré-aberta pra um blob de PDF.
 *
 * Pré-abre a janela no clique (gesto do usuário) pra não ser bloqueada por
 * popup; depois injeta um <iframe> com o blob — funciona pra PDF e imagem.
 */
export async function openDocBlob(url: string): Promise<void> {
  const w = window.open("", "_blank");
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      w?.close();
      alert("Não foi possível abrir o documento.");
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    if (w && !w.closed) {
      w.document.open();
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Documento</title></head>` +
          `<body style="margin:0;background:#111">` +
          `<iframe src="${objUrl}" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>` +
          `</body></html>`,
      );
      w.document.close();
    } else {
      window.open(objUrl, "_blank");
    }
    // libera o objeto depois de um tempo (a aba já carregou)
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  } catch {
    w?.close();
    alert("Erro ao abrir o documento.");
  }
}
