/**
 * O PORTEIRO DA ROTA
 * ============================================================================
 * O menu já sabia esconder o que a empresa não contratou — plano sem o módulo,
 * nicho que não usa, sub-módulo desligado pelo master, permissão que a pessoa
 * não tem. Mas esconder não é barrar: `/app/producao/costureiras` continuava
 * abrindo pela URL, com a tela inteira funcionando. Quem tinha o link salvo
 * seguia usando um sub-módulo que a empresa não contratou.
 *
 * Aqui a MESMA conta que monta o menu decide se a rota pode abrir. Mesma
 * tabela (`nav.ts`), mesmos quatro filtros, uma implementação só — senão
 * menu e porteiro divergem na primeira tela nova.
 *
 * Isto é o porteiro da TELA. Os dados continuam protegidos pelo RLS e pelas
 * permissões na API, que é onde o isolamento de verdade mora.
 *
 * A tabela de telas entra por parâmetro em vez de ser importada aqui: assim
 * esta peça é pura (dá pra conferir sem subir o Next) e quem chama declara,
 * na cara, que está usando a MESMA lista do menu.
 */

/** o mínimo que o porteiro precisa saber de uma tela — o `NavItem` do menu */
export interface TelaDoMenu {
  key?: string;
  href: string;
  label: string;
  perm?: string;
  subMod?: string;
}
export type MotivoBloqueio = "plano" | "nicho" | "submodulo" | "permissao";

export interface Bloqueio {
  motivo: MotivoBloqueio;
  /** o módulo da rota, quando existe ("producao", "crediario") */
  moduleKey?: string;
  /** o sub-módulo desligado, quando o motivo é esse ("producao.costureiras") */
  subMod?: string;
  /** a permissão que faltou, quando o motivo é esse */
  perm?: string;
  /** o item do menu que corresponde à rota */
  label: string;
}

export interface ContextoDeAcesso {
  /** a MESMA lista que monta o menu (NAV_OPERACAO + NAV_ADMIN) */
  telas: TelaDoMenu[];
  /** null = plano sem restrição: tudo liberado */
  enabledModules: string[] | null;
  /** null = o banco ainda não respondeu; o chamador decide o fallback */
  nicheHidden: string[] | null;
  submoduleFeatures: Record<string, boolean>;
  /** já resolvido pelo chamador (org admin e master entram como "pode tudo") */
  temPermissao: (perm: string) => boolean;
  /** o nicho, pro fallback quando `nicheHidden` é null */
  nichoPermite: (moduleKey: string) => boolean;
}

/**
 * Qual item do menu responde por este caminho.
 *
 * Casa por PREFIXO e fica com o mais específico: `/app/crediario/abc-123` é
 * a tela de uma conta do Crediário, e tem que ser barrada junto com ele. E
 * `/app/producao/costureiras` casa com o item das costureiras (sub-módulo),
 * não com o `/app/producao` que vem antes na lista.
 */
export function itemDaRota(caminho: string, telas: TelaDoMenu[]): TelaDoMenu | null {
  const limpo = (caminho.split("?")[0] ?? "").replace(/\/+$/, "") || "/app";
  let melhor: TelaDoMenu | null = null;
  for (const it of telas) {
    const href = it.href.replace(/\/+$/, "");
    if (limpo === href || limpo.startsWith(href + "/")) {
      if (!melhor || href.length > melhor.href.replace(/\/+$/, "").length) melhor = it;
    }
  }
  return melhor;
}

/**
 * A rota pode abrir? `null` = pode.
 *
 * A ordem dos motivos importa pro que o usuário vê: quem não tem o módulo no
 * plano recebe a página que VENDE o módulo; os outros três motivos são
 * decisões de quem administra, e viram explicação.
 */
export function bloqueioDaRota(caminho: string, ctx: ContextoDeAcesso): Bloqueio | null {
  const it = itemDaRota(caminho, ctx.telas);
  // rota fora do menu (/app, /app/conta, /app/modulos/...) — o menu não gate,
  // o porteiro também não. São telas de casca, conta e suporte.
  if (!it) return null;

  if (it.key && ctx.enabledModules !== null && !ctx.enabledModules.includes(it.key)) {
    return { motivo: "plano", moduleKey: it.key, label: it.label };
  }
  if (it.key) {
    const escondidoPeloNicho = ctx.nicheHidden !== null
      ? ctx.nicheHidden.includes(it.key)
      : !ctx.nichoPermite(it.key);
    if (escondidoPeloNicho) return { motivo: "nicho", moduleKey: it.key, label: it.label };
  }
  if (it.subMod && ctx.submoduleFeatures[it.subMod] === false) {
    return { motivo: "submodulo", moduleKey: it.key, subMod: it.subMod, label: it.label };
  }
  if (it.perm && !ctx.temPermissao(it.perm)) {
    return { motivo: "permissao", moduleKey: it.key, perm: it.perm, label: it.label };
  }
  return null;
}

/** o texto que o usuário lê, por motivo */
export function explicacao(b: Bloqueio): { titulo: string; texto: string } {
  switch (b.motivo) {
    case "nicho":
      return {
        titulo: `${b.label} não faz parte do seu ramo`,
        texto: "Esta tela é de outro tipo de negócio e não aparece no seu painel. Se você precisa dela, fale com o suporte.",
      };
    case "submodulo":
      return {
        titulo: `${b.label} está desligado para a sua empresa`,
        texto: "Quem administra o sistema desligou este recurso. Fale com o administrador da sua empresa ou com o suporte para religar.",
      };
    case "permissao":
      return {
        titulo: `Você não tem acesso a ${b.label}`,
        texto: "Seu perfil não inclui esta tela. Quem administra a empresa pode liberar em Usuários & papéis.",
      };
    default:
      return { titulo: b.label, texto: "" };
  }
}
