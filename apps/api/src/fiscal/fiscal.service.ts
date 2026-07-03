import { Injectable } from "@nestjs/common";
import * as forge from "node-forge";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Fiscal F0 — fundação NFC-e (direto SEFAZ). Config do emitente + certificado A1 + CSC.
 * A emissão/assinatura/transmissão (F1) virá em cima desta config.
 *
 * Segredos (CSC, senha do A1) ficam cifrados (AES-256-GCM via COOKIE_SECRET); o .pfx
 * no bucket privado. Começa em ambiente=2 (homologação).
 */
@Injectable()
export class FiscalService {
  private readonly env = loadEnv();
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }

  private aesKey() { return createHash("sha256").update(`${this.env.COOKIE_SECRET}:fiscal`).digest(); }
  private enc(plain: string): string {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", this.aesKey(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); const tag = c.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }

  async getConfig(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    return {
      cnpj: c?.cnpj ?? "", ie: c?.ie ?? "", im: c?.im ?? "", razaoSocial: c?.razaoSocial ?? "", nomeFantasia: c?.nomeFantasia ?? "",
      crt: c?.crt ?? 1, uf: c?.uf ?? "", cmun: c?.cmun ?? "", municipio: c?.municipio ?? "",
      logradouro: c?.logradouro ?? "", numero: c?.numero ?? "", complemento: c?.complemento ?? "", bairro: c?.bairro ?? "", cep: c?.cep ?? "", fone: c?.fone ?? "",
      ambiente: c?.ambiente ?? 2, nfceSerie: c?.nfceSerie ?? 1, nfceNext: c?.nfceNext ?? 1,
      nfeSerie: c?.nfeSerie ?? 1, nfeNext: c?.nfeNext ?? 1,
      cscId: c?.cscId ?? "", cscSet: !!c?.cscTokenEnc,
      nfceUrlHom: c?.nfceUrlHom ?? "", nfceUrlProd: c?.nfceUrlProd ?? "",
      nfeUrlHom: c?.nfeUrlHom ?? "", nfeUrlProd: c?.nfeUrlProd ?? "",
      a1: { configured: !!c?.a1CertKey, subject: c?.a1Subject ?? null, notAfter: c?.a1NotAfter ?? null, expired: c?.a1NotAfter ? new Date(c.a1NotAfter) < new Date() : false },
    };
  }

  async updateConfig(ctx: RequestContext, input: any) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const d: any = {};
    const str = (k: string, max = 200) => { if (input[k] !== undefined) d[k] = (String(input[k] ?? "").trim().slice(0, max)) || null; };
    if (input.cnpj !== undefined) d.cnpj = this.digits(input.cnpj) || null;
    if (input.ie !== undefined) d.ie = this.digits(input.ie) || null;
    if (input.im !== undefined) d.im = this.digits(input.im) || null;
    str("razaoSocial"); str("nomeFantasia"); str("uf", 2); str("municipio"); str("logradouro"); str("numero", 20);
    str("complemento"); str("bairro"); str("cscId", 20);
    if (input.cmun !== undefined) d.cmun = this.digits(input.cmun) || null;
    if (input.cep !== undefined) d.cep = this.digits(input.cep) || null;
    if (input.fone !== undefined) d.fone = this.digits(input.fone) || null;
    if (input.crt !== undefined) d.crt = [1, 2, 3].includes(Number(input.crt)) ? Number(input.crt) : 1;
    if (input.ambiente !== undefined) d.ambiente = Number(input.ambiente) === 1 ? 1 : 2;
    if (input.nfceSerie !== undefined) d.nfceSerie = Math.max(1, Number(input.nfceSerie) || 1);
    if (input.nfceNext !== undefined) d.nfceNext = Math.max(1, Number(input.nfceNext) || 1);
    if (input.nfeSerie !== undefined) d.nfeSerie = Math.max(1, Number(input.nfeSerie) || 1);
    if (input.nfeNext !== undefined) d.nfeNext = Math.max(1, Number(input.nfeNext) || 1);
    if (input.cscToken !== undefined && input.cscToken !== "") d.cscTokenEnc = this.enc(String(input.cscToken));
    if (input.nfceUrlHom !== undefined) d.nfceUrlHom = (String(input.nfceUrlHom).trim().slice(0, 300)) || null;
    if (input.nfceUrlProd !== undefined) d.nfceUrlProd = (String(input.nfceUrlProd).trim().slice(0, 300)) || null;
    if (input.nfeUrlHom !== undefined) d.nfeUrlHom = (String(input.nfeUrlHom).trim().slice(0, 300)) || null;
    if (input.nfeUrlProd !== undefined) d.nfeUrlProd = (String(input.nfeUrlProd).trim().slice(0, 300)) || null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.upsert({ where: { organizationId: orgId }, update: d, create: { organizationId: orgId, ...d } }));
    return this.getConfig(ctx);
  }

  /** Sobe o certificado A1 (e-CNPJ .pfx) que assina os XMLs fiscais. */
  async uploadCert(ctx: RequestContext, pfxBase64: string, password: string) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const b64 = (pfxBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const pfx = Buffer.from(b64, "base64");
    if (!pfx.length || pfx.length > 200_000) throw new AppError(ErrorCode.ValidationFailed, "Arquivo do certificado inválido", 400);
    let cn = "Certificado"; let notAfter = new Date();
    try {
      const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), password ?? "");
      const CERTBAG = forge.pki.oids.certBag as string;
      const cert = (p12.getBags({ bagType: CERTBAG })[CERTBAG] ?? [])[0]?.cert;
      if (!cert) throw new Error("sem cert");
      cn = cert.subject.getField("CN")?.value ?? "Certificado"; notAfter = cert.validity.notAfter;
    } catch { throw new AppError(ErrorCode.ValidationFailed, "Não consegui abrir o certificado — senha incorreta ou arquivo inválido", 400); }
    const { key } = await this.storage.putPrivate({ keyPrefix: `fiscal/cert/${orgId}`, contentType: "application/x-pkcs12", body: pfx });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.upsert({
      where: { organizationId: orgId },
      update: { a1CertKey: key, a1PassEnc: this.enc(password ?? ""), a1Subject: cn, a1NotAfter: notAfter },
      create: { organizationId: orgId, a1CertKey: key, a1PassEnc: this.enc(password ?? ""), a1Subject: cn, a1NotAfter: notAfter },
    }));
    return { subject: cn, notAfter };
  }

  async listDocuments(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findMany({ where: {}, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, modelo: true, serie: true, numero: true, chave: true, status: true, motivo: true, totalCents: true, ambiente: true, qrUrl: true, authorizedAt: true, createdAt: true } }));
    return { items };
  }
}
