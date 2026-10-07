import { Injectable, Logger } from "@nestjs/common";
import * as forge from "node-forge";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Assinatura digital ICP-Brasil (e-CNPJ A1) do AFD/AEJ.
 * O .pfx (PKCS#12) fica no bucket PRIVADO; a senha é cifrada (AES-256-GCM).
 * sign() produz um PKCS#7/CMS DESTACADO (.p7s) sobre o conteúdo do arquivo.
 *
 * NOTA de conformidade: gera CMS SignedData verificável (SHA-256 + atributos
 * contentType/messageDigest/signingTime). Para AD-RB ICP-Brasil completo
 * (signing-certificate-v2/ESS) validar no verificador oficial do ITI na homologação.
 */
@Injectable()
export class PontoSignService {
  private readonly logger = new Logger("PontoSign");
  private readonly env = loadEnv();
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }

  private aesKey(): Buffer { return createHash("sha256").update(`${this.env.COOKIE_SECRET}:ponto-a1`).digest(); }
  private enc(plain: string): string {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", this.aesKey(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); const tag = c.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }
  private dec(enc: string): string {
    const [iv, tag, ct] = enc.split(":");
    const d = createDecipheriv("aes-256-gcm", this.aesKey(), Buffer.from(iv!, "base64"));
    d.setAuthTag(Buffer.from(tag!, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8");
  }

  /** Abre o .pfx e devolve a chave + cert (lança se a senha estiver errada). */
  private openPfx(pfx: Buffer, password: string): { key: forge.pki.PrivateKey; cert: forge.pki.Certificate } {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    } catch { throw new AppError(ErrorCode.ValidationFailed, "Não consegui abrir o certificado — senha incorreta ou arquivo inválido", 400); }
    const KEYBAG = forge.pki.oids.pkcs8ShroudedKeyBag as string;
    const CERTBAG = forge.pki.oids.certBag as string;
    const keyBags = p12.getBags({ bagType: KEYBAG })[KEYBAG] ?? [];
    const certBags = p12.getBags({ bagType: CERTBAG })[CERTBAG] ?? [];
    const key = keyBags[0]?.key; const cert = certBags[0]?.cert;
    if (!key || !cert) throw new AppError(ErrorCode.ValidationFailed, "Certificado sem chave/par válido", 400);
    return { key, cert };
  }

  /** Resolve o empregador alvo (o explícito, senão o DEFAULT). */
  private async resolveEmployerId(tx: any, explicit?: string | null): Promise<string | null> {
    if (explicit) return explicit;
    const def = await tx.pontoEmployer.findFirst({ where: { isDefault: true }, select: { id: true } });
    return def?.id ?? null;
  }

  // ----- ADMIN: gerenciar o certificado (POR EMPREGADOR) -----
  async uploadCert(ctx: RequestContext, pfxBase64: string, password: string, employerId?: string | null) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const b64 = (pfxBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const pfx = Buffer.from(b64, "base64");
    if (!pfx.length) throw new AppError(ErrorCode.ValidationFailed, "Arquivo do certificado vazio", 400);
    if (pfx.length > 200_000) throw new AppError(ErrorCode.ValidationFailed, "Arquivo muito grande para um A1", 400);
    const { cert } = this.openPfx(pfx, password ?? "");
    const cn = cert.subject.getField("CN")?.value ?? "Certificado";
    const notAfter = cert.validity.notAfter;
    const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/cert/${orgId}`, contentType: "application/x-pkcs12", body: pfx });
    const data = { a1CertKey: key, a1PassEnc: this.enc(password ?? ""), a1Subject: cn, a1NotAfter: notAfter };
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const empId = await this.resolveEmployerId(tx, employerId);
      if (empId) {
        await tx.pontoEmployer.update({ where: { id: empId }, data });
        const def = await tx.pontoEmployer.findFirst({ where: { id: empId }, select: { isDefault: true } });
        if (def?.isDefault) await tx.pontoConfig.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, ...data } }); // espelha no default (compat)
      } else {
        await tx.pontoConfig.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, ...data } });
      }
    });
    return { subject: cn, notAfter };
  }

  async status(ctx: RequestContext, employerId?: string | null) {
    this.requireAdmin(ctx);
    const c = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const empId = await this.resolveEmployerId(tx, employerId);
      if (empId) return tx.pontoEmployer.findFirst({ where: { id: empId }, select: { a1CertKey: true, a1Subject: true, a1NotAfter: true } });
      return tx.pontoConfig.findFirst({ where: {}, select: { a1CertKey: true, a1Subject: true, a1NotAfter: true } });
    });
    return { configured: !!c?.a1CertKey, subject: c?.a1Subject ?? null, notAfter: c?.a1NotAfter ?? null, expired: c?.a1NotAfter ? new Date(c.a1NotAfter) < new Date() : false };
  }

  async removeCert(ctx: RequestContext, employerId?: string | null) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const empId = await this.resolveEmployerId(tx, employerId);
      const data = { a1CertKey: null, a1PassEnc: null, a1Subject: null, a1NotAfter: null };
      if (empId) {
        await tx.pontoEmployer.update({ where: { id: empId }, data });
        const def = await tx.pontoEmployer.findFirst({ where: { id: empId }, select: { isDefault: true } });
        if (def?.isDefault) await tx.pontoConfig.update({ where: { organizationId: ctx.orgId! }, data }).catch(() => undefined);
      } else {
        await tx.pontoConfig.update({ where: { organizationId: ctx.orgId! }, data });
      }
    });
    return { ok: true };
  }

  /** Assina um conteúdo e devolve o .p7s (DER) destacado, com o A1 do EMPREGADOR
   *  (cada CNPJ usa o seu); cai no certificado da conta (ponto_config) se faltar. */
  async sign(orgId: string, content: Buffer, employerId?: string | null): Promise<Buffer | null> {
    const cred = await this.prisma.runWithContext({ orgId }, async (tx) => {
      if (employerId) {
        const e = await tx.pontoEmployer.findFirst({ where: { id: employerId }, select: { a1CertKey: true, a1PassEnc: true } });
        if (e?.a1CertKey && e?.a1PassEnc) return e;
      }
      return tx.pontoConfig.findFirst({ where: {}, select: { a1CertKey: true, a1PassEnc: true } });
    });
    if (!cred?.a1CertKey || !cred?.a1PassEnc) return null;
    let pfx: Buffer;
    try { pfx = (await this.storage.getPrivate(cred.a1CertKey)).body; } catch { return null; }
    const { key, cert } = this.openPfx(pfx, this.dec(cred.a1PassEnc));
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(content.toString("binary"));
    p7.addCertificate(cert);
    p7.addSigner({
      key: key as forge.pki.rsa.PrivateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256 as string,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType as string, value: forge.pki.oids.data as string },
        { type: forge.pki.oids.messageDigest as string },
        { type: forge.pki.oids.signingTime as string, value: new Date().toISOString() },
      ] as any,
    });
    p7.sign({ detached: true });
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return Buffer.from(der, "binary");
  }
}
