import { Injectable, Logger } from "@nestjs/common";
import * as https from "https";
import * as forge from "node-forge";
import * as zlib from "zlib";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import PDFDocument from "pdfkit";
import { SignedXml } from "xml-crypto";
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { NotificationService } from "../notifications/notification.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

const VER_APLIC = "yugo-nfse-1.0";
const VERSAO = "1.00";
// Bases da Sefin Nacional NFS-e (contribuintes). Confirmar no Swagger da produção
// restrita; podem ser sobrescritas em fiscal_config.nfse_url_hom / nfse_url_prod.
// EMISSÃO (recepção da DPS, NFS-e, eventos, parâmetros) fica na SEFIN Nacional.
// O ADN (adn.../contribuintes) é só DISTRIBUIÇÃO (GET DFe/NSU, eventos). Confirmar
// a base exata no Swagger da SEFIN e sobrescrever em fiscal_config.nfse_url_hom/prod.
const DEFAULT_HOM = "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
const DEFAULT_PROD = "https://sefin.nfse.gov.br/SefinNacional";

interface EmitInput {
  saleId?: string | null;
  storeId?: string | null;
  tomador?: { doc?: string | null; nome?: string | null; email?: string | null; im?: string | null } | null;
  /** código de tributação nacional (6 díg, subitem LC116). Default = cfg.nfseCodServico */
  codServico?: string | null;
  descricaoServico: string;
  /** alíquota ISS (%). Default = cfg.nfseAliqIss */
  aliqIss?: number | null;
  valorCents: number;
  competencia?: string | null; // YYYY-MM-DD
  productionOrderId?: string | null;
}

/**
 * Emissão de NFS-e pelo Sistema Nacional (Sefin Nacional) via API REST + mTLS.
 * Monta a DPS (leiaute Anexo I), assina o nó infDPS com o A1 (mesmo padrão
 * ICP-Brasil da NF-e), compacta (gzip+base64) e envia em POST /nfse. Reaproveita
 * o certificado e o storage do módulo fiscal. SCAFFOLD: ajustar regras de
 * negócio (totTrib, retenções, IBS/CBS) conforme rejeições na produção restrita.
 */
