// ============================================================================
// Conferência: os scripts que mexem na produção conferem EM QUAL MÁQUINA estão.
//
// Rodar: node --experimental-strip-types src/__checks__/maquina.check.mts
//
// A produção do Norty Vision roda na **tyr**. A **thor** é o FAILOVER da tyr.
// E os três scripts se chamam `*-nv-thor.sh` — todo nome aponta para a máquina
// de reserva.
//
// Por que isso não se resolve sozinho: um failover é, por desenho, parecido com
// o original. `pct` existe, o CT 105 existe, o bind-mount `/opt/fase3` existe,
// o `shared-postgres` responde. TODAS as conferências que esses scripts já
// fazem passariam na reserva. Só o NOME distingue — e aplicar migration ou
// subir código na reserva é mexer numa cópia achando que subiu.
//
// Daí a `lib-maquina.sh`, e daí esta conferência: a guarda some de um script
// com um `git revert` distraído, e nada reclamaria.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const infra = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "infra", "scripts");
const falhas: string[] = [];

// em shell, comentário é `#` até o fim da linha. A guarda citada num
// comentário explicativo não protege ninguém — e esta base já caiu nessa
// quatro vezes.
const semComentario = (s: string) => s.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l)).join("\n");

const lib = "lib-maquina.sh";
let libSrc = "";
try {
  libSrc = readFileSync(join(infra, lib), "utf8");
} catch {
  falhas.push(`${lib} não existe — sem ela os três scripts rodam em qualquer máquina sem reclamar`);
}

if (libSrc) {
  const corpo = semComentario(libSrc);
  if (!/MAQUINA_PRODUCAO="\$\{MAQUINA_PRODUCAO:-tyr\}"/.test(corpo)) {
    falhas.push(`${lib} não define mais a produção como \`tyr\` (nem deixa trocar por MAQUINA_PRODUCAO)`);
  }
  if (!/hostname -s/.test(corpo)) {
    falhas.push(`${lib} não lê mais o nome da máquina — a guarda virou enfeite`);
  }
  if (!/\bexit 1\b/.test(corpo)) {
    falhas.push(`${lib} não interrompe mais na máquina errada: avisar e seguir é o mesmo que não conferir`);
  }
}

// os três que mexem na produção: migration, deploy e o que ZERA dados
for (const script of ["db-apply-nv-thor.sh", "deploy-nv-thor.sh", "zerar-empresa-nv-thor.sh"] as const) {
  let s = "";
  try {
    s = semComentario(readFileSync(join(infra, script), "utf8"));
  } catch {
    falhas.push(`${script} não existe mais — se foi renomeado, atualize esta conferência junto`);
    continue;
  }
  if (!s.includes(lib)) {
    falhas.push(`${script} não carrega a \`${lib}\` — roda na thor (o failover) sem avisar que não é a produção`);
    continue;
  }
  if (!/confere_maquina/.test(s)) {
    falhas.push(`${script} carrega a \`${lib}\` mas nunca chama \`confere_maquina\` — a guarda não roda`);
  }
}

console.log("máquina certa: a produção é a tyr, a thor é o failover — e os scripts conferem");
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("NENHUM SCRIPT DE PRODUCAO RODA NA MAQUINA ERRADA EM SILENCIO");
