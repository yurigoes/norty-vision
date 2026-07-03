import Link from "next/link";
import { apiFetch } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function AjudaArtigo({ params }: PageProps) {
  const { slug } = await params;
  const { data } = await apiFetch<{ article: any }>(
    `/api/support/help/${slug}`,
  );
  const article = data?.article;

  if (!article) {
    return (
      <div className="max-w-3xl">
        <Link href="/app/suporte/ajuda" className="text-sm text-brand hover:underline">
          ← voltar
        </Link>
        <p className="card mt-8 text-muted">
          Artigo não encontrado.
        </p>
      </div>
    );
  }

  return (
    <article className="max-w-3xl">
      <Link href="/app/suporte/ajuda" className="text-sm text-brand hover:underline">
        ← Ajuda
      </Link>
      <header className="mt-4 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {article.category}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{article.title}</h1>
        {article.summary && (
          <p className="mt-2 text-muted">{article.summary}</p>
        )}
      </header>
      <MarkdownBody body={article.body_markdown ?? ""} />
    </article>
  );
}

// renderizador markdown simples (sem dependência externa por enquanto)
function MarkdownBody({ body }: { body: string }) {
  const html = naiveMarkdownToHtml(body);
  return (
    <div
      className="prose-yugo"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function naiveMarkdownToHtml(md: string): string {
  // converter ultra-simples; troca por marked/remark depois
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre class="code">${codeBuf.join("\n")}</pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      out.push(`<h1>${line.slice(2)}</h1>`);
    } else if (line.startsWith("## ")) {
      flushList();
      out.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith("### ")) {
      flushList();
      out.push(`<h3>${line.slice(4)}</h3>`);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${formatInline(line.slice(2))}</li>`);
    } else if (line.match(/^\d+\.\s/)) {
      flushList();
      out.push(`<p>${formatInline(line)}</p>`);
    } else if (line.trim() === "") {
      flushList();
      out.push("");
    } else {
      flushList();
      out.push(`<p>${formatInline(line)}</p>`);
    }
  }
  flushList();
  return out.join("\n");
}

function formatInline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
