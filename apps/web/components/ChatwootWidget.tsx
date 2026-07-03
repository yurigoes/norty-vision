"use client";

/**
 * Embed do widget de chat do Chatwoot na area autenticada.
 *
 * Renderiza um script tag inline que carrega o SDK do Chatwoot e
 * identifica o user atual via `chatwootSDK.setUser`.
 *
 * Como funciona:
 *  - props: baseUrl do Chatwoot + websiteToken (Inbox API channel)
 *  - O websiteToken vem da configuracao da Inbox de tipo "API" no
 *    Chatwoot. Master cadastra em platform_integrations.config.
 *  - User identification e opcional - permite ver historico de
 *    conversas anteriores quando o mesmo user aciona o widget em
 *    diferentes browsers.
 */
interface Props {
  baseUrl: string;
  websiteToken: string;
  user?: {
    identifier?: string;
    email?: string;
    name?: string;
  };
}

export function ChatwootWidget({ baseUrl, websiteToken, user }: Props) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const loader = `
(function(d,t) {
  var BASE_URL="${cleanBase}";
  var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
  g.src=BASE_URL+"/packs/js/sdk.js";
  g.defer=true;
  g.async=true;
  s.parentNode.insertBefore(g,s);
  g.onload=function() {
    if (!window.chatwootSDK) return;
    window.chatwootSDK.run({
      websiteToken: ${JSON.stringify(websiteToken)},
      baseUrl: BASE_URL
    });
    ${
      user
        ? `
    window.addEventListener("chatwoot:ready", function() {
      window.$chatwoot.setUser(${JSON.stringify(user.identifier ?? user.email ?? "")}, {
        email: ${JSON.stringify(user.email ?? "")},
        name: ${JSON.stringify(user.name ?? "")}
      });
    });`
        : ""
    }
  };
})(document,"script");`;

  return <script dangerouslySetInnerHTML={{ __html: loader }} />;
}