@Injectable()
export class NfseService {
  private readonly logger = new Logger("NFSe");
  private readonly env = loadEnv();
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly notifications: NotificationService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }
  private esc(s: string) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  private money(cents: number) { return (Math.max(0, Math.round(cents)) / 100).toFixed(2); }

  // ---- cripto/cert (mesmo padrão da NfceService) ----
  private dec(enc: string): string {
    const [iv, tag, ct] = enc.split(":");
    const key = createHash("sha256").update(`${this.env.COOKIE_SECRET}:fiscal`).digest();
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64"));
    d.setAuthTag(Buffer.from(tag!, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8");
  }
  private async loadCert(certKey: string, passEnc: string): Promise<{ keyPem: string; certPem: string; pfx: Buffer; pass: string }> {
    const pfx = (await this.storage.getPrivate(certKey)).body;
    const pass = this.dec(passEnc);
    // 1) node-forge (certificados A1 com criptografia legada: RC2/3DES)
    try {
      const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), pass);
      const KEYBAG = forge.pki.oids.pkcs8ShroudedKeyBag as string;
      const CERTBAG = forge.pki.oids.certBag as string;
      const key = (p12.getBags({ bagType: KEYBAG })[KEYBAG] ?? [])[0]?.key;
      const cert = (p12.getBags({ bagType: CERTBAG })[CERTBAG] ?? [])[0]?.cert;
      if (key && cert) {
        return { keyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey), certPem: forge.pki.certificateToPem(cert), pfx, pass };
      }
    } catch (e: any) {
      this.logger.warn(`forge não leu o A1 (${e?.message}); tentando OpenSSL (PKCS#12 moderno/AES)`);
    }
    // 2) OpenSSL — lê PKCS#12 com criptografia moderna (AES-256), que o forge não suporta
    const { keyPem, certPem } = this.opensslExtract(pfx, pass);
    return { keyPem, certPem, pfx, pass };
  }

  /** Extrai chave+cert (PEM) de um PFX moderno via OpenSSL (fallback do forge). */
  private opensslExtract(pfx: Buffer, pass: string): { keyPem: string; certPem: string } {
    const tmp = path.join(os.tmpdir(), `a1-${Date.now()}-${Math.random().toString(36).slice(2)}.pfx`);
    fs.writeFileSync(tmp, pfx);
    try {
      const run = (args: string[]) => execFileSync("openssl", args, { env: { ...process.env, YGPFX: pass }, maxBuffer: 12 * 1024 * 1024 }).toString("utf8");
      let out = "";
      try { out = run(["pkcs12", "-in", tmp, "-nodes", "-passin", "env:YGPFX"]); }
      catch { out = run(["pkcs12", "-in", tmp, "-nodes", "-legacy", "-passin", "env:YGPFX"]); }
      const keyM = out.match(/-----BEGIN (?:RSA )?(?:ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?(?:ENCRYPTED )?PRIVATE KEY-----/);
      const certM = out.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
      if (!keyM || !certM) throw new AppError(ErrorCode.ValidationFailed, "Não foi possível extrair chave/certificado do A1", 400);
      return { keyPem: keyM[0], certPem: certM[0] };
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      throw new AppError(ErrorCode.ValidationFailed, `Falha ao ler o certificado A1 (OpenSSL): ${e?.message ?? "erro"}`, 400);
    } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }

  private sign(xml: string, keyPem: string, certPem: string, localName = "infDPS"): string {
    const xpath = `//*[local-name(.)='${localName}']`;
    const sig = new SignedXml({
      privateKey: keyPem, publicCert: certPem,
      signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
      canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    });
    sig.addReference({
      xpath,
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
      digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    });
    sig.computeSignature(xml, { location: { reference: xpath, action: "after" } });
    return sig.getSignedXml();
  }

  // ---- transporte mTLS (REST/JSON) — usa chave+cert PEM (não o PFX, que pode ser AES) ----
  private httpsJson(method: string, urlStr: string, body: any, keyPem: string, certPem: string): Promise<{ status: number; json: any; text: string }> {
    const url = new URL(urlStr);
    const payload = body != null ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const rejectUnauthorized = process.env.FISCAL_TLS_REJECT_UNAUTHORIZED === "1";
    return new Promise((resolve, reject) => {
      const req = https.request(
        { method, host: url.hostname, port: url.port || 443, path: url.pathname + url.search, key: keyPem, cert: certPem, rejectUnauthorized, headers: { "Content-Type": "application/json", Accept: "application/json", ...(payload ? { "Content-Length": payload.length } : {}) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* não-JSON */ } resolve({ status: res.statusCode ?? 0, json, text }); });
        },
      );
      req.setTimeout(30000, () => req.destroy(new Error("timeout NFS-e")));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  private gzipB64(xml: string): string { return zlib.gzipSync(Buffer.from(xml, "utf8")).toString("base64"); }
  private gunzipB64(b64: string): string { return zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8"); }

  private async getCfg(ctx: RequestContext): Promise<any> {
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg) throw new AppError(ErrorCode.ValidationFailed, "Configuração fiscal não encontrada", 400);
    if (!cfg.nfseEnabled) throw new AppError(ErrorCode.ValidationFailed, "NFS-e não habilitada nesta empresa", 400);
    if (!cfg.a1CertKey || !cfg.a1PassEnc) throw new AppError(ErrorCode.ValidationFailed, "Certificado A1 não configurado", 400);
    if (!cfg.nfseMunicipio) throw new AppError(ErrorCode.ValidationFailed, "Informe o código IBGE do município (NFS-e)", 400);
    return cfg;
  }
  /** Ambiente efetivo da NFS-e: override próprio (nfseAmbiente) ou o global. */
  private nfseAmb(cfg: any): number { return cfg.nfseAmbiente ?? cfg.ambiente ?? 2; }
  private baseUrl(cfg: any): string {
    const prod = this.nfseAmb(cfg) === 1;
    return (prod ? cfg.nfseUrlProd || DEFAULT_PROD : cfg.nfseUrlHom || DEFAULT_HOM).replace(/\/+$/, "");
  }

  /** Monta o XML da DPS (não assinado) — caso comum de serviço com ISSQN. */
  private buildDps(cfg: any, input: EmitInput, nDPS: number): { xml: string; id: string } {
    // emitente: 11 dígitos = CPF; senão CNPJ (empresa). Evita classificar errado.
    const emitDoc = this.digits(cfg.cnpj);
    const emitIsCpf = emitDoc.length === 11;
    // tipo de inscrição no Id da DPS: 1 = CPF, 2 = CNPJ (leiaute Anexo I)
    const tpInsc = emitIsCpf ? "1" : "2";
    const inscFed = emitIsCpf ? ("000" + emitDoc).slice(-14) : emitDoc.padStart(14, "0");
    const cLoc = this.digits(cfg.nfseMunicipio).padStart(7, "0");
    const serie = String(cfg.nfseSerie ?? 1).padStart(5, "0");
    const nDpsStr = String(nDPS).padStart(15, "0");
    const id = `DPS${cLoc}${tpInsc}${inscFed}${serie}${nDpsStr}`;
    const now = new Date();
    // horário de Brasília (UTC-3): desloca o instante e formata com offset -03:00.
    // (antes colava "-03:00" na hora UTC → emissão ficava 3h no futuro → E0008)
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dhEmi = brt.toISOString().replace(/\.\d{3}Z$/, "") + "-03:00";
    const dCompet = (input.competencia || brt.toISOString().slice(0, 10));
    const aliq = (input.aliqIss ?? cfg.nfseAliqIss ?? 0).toFixed(2);
    // cTribNac = código de tributação nacional, 6 dígitos: item(2)+subitem(2)+desdobro(2).
    // O subitem da LC116 (ex.: "13.05" → "1305") é completado com "00" do desdobro.
    let codServ = this.digits(input.codServico || cfg.nfseCodServico || "");
    if (codServ && codServ.length < 6) codServ = codServ.padEnd(6, "0");
    if (codServ.length > 6) codServ = codServ.slice(0, 6);

    const prestDoc: string = emitIsCpf ? `<CPF>${emitDoc}</CPF>` : `<CNPJ>${emitDoc}</CNPJ>`;
    const im: string = cfg.im ? `<IM>${this.esc(cfg.im)}</IM>` : "";

    // tomador (opcional)
    let toma = "";
    const tdoc = this.digits(input.tomador?.doc);
    if (tdoc) {
      const tDocXml: string = tdoc.length === 11 ? `<CPF>${tdoc}</CPF>` : `<CNPJ>${tdoc}</CNPJ>`;
      const tEmail: string = input.tomador?.email ? `<email>${this.esc(input.tomador.email)}</email>` : "";
      toma = `<toma>${tDocXml}<xNome>${this.esc(input.tomador?.nome || "Consumidor")}</xNome>${tEmail}</toma>`;
    }

    // montado por array + join pra evitar explosão de tipos do tsc em cadeia de '+'.
    const p: string[] = [];
    p.push(`<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${VERSAO}">`);
    p.push(`<infDPS Id="${id}">`);
    p.push(`<tpAmb>${this.nfseAmb(cfg) === 1 ? 1 : 2}</tpAmb>`);
    p.push(`<dhEmi>${dhEmi}</dhEmi>`);
    p.push(`<verAplic>${VER_APLIC}</verAplic>`);
    p.push(`<serie>${cfg.nfseSerie ?? 1}</serie>`);
    p.push(`<nDPS>${nDPS}</nDPS>`);
    p.push(`<dCompet>${dCompet}</dCompet>`);
    p.push(`<tpEmit>1</tpEmit>`);
    p.push(`<cLocEmi>${cLoc}</cLocEmi>`);
    // regApTribSN é obrigatório p/ optante ME/EPP (opSimpNac=3) — E0166. Default 1
    // (apuração dos tributos federais e municipal pelo próprio Simples Nacional).
    const opSN = Number(cfg.nfseOpSimpNac ?? 1);
    const regAp: string = opSN === 3 ? `<regApTribSN>${Number(cfg.nfseRegApTribSN ?? 1)}</regApTribSN>` : "";
    p.push(`<prest>${prestDoc}${im}<regTrib><opSimpNac>${opSN}</opSimpNac>${regAp}<regEspTrib>${cfg.nfseRegEspTrib ?? 0}</regEspTrib></regTrib></prest>`);
    p.push(toma);
    p.push(`<serv><locPrest><cLocPrestacao>${cLoc}</cLocPrestacao></locPrest><cServ><cTribNac>${codServ}</cTribNac><xDescServ>${this.esc(input.descricaoServico).slice(0, 1000)}</xDescServ></cServ></serv>`);
    p.push(`<valores><vServPrest><vServ>${this.money(input.valorCents)}</vServ></vServPrest>`);
    // Simples Nacional (ME/EPP ou MEI) com apuração do ISSQN pelo SN e sem retenção:
    // NÃO se informa alíquota — o ISS é recolhido pelo DAS (E0625). Senão, envia pAliq.
    const tpRet = 1; // não retido
    const simplesSemAliq = (opSN === 2 || opSN === 3) && Number(cfg.nfseRegApTribSN ?? 1) === 1 && tpRet === 1;
    const pAliqXml: string = simplesSemAliq ? "" : `<pAliq>${aliq}</pAliq>`;
    p.push(`<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${tpRet}</tpRetISSQN>${pAliqXml}</tribMun>`);
    // ME/EPP/MEI (Simples): usa pTotTribSN (% transparência do Simples), NÃO indTotTrib (E0712).
    // Demais regimes: indTotTrib=0 (não informa o valor total de tributos).
    const totTribXml: string = (opSN === 2 || opSN === 3) ? `<pTotTribSN>0</pTotTribSN>` : `<indTotTrib>0</indTotTrib>`;
    p.push(`<totTrib>${totTribXml}</totTrib></trib></valores>`);
    p.push(`</infDPS></DPS>`);
    return { xml: p.join(""), id };
  }

  // ===================== ações =====================
  async getConfigSafe(ctx: RequestContext): Promise<any> {
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg) return null;
    return {
      nfseEnabled: cfg.nfseEnabled, nfseMunicipio: cfg.nfseMunicipio, nfseSerie: cfg.nfseSerie, nfseNext: cfg.nfseNext,
      nfseOpSimpNac: cfg.nfseOpSimpNac, nfseRegEspTrib: cfg.nfseRegEspTrib, nfseCodServico: cfg.nfseCodServico,
      nfseCnae: cfg.nfseCnae, nfseAliqIss: cfg.nfseAliqIss, ambiente: cfg.ambiente, nfseAmbiente: cfg.nfseAmbiente, hasCert: !!cfg.a1CertKey,
      nfseUrlHom: cfg.nfseUrlHom, nfseUrlProd: cfg.nfseUrlProd, defaultHom: DEFAULT_HOM, defaultProd: DEFAULT_PROD,
    };
  }
  async updateConfig(ctx: RequestContext, patch: Record<string, unknown>): Promise<any> {
    this.requireAdmin(ctx);
    const allowed = ["nfseEnabled", "nfseAmbiente", "nfseMunicipio", "nfseSerie", "nfseOpSimpNac", "nfseRegEspTrib", "nfseCodServico", "nfseCnae", "nfseAliqIss", "nfseUrlHom", "nfseUrlProd"] as const;
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (patch[k] !== undefined) data[k] = patch[k];
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.update({ where: { organizationId: ctx.orgId! }, data: data as any }));
    return this.getConfigSafe(ctx);
  }

  /** Consulta parâmetros municipais (alíquota/regime) — ajuda a preencher a DPS. */
  async parametrosMunicipais(ctx: RequestContext, codigoMunicipio: string, codigoServico?: string): Promise<any> {
    const cfg = await this.getCfg(ctx);
    const { keyPem, certPem } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const mun = this.digits(codigoMunicipio).padStart(7, "0");
    const path = codigoServico ? `/parametros_municipais/${mun}/${this.digits(codigoServico)}` : `/parametros_municipais/${mun}/convenio`;
    const r = await this.httpsJson("GET", `${this.baseUrl(cfg)}${path}`, null, keyPem, certPem);
    return { status: r.status, data: r.json ?? r.text };
  }

  /** Emite a NFS-e: monta DPS → assina → gzip+b64 → POST /nfse. */
  async emitir(ctx: RequestContext, input: EmitInput): Promise<any> {
    this.requireAdmin(ctx);
    const cfg = await this.getCfg(ctx);
    const orgId = ctx.orgId!;
    if (!this.digits(input.codServico || cfg.nfseCodServico || "")) {
      throw new AppError(ErrorCode.ValidationFailed, "Configure o código de serviço (LC116) na NFS-e antes de emitir", 400);
    }
    const { keyPem, certPem } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);

    // nº DPS atômico
    const updated = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.update({ where: { organizationId: orgId }, data: { nfseNext: { increment: 1 } }, select: { nfseNext: true } }));
    const nDPS = (updated.nfseNext ?? 1) - 1;

    const { xml } = this.buildDps(cfg, input, nDPS);
    const signed = this.sign(xml, keyPem, certPem, "infDPS");
    // prólogo UTF-8 obrigatório (E1229: "Xml não está utilizando codificação UTF-8")
    const dpsXml = `<?xml version="1.0" encoding="UTF-8"?>` + signed;
    const xmlKey = (await this.storage.putPrivate({ keyPrefix: `fiscal/nfse/${orgId}`, contentType: "application/xml", body: Buffer.from(dpsXml, "utf8") })).key;

    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.create({
      data: { organizationId: orgId, storeId: input.storeId ?? null, saleId: input.saleId ?? null, productionOrderId: input.productionOrderId ?? null, modelo: "99", serie: cfg.nfseSerie ?? 1, numero: nDPS, nDps: nDPS, ambiente: this.nfseAmb(cfg), status: "assinada", totalCents: Math.round(input.valorCents), xmlKey, competencia: input.competencia ? new Date(input.competencia) : new Date() },
      select: { id: true },
    }));

    const r = await this.httpsJson("POST", `${this.baseUrl(cfg)}/nfse`, { dpsXmlGZipB64: this.gzipB64(dpsXml) }, keyPem, certPem).catch((e) => ({ status: 0, json: null, text: String(e?.message) }));

    const j = r.json ?? {};
    if (r.status >= 200 && r.status < 300) {
      // resposta: NFS-e (gzip+b64) e/ou chave de acesso (API usa PascalCase)
      let nfseXml = ""; let chave = j.chaveAcesso ?? j.ChaveAcesso ?? j.chave ?? null;
      const b64 = j.nfseXmlGZipB64 ?? j.NfseXmlGZipB64 ?? j.nfseXmlGzipB64 ?? j.ArquivoXml ?? null;
      if (b64) { try { nfseXml = this.gunzipB64(b64); const m = /Id="NFS([0-9]{50})"/.exec(nfseXml); if (!chave && m) chave = m[1]; } catch { /* pode vir XML puro */ if (!nfseXml && typeof b64 === "string" && b64.includes("<")) nfseXml = b64; } }
      let nfseXmlKey: string | null = null;
      if (nfseXml) nfseXmlKey = (await this.storage.putPrivate({ keyPrefix: `fiscal/nfse/${orgId}`, contentType: "application/xml", body: Buffer.from(nfseXml, "utf8") })).key;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({ where: { id: doc.id }, data: { status: "autorizada", chave: chave ?? undefined, nfseXmlKey: nfseXmlKey ?? undefined, protocolo: j.protocolo ?? null, authorizedAt: new Date() } }));
      return { id: doc.id, status: "autorizada", chave, nDPS };
    }
    // rejeição — extrai a mensagem dos formatos da SEFAZ Nacional (Erros[].Descricao)
    const errArr: any[] = j.erros ?? j.Erros ?? j.mensagens ?? j.Mensagens ?? j.alertas ?? j.Alertas ?? [];
    const e0 = Array.isArray(errArr) ? errArr[0] : null;
    const fromErr = e0 ? [e0.codigo ?? e0.Codigo, e0.descricao ?? e0.Descricao ?? e0.mensagem ?? e0.Mensagem, e0.complemento ?? e0.Complemento].filter(Boolean).join(" — ") : null;
    const motivo = (fromErr || j.mensagem || j.message || (typeof r.text === "string" && !r.text.includes("<!DOCTYPE") ? r.text : null) || `Falha na emissão (HTTP ${r.status})`).toString().slice(0, 500);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({ where: { id: doc.id }, data: { status: "rejeitada", motivo } }));
    this.logger.warn(`NFS-e rejeitada org=${orgId} nDPS=${nDPS} status=${r.status}: ${motivo}`);
    return { id: doc.id, status: "rejeitada", motivo, nDPS };
  }

  /** Consulta uma NFS-e pela chave de acesso. */
  async consultar(ctx: RequestContext, chave: string): Promise<any> {
    const cfg = await this.getCfg(ctx);
    const { keyPem, certPem } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const r = await this.httpsJson("GET", `${this.baseUrl(cfg)}/nfse/${this.digits(chave)}`, null, keyPem, certPem);
    return { status: r.status, data: r.json ?? r.text };
  }

  private xmlEsc(s: string): string { return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }

  /**
   * Cancela uma NFS-e autorizada via EVENTO de cancelamento (Sistema Nacional).
   * Monta o pedRegEvento (e101101 = cancelamento a pedido do contribuinte), assina
   * o infPedReg, compacta (gzip+b64) e envia em POST /nfse/{chave}/eventos.
   * Leiaute padrão — ajustar conforme rejeições da produção restrita.
   */
  async cancelarNfse(ctx: RequestContext, docId: string, justificativa: string): Promise<any> {
    this.requireAdmin(ctx);
    const cfg = await this.getCfg(ctx);
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId, modelo: "99" } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "NFS-e não encontrada", 404);
    if (doc.status === "cancelada") return { id: doc.id, status: "cancelada", already: true };
    if (doc.status !== "autorizada") throw new AppError(ErrorCode.ValidationFailed, "Só é possível cancelar uma NFS-e autorizada", 400);
    if (!doc.chave) throw new AppError(ErrorCode.ValidationFailed, "NFS-e sem chave de acesso", 400);
    const just = String(justificativa ?? "").trim();
    if (just.length < 15) throw new AppError(ErrorCode.ValidationFailed, "Justificativa de no mínimo 15 caracteres", 400);

    const { keyPem, certPem } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dhEvento = brt.toISOString().replace(/\.\d{3}Z$/, "") + "-03:00";
    const autorDoc = this.digits(cfg.cnpj);
    const autorTag = autorDoc.length === 11 ? `<CPFAutor>${autorDoc}</CPFAutor>` : `<CNPJAutor>${autorDoc}</CNPJAutor>`;
    const amb = this.nfseAmb(cfg);
    const tpEvento = "101101"; // cancelamento a pedido do contribuinte
    // Sefin 1.6.0: Id = "PRE" + chave(50) + tpEvento(6) = 59 chars (sem nº sequencial);
    // o campo nPedRegEvento foi REMOVIDO do leiaute.
    const id = `PRE${doc.chave}${tpEvento}`;
    // e101101: xDesc é FIXO ("Cancelamento de NFS-e"); o motivo vai em cMotivo
    // (1=Erro na emissão, 2=Serviço não prestado, 9=Outros) + xMotivo (texto livre).
    const e101101 = `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>9</cMotivo><xMotivo>${this.xmlEsc(just).slice(0, 255)}</xMotivo></e101101>`;
    const infPedReg = `<infPedReg Id="${id}"><tpAmb>${amb}</tpAmb><verAplic>${VER_APLIC}</verAplic><dhEvento>${dhEvento}</dhEvento>${autorTag}<chNFSe>${doc.chave}</chNFSe>${e101101}</infPedReg>`;
    const pedido = `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">${infPedReg}</pedRegEvento>`;
    const signed = this.sign(pedido, keyPem, certPem, "infPedReg");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>` + signed;

    const r = await this.httpsJson("POST", `${this.baseUrl(cfg)}/nfse/${this.digits(doc.chave)}/eventos`, { pedidoRegistroEventoXmlGZipB64: this.gzipB64(xml) }, keyPem, certPem).catch((e) => ({ status: 0, json: null, text: String(e?.message) }));
    const j = r.json ?? {};
    if (r.status >= 200 && r.status < 300) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({ where: { id: doc.id }, data: { status: "cancelada", cancelMotivo: just } }));
      this.logger.log(`NFS-e cancelada org=${ctx.orgId} chave=${doc.chave}`);
      return { id: doc.id, status: "cancelada", chave: doc.chave };
    }
    const errArr: any[] = j.erros ?? j.Erros ?? j.mensagens ?? j.Mensagens ?? j.alertas ?? j.Alertas ?? [];
    const e0 = Array.isArray(errArr) ? errArr[0] : null;
    const fromErr = e0 ? [e0.codigo ?? e0.Codigo, e0.descricao ?? e0.Descricao ?? e0.mensagem ?? e0.Mensagem, e0.complemento ?? e0.Complemento].filter(Boolean).join(" — ") : null;
    const motivo = (fromErr || j.mensagem || j.message || (typeof r.text === "string" && !r.text.includes("<!DOCTYPE") ? r.text : null) || `Falha no cancelamento (HTTP ${r.status})`).toString().slice(0, 500);
    this.logger.warn(`NFS-e cancelamento rejeitado org=${ctx.orgId} chave=${doc.chave} status=${r.status}: ${motivo}`);
    return { id: doc.id, status: doc.status, motivo };
  }

  /** Lista as NFS-e (modelo 99) da empresa. */
  async list(ctx: RequestContext): Promise<any> {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findMany({ where: { modelo: "99" }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, nDps: true, serie: true, chave: true, status: true, motivo: true, totalCents: true, competencia: true, createdAt: true, productionOrderId: true } }));
    return { items };
  }

  // ===================== EMISSÃO A PARTIR DO PEDIDO DE PRODUÇÃO (gráfica) =====================
  /** Emite a NFS-e de um pedido de produção e, se autorizar, envia ao cliente (PDF). */
  async emitFromProductionOrder(ctx: RequestContext, orderId: string, opts?: { authRequestId?: string | null; authCode?: string | null }): Promise<any> {
    this.requireAdmin(ctx);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id: orderId }, include: { items: true } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    // já existe NFS-e autorizada pra este pedido? não duplica.
    const ja = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { productionOrderId: orderId, modelo: "99", status: "autorizada" }, select: { id: true } }));
    if (ja) { await this.sendNfse(ctx, ja.id).catch(() => undefined); return { id: ja.id, status: "autorizada", already: true }; }

    // Regra: só emite NFS-e após pagamento TOTAL. Sem pagamento total, exige código
    // de autorização (admin/gerente/supervisor) enviado por WhatsApp.
    let authorizedByName: string | null = null;
    if (order.paymentStatus !== "paid") {
      if (!opts?.authRequestId || !opts?.authCode) {
        throw new AppError(ErrorCode.ValidationFailed, "Pagamento total pendente. Gere com autorização (código de 4 dígitos).", 400);
      }
      authorizedByName = await this.verifyNfseAuth(ctx, orderId, opts.authRequestId, opts.authCode);
    }

    const itens = (order.items ?? []) as any[];
    const descricao = itens.length ? itens.map((i) => `${i.qty}x ${i.description}`).join("; ").slice(0, 1000) : `Pedido ${order.shortCode ?? ""}`;
    const valorCents = Number(order.totalCents ?? 0);
    const res = await this.emitir(ctx, {
      productionOrderId: orderId,
      storeId: order.storeId ?? null,
      descricaoServico: descricao,
      valorCents,
      tomador: (order.contactName || order.fiscalCpf) ? { nome: order.contactName ?? null, doc: order.fiscalCpf ?? null, email: order.contactEmail ?? null } : null,
    });
    if (res?.status === "autorizada") {
      const sendRes = await this.sendNfse(ctx, res.id).catch((e) => { this.logger.warn(`envio NFS-e falhou: ${e?.message}`); return null as any; });
      // anexa a NF gerada ao pedido e marca como gerada (nº/chave + quem autorizou)
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({
        where: { id: orderId },
        data: {
          nfUrl: sendRes?.pdfUrl ?? order.nfUrl ?? null,
          nfIssuedAt: new Date(),
          nfKey: res.chave ?? null,
          nfNumber: res.nDPS != null ? String(res.nDPS) : null,
          nfAuthorizedBy: authorizedByName,
        },
      })).catch((e) => this.logger.warn(`vincular NF ao pedido falhou: ${e?.message}`));
      return { ...res, authorizedBy: authorizedByName, pdfUrl: sendRes?.pdfUrl ?? null };
    }
    return res;
  }

  // ===================== AUTORIZAÇÃO p/ emitir sem pagamento total =====================
  /** Lista admin/gerente/supervisor da empresa (com WhatsApp) p/ autorizar a emissão. */
  async listAuthAdmins(ctx: RequestContext): Promise<any[]> {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId!;
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findMany({
      where: { organizationId: orgId, status: "active", role: { slug: { in: ["owner", "admin", "manager", "gerente", "supervisor"] } } },
      select: { id: true, user: { select: { name: true, phone: true } }, role: { select: { name: true, slug: true } } },
    }));
    return rows.map((r) => ({ membershipId: r.id, name: r.user?.name ?? "—", role: r.role?.name ?? r.role?.slug ?? "", hasWhatsapp: !!r.user?.phone }));
  }

  /** Gera código de 4 dígitos, salva o hash e envia no WhatsApp do autorizador. */
  async requestNfseAuth(ctx: RequestContext, orderId: string, adminMembershipId: string): Promise<any> {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id: orderId }, select: { id: true, shortCode: true, contactName: true, totalCents: true } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: adminMembershipId, organizationId: orgId, status: "active" }, select: { id: true, user: { select: { name: true, phone: true } }, storeId: true } }));
    if (!admin) throw new AppError(ErrorCode.NotFound, "Autorizador não encontrado", 404);
    if (!admin.user?.phone) throw new AppError(ErrorCode.ValidationFailed, "Autorizador sem WhatsApp cadastrado", 400);

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.create({
      data: { organizationId: orgId, installmentId: null, adminMembershipId: admin.id, requestedBy: ctx.membershipId ?? null, purpose: "nfse_no_payment", codeHash, amountCents: BigInt(Math.round(Number(order.totalCents ?? 0))), meta: { orderId }, expiresAt },
      select: { id: true },
    }));
    const valor = (Number(order.totalCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await this.notifications.notify({
      organizationId: orgId, storeId: admin.storeId ?? orgId, whatsappPhone: admin.user.phone,
      subject: "Autorização de NFS-e sem pagamento total",
      text: `Código de autorização: ${code}\nEmitir NFS-e do pedido ${order.shortCode ?? ""} (${order.contactName ?? ""}) — ${valor} SEM pagamento total.\nInforme este código ao atendente. Válido por 15 minutos.`,
      templateCode: "nota_fiscal",
    }).catch(() => null);
    return { ok: true, requestId: rec.id, adminName: admin.user.name, expiresAt };
  }

  /** Valida o código e devolve o NOME de quem autorizou (p/ registrar no pedido). */
  private async verifyNfseAuth(ctx: RequestContext, orderId: string, requestId: string, code: string): Promise<string> {
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.findFirst({ where: { id: requestId, purpose: "nfse_no_payment" } }));
    if (!rec) throw new AppError(ErrorCode.NotFound, "Autorização não encontrada", 404);
    if ((rec.meta as any)?.orderId && (rec.meta as any).orderId !== orderId) throw new AppError(ErrorCode.ValidationFailed, "Autorização de outro pedido", 400);
    if (rec.usedAt) throw new AppError(ErrorCode.Conflict, "Código já utilizado", 409);
    if (rec.expiresAt.getTime() < Date.now()) throw new AppError(ErrorCode.ValidationFailed, "Código expirado", 400);
    if ((rec.attempts ?? 0) >= 5) throw new AppError(ErrorCode.ValidationFailed, "Tentativas esgotadas", 400);
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(String(code)).digest("hex");
    const ok = codeHash.length === rec.codeHash.length && timingSafeEqual(Buffer.from(codeHash), Buffer.from(rec.codeHash));
    if (!ok) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } }));
      throw new AppError(ErrorCode.ValidationFailed, "Código incorreto", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }));
    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: rec.adminMembershipId }, select: { user: { select: { name: true } } } }));
    return admin?.user?.name ?? "autorizador";
  }

  /** Gera o PDF (DANFSe simplificado) da NFS-e a partir dos dados do documento. */
  async danfsePdf(ctx: RequestContext, docId: string): Promise<{ buffer: Buffer; filename: string }> {
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId, modelo: "99" } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "NFS-e não encontrada", 404);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    let tomadorNome = ""; let descricao = "";
    if (doc.productionOrderId) {
      const o = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id: doc.productionOrderId! }, select: { contactName: true, shortCode: true, items: { select: { qty: true, description: true } } } }));
      tomadorNome = o?.contactName ?? "";
      descricao = (o?.items ?? []).map((i: any) => `${i.qty}x ${i.description}`).join("; ");
    }
    const buffer = await this.renderDanfse(cfg, doc, { tomadorNome, descricao });
    return { buffer, filename: `NFSe-${doc.nDps ?? doc.id}.pdf` };
  }

  private renderDanfse(cfg: any, doc: any, extra: { tomadorNome: string; descricao: string }): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const brl = (c: any) => `R$ ${(Number(c ?? 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
      pdf.fontSize(16).fillColor("#111").text("NFS-e — Nota Fiscal de Serviços eletrônica", { align: "center" });
      pdf.moveDown(0.3).fontSize(9).fillColor("#666").text(`Sistema Nacional NFS-e · ${doc.ambiente === 1 ? "Produção" : "Homologação"}`, { align: "center" });
      pdf.moveDown(1).strokeColor("#ccc").moveTo(40, pdf.y).lineTo(555, pdf.y).stroke();
      const row = (k: string, v: string) => { pdf.moveDown(0.4).fontSize(10).fillColor("#444").text(k, { continued: true }).fillColor("#111").text("  " + (v || "—")); };
      pdf.moveDown(0.6).fontSize(12).fillColor("#111").text("Prestador");
      row("Razão social:", cfg?.razaoSocial ?? cfg?.nomeFantasia ?? "");
      row("CNPJ:", cfg?.cnpj ?? "");
      row("Município:", cfg?.municipio ?? cfg?.nfseMunicipio ?? "");
      pdf.moveDown(0.8).fontSize(12).text("Tomador");
      row("Nome:", extra.tomadorNome);
      pdf.moveDown(0.8).fontSize(12).text("Serviço");
      row("Descrição:", extra.descricao);
      row("Competência:", doc.competencia ? new Date(doc.competencia).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "");
      row("Valor do serviço:", brl(doc.totalCents));
      pdf.moveDown(0.8).fontSize(12).text("Identificação");
      row("Nº DPS:", String(doc.nDps ?? ""));
      row("Chave de acesso:", doc.chave ?? "");
      row("Emitida em:", doc.authorizedAt ? new Date(doc.authorizedAt).toLocaleString("pt-BR") : "");
      pdf.moveDown(1.5).fontSize(8).fillColor("#999").text("Documento gerado pelo sistema. Consulte a autenticidade pela chave de acesso no portal nacional da NFS-e.", { align: "center" });
      pdf.end();
    });
  }

  /** Envia a NFS-e ao cliente: PDF por WhatsApp/e-mail; aparece no portal pelo vínculo do pedido. */
  async sendNfse(ctx: RequestContext, docId: string, override?: { email?: string | null; whatsapp?: string | null }): Promise<any> {
    const orgId = ctx.orgId!;
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId, modelo: "99" } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "NFS-e não encontrada", 404);
    if (doc.status !== "autorizada") throw new AppError(ErrorCode.ValidationFailed, "Só envia NFS-e autorizada", 400);
    // contato/cliente do pedido
    let nome = "", email: string | null = null, whatsapp: string | null = null, customerId: string | null = null, storeId: string | null = doc.storeId;
    if (doc.productionOrderId) {
      const o = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id: doc.productionOrderId! }, select: { contactName: true, contactEmail: true, contactPhone: true, customerId: true, storeId: true } }));
      nome = (o?.contactName ?? "").split(" ")[0] ?? ""; email = o?.contactEmail ?? null; whatsapp = o?.contactPhone ?? null; customerId = o?.customerId ?? null; storeId = o?.storeId ?? storeId;
    }
    email = override?.email ?? email; whatsapp = override?.whatsapp ?? whatsapp;
    if (!email && !whatsapp) return { sent: false, reason: "sem contato" };
    const { buffer, filename } = await this.danfsePdf(ctx, docId);
    const { url: pdfUrl } = await this.storage.putPublic({ keyPrefix: `fiscal/nfse/${orgId}`, contentType: "application/pdf", body: buffer, originalName: filename });
    const text = `Olá${nome ? " " + nome : ""}! Segue a sua NFS-e (nota fiscal de serviço).` + (doc.chave ? `\nChave: ${doc.chave}` : "");
    const sent = await this.notifications.notify({
      organizationId: orgId, storeId: storeId ?? orgId, customerId,
      whatsappPhone: whatsapp, email,
      subject: "Sua NFS-e", text, html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      templateCode: "nota_fiscal",
      media: { url: pdfUrl, fileName: filename, mediatype: "document" },
    }).catch(() => null);
    return { sent: !!sent, pdfUrl };
  }
}
