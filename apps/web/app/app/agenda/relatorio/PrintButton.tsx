"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="btn-grad"
    >
      🖨️ Imprimir / Salvar PDF
    </button>
  );
}
