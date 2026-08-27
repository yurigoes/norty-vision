/**
 * NOME DO PRODUTO
 * ============================================================================
 * O sistema é white-label: o nome, a logo e as cores vêm de `platform_settings`
 * e o master edita em Identidade & Branding (`getPublicSettings()`).
 *
 * Esta constante é o que aparece quando essa configuração ainda não existe —
 * ou onde não dá pra buscá-la (componente de cliente, `metadata` estático).
 * Antes cada lugar desses trazia o nome do produto anterior cravado, e o mesmo
 * sistema se apresentava com três nomes diferentes dependendo da tela.
 *
 * Vale para o build inteiro: `NEXT_PUBLIC_PRODUCT_NAME` sobrescreve.
 */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || "Norty Vision";

/** Domínio principal — mesma lógica: env manda, senão o do Vision. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "vision.norty.com.br";
