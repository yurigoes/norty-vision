/** Documentos que a empresa costuma pedir na admissão (CLT brasileiro). */
export interface CltDoc { key: string; label: string }

export const CLT_DOCS: CltDoc[] = [
  { key: "rg", label: "RG (identidade)" },
  { key: "cpf", label: "CPF" },
  { key: "ctps", label: "Carteira de Trabalho (CTPS)" },
  { key: "pis", label: "PIS/PASEP/NIT" },
  { key: "titulo_eleitor", label: "Título de eleitor" },
  { key: "reservista", label: "Certificado de reservista" },
  { key: "comprovante_residencia", label: "Comprovante de residência" },
  { key: "foto", label: "Foto 3x4" },
  { key: "cnh", label: "CNH (se aplicável)" },
  { key: "certidao_nascimento", label: "Certidão de nascimento" },
  { key: "certidao_casamento", label: "Certidão de casamento" },
  { key: "comprovante_escolaridade", label: "Comprovante de escolaridade" },
  { key: "dependentes_cpf", label: "CPF dos dependentes" },
  { key: "filhos_certidao", label: "Certidão de nascimento dos filhos (<14)" },
  { key: "filhos_vacina", label: "Caderneta de vacinação dos filhos (<7)" },
  { key: "aso", label: "ASO admissional (atestado de saúde ocupacional)" },
  { key: "conta_bancaria", label: "Dados bancários / conta salário" },
  { key: "contrato", label: "Contrato de trabalho" },
  { key: "outro", label: "Outro" },
];

export function cltDocLabel(key: string): string {
  return CLT_DOCS.find((d) => d.key === key)?.label ?? key;
}
