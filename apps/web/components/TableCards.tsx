"use client";

import { useEffect } from "react";

/**
 * TABELA QUE VIRA CARTÃO NO CELULAR
 * ============================================================================
 * As 34 telas com tabela rolavam na horizontal no telefone: pra ler a última
 * coluna a pessoa arrastava, perdia de vista a primeira, e voltava. Abaixo de
 * 768px cada linha passa a ser um cartão empilhado (o CSS está em
 * `globals.css`, em `.table-cards`).
 *
 * O CSS precisa do nome da coluna em cada célula, e é isso que este
 * componente escreve: lê o `<thead>` e copia o rótulo pro `data-label` de cada
 * `<td>`, usando o `cellIndex` do próprio DOM.
 *
 * Por que no DOM e não no JSX: seriam centenas de células editadas à mão em 34
 * arquivos — e ainda daria errado nas tabelas com célula condicional, onde a
 * posição real da coluna só existe em tempo de execução. O `cellIndex` já sabe.
 *
 * Um `MutationObserver` refaz o trabalho quando as linhas mudam (filtro,
 * paginação, recarga). Ele observa só `childList`; escrever atributo não
 * dispara o observador, então não há laço.
 *
 * Progressivo: sem JS a tabela segue tabela, rolando como antes.
 */
export function TableCards() {
  useEffect(() => {
    function sync() {
      document.querySelectorAll<HTMLTableElement>("table.table-cards").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
          (th.textContent ?? "").trim(),
        );
        if (headers.length === 0) return;

        table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
          Array.from(row.cells).forEach((cell) => {
            // célula que atravessa colunas (totais, "nenhum resultado") não tem
            // um nome de coluna só — fica sem rótulo, ocupando a linha inteira
            const label = cell.colSpan > 1 ? "" : headers[cell.cellIndex] ?? "";
            if (label) cell.setAttribute("data-label", label);
            else cell.removeAttribute("data-label");
          });
        });
      });
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
