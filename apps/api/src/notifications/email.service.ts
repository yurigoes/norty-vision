import { Injectable } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";
import { loadEnv } from "../config";
import { PrismaService } from "../prisma/prisma.service";

export interface ResolvedSmtp {
  transporter: Transporter;
  from: string;
  replyTo?: string;
  source: "org" | "master";
}

@Injectable()
export class EmailService {
  constructor(private readonly prisma: PrismaService) {}

  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const env = loadEnv();
    if (!env.SMTP_HOST) {
      throw new Error("SMTP_HOST nao configurado - emails desabilitados");
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" }
        : undefined,
    });
    return this.transporter;
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    const env = loadEnv();
    const t = this.getTransporter();
    await t.sendMail({
      from: env.SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  }

  /**
   * Resolve o SMTP de uma org: usa o SMTP proprio da empresa se habilitado
   * e configurado; senao cai pro SMTP do master, mas sempre enviando em nome
   * da empresa (from_name) com reply-to da empresa.
   */
  async resolveSmtp(organizationId: string): Promise<ResolvedSmtp> {
    const env = loadEnv();
    const cfg = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organizationSmtpSettings.findUnique({ where: { organizationId } }),
    );
    const fromName = cfg?.fromName?.trim();

    // SMTP proprio da empresa: usa quando há host configurado e não foi
    // explicitamente desabilitado (enabled !== false). Antes exigia enabled===true,
    // o que fazia o email "cadastrado" cair no master (vazio) e falhar.
    if (cfg?.host && cfg.enabled !== false) {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: cfg.secure ?? false,
        auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
      });
      const fromEmail = cfg.fromEmail || cfg.username || env.SMTP_FROM;
      return {
        transporter,
        from: fromName ? `"${fromName}" <${fromEmail}>` : String(fromEmail),
        replyTo: cfg.replyTo || cfg.fromEmail || undefined,
        source: "org",
      };
    }

    // fallback: SMTP do master, mas em nome da empresa
    const masterFrom = env.SMTP_FROM ?? env.SMTP_USER ?? "no-reply@yugochat.com.br";
    return {
      transporter: this.getTransporter(),
      from: fromName ? `"${fromName}" <${masterFrom}>` : String(masterFrom),
      replyTo: cfg?.replyTo || cfg?.fromEmail || undefined,
      source: "master",
    };
  }

  /** Envia em nome de uma org (SMTP proprio ou fallback master). */
  async sendForOrg(
    organizationId: string,
    opts: { to: string; subject: string; html: string; text?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] },
  ): Promise<{ source: "org" | "master" }> {
    const smtp = await this.resolveSmtp(organizationId);
    await smtp.transporter.sendMail({
      from: smtp.from,
      replyTo: smtp.replyTo,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    return { source: smtp.source };
  }

  async sendPasswordReset(opts: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<void> {
    const minutes = 30;
    const html = `<!doctype html>
<html lang="pt-BR">
<body style="font-family:sans-serif;background:#0a0a0b;color:#f4f4f5;padding:24px">
  <div style="max-width:540px;margin:0 auto;background:#15151a;border-radius:12px;padding:32px">
    <h1 style="color:#60a5fa;font-size:24px;margin:0 0 16px">Redefinir senha</h1>
    <p>Olá, ${escapeHtml(opts.name)}.</p>
    <p>Você (ou alguém) pediu para redefinir a senha do seu acesso ao yugochat.</p>
    <p style="margin:24px 0">
      <a href="${opts.resetUrl}" style="display:inline-block;background:#60a5fa;color:#0a0a0b;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Definir nova senha</a>
    </p>
    <p style="color:#8a8a92;font-size:13px">
      Este link expira em ${minutes} minutos. Se não foi você, ignore — sua senha continua a mesma.
    </p>
    <p style="color:#8a8a92;font-size:13px">
      Link direto: <span style="word-break:break-all">${opts.resetUrl}</span>
    </p>
  </div>
</body>
</html>`;
    await this.send({
      to: opts.to,
      subject: "yugochat — redefinir senha",
      html,
      text: `Para redefinir sua senha, acesse: ${opts.resetUrl} (valido por ${minutes} minutos)`,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
