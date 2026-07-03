import { Injectable, Logger } from "@nestjs/common";
import * as https from "https";
import * as forge from "node-forge";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import { SignedXml } from "xml-crypto";
import { XMLParser } from "fast-xml-parser";
import { createDecipheriv, createHash, randomInt } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { NotificationService } from "../notifications/notification.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

// Código da UF (IBGE) por sigla — usado na chave de acesso e no cUF.
const CUF: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23",
  RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

// Endpoints NFC-e (NFeAutorizacao4) por UF. É multi-estado: a UF vem da empresa
// (fiscal_config.uf) e o autorizador é escolhido por ela. SVRS atende os estados
// "virtuais"; os demais têm autorizador próprio. Confirmar a URL na homologação de
// cada UF (ou usar o override fiscal_config se preenchido).
const SVRS = {
  hom: "https://nfce-homologacao.svrs.rs.gov.br/ws/NFeAutorizacao/NFeAutorizacao4.asmx",
  prod: "https://nfce.svrs.rs.gov.br/ws/NFeAutorizacao/NFeAutorizacao4.asmx",
};
const AUTORIZADOR: Record<string, { hom: string; prod: string }> = {
  // --- autorizadores próprios (NFC-e) ---
  BA: { hom: "https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx", prod: "https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx" },
  SP: { hom: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx", prod: "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx" },
  CE: { hom: "https://nfceh.sefaz.ce.gov.br/nfce4/services/NFeAutorizacao4?wsdl", prod: "https://nfce.sefaz.ce.gov.br/nfce4/services/NFeAutorizacao4?wsdl" },
  GO: { hom: "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl", prod: "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl" },
  MG: { hom: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4", prod: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4" },
  MS: { hom: "https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4", prod: "https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4" },
  MT: { hom: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NFeAutorizacao4?wsdl", prod: "https://nfce.sefaz.mt.gov.br/nfcews/services/NFeAutorizacao4?wsdl" },
  PE: { hom: "https://nfcehomolog.sefaz.pe.gov.br/nfce-service/services/NFeAutorizacao4", prod: "https://nfce.sefaz.pe.gov.br/nfce-service/services/NFeAutorizacao4" },
  PR: { hom: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4?wsdl", prod: "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4?wsdl" },
  AM: { hom: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NFeAutorizacao4", prod: "https://nfce.sefaz.am.gov.br/nfce-services/services/NFeAutorizacao4" },
  RS: SVRS,
  // --- estados atendidos pelo SVRS (autorizador virtual) ---
  AC: SVRS, AL: SVRS, AP: SVRS, DF: SVRS, ES: SVRS, MA: SVRS, PA: SVRS, PB: SVRS,
  PI: SVRS, RJ: SVRS, RN: SVRS, RO: SVRS, RR: SVRS, SC: SVRS, SE: SVRS, TO: SVRS,
};

// URL pública do QR Code da NFC-e por UF (consulta). Fallback genérico ao SVRS.
const QR_CONSULTA: Record<string, { hom: string; prod: string }> = {
  BA: { hom: "http://hinternet.sefaz.ba.gov.br/nfce/qrcode", prod: "http://www.sefaz.ba.gov.br/nfce/qrcode" },
  SP: { hom: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode", prod: "https://www.nfce.fazenda.sp.gov.br/qrcode" },
};

// Endpoints NFeRecepcaoEvento4 (cancelamento) por UF — mesmo critério multi-estado.
// Confirmar na homologação de cada UF (como o autorizador).
const SVRS_EVENTO = {
  hom: "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  prod: "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
};
const EVENTO: Record<string, { hom: string; prod: string }> = {
  BA: { hom: "https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx", prod: "https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx" },
  SP: { hom: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx", prod: "https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx" },
  RS: SVRS_EVENTO,
  AC: SVRS_EVENTO, AL: SVRS_EVENTO, AP: SVRS_EVENTO, DF: SVRS_EVENTO, ES: SVRS_EVENTO, MA: SVRS_EVENTO, PA: SVRS_EVENTO, PB: SVRS_EVENTO,
  PI: SVRS_EVENTO, RJ: SVRS_EVENTO, RN: SVRS_EVENTO, RO: SVRS_EVENTO, RR: SVRS_EVENTO, SC: SVRS_EVENTO, SE: SVRS_EVENTO, TO: SVRS_EVENTO,
};

// ===== NF-e modelo 55 — webservices PRÓPRIOS (diferentes da NFC-e 65) =====
// Mesmo critério multi-estado/override. Confirmar na homologação de cada UF.
const NFE_SVRS = {
  hom: "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  prod: "https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
};
const NFE_AUTORIZADOR: Record<string, { hom: string; prod: string }> = {
  BA: { hom: "https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx", prod: "https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx" },
  SP: { hom: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx", prod: "https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx" },
  RS: NFE_SVRS,
  AC: NFE_SVRS, AL: NFE_SVRS, AP: NFE_SVRS, DF: NFE_SVRS, ES: NFE_SVRS, MA: NFE_SVRS, PA: NFE_SVRS, PB: NFE_SVRS,
  PI: NFE_SVRS, RJ: NFE_SVRS, RN: NFE_SVRS, RO: NFE_SVRS, RR: NFE_SVRS, SC: NFE_SVRS, SE: NFE_SVRS, TO: NFE_SVRS,
};
const NFE_SVRS_EVENTO = {
  hom: "https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  prod: "https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
};
const NFE_EVENTO: Record<string, { hom: string; prod: string }> = {
  BA: { hom: "https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx", prod: "https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx" },
  SP: { hom: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx", prod: "https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx" },
  RS: NFE_SVRS_EVENTO,
  AC: NFE_SVRS_EVENTO, AL: NFE_SVRS_EVENTO, AP: NFE_SVRS_EVENTO, DF: NFE_SVRS_EVENTO, ES: NFE_SVRS_EVENTO, MA: NFE_SVRS_EVENTO, PA: NFE_SVRS_EVENTO, PB: NFE_SVRS_EVENTO,
  PI: NFE_SVRS_EVENTO, RJ: NFE_SVRS_EVENTO, RN: NFE_SVRS_EVENTO, RO: NFE_SVRS_EVENTO, RR: NFE_SVRS_EVENTO, SC: NFE_SVRS_EVENTO, SE: NFE_SVRS_EVENTO, TO: NFE_SVRS_EVENTO,
};

@Injectable()
export class NfceService {
  private readonly logger = new Logger("NFCe");
  private readonly env = loadEnv();
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly notifications: NotificationService) {}

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, isOrgAdmin: ctx.isOrgAdmin }; }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }
  private dec(enc: string): string {
    const [iv, tag, ct] = enc.split(":");
    const key = createHash("sha256").update(`${this.env.COOKIE_SECRET}:fiscal`).digest();
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64")); d.setAuthTag(Buffer.from(tag!, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8");
  }
  private xml(s: any): string { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!)); }
  private cents(n: bigint | number): string { return (Number(n) / 100).toFixed(2); }

  /** Dígito verificador da chave (módulo 11, pesos 2..9). */
  private dv(chave43: string): string {
    let peso = 2, soma = 0;
    for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11; const d = 11 - r; return String(d >= 10 ? 0 : d);
  }

  /** Monta a chave de acesso (44) + cNF aleatório. */
  private montarChave(cuf: string, dataEmi: Date, cnpj: string, serie: number, nNF: number, mod = "65") {
    const aamm = `${String(dataEmi.getFullYear()).slice(2)}${String(dataEmi.getMonth() + 1).padStart(2, "0")}`;
    const cNF = String(randomInt(0, 99999999)).padStart(8, "0");
    const base = cuf + aamm + cnpj.padStart(14, "0") + mod + String(serie).padStart(3, "0") + String(nNF).padStart(9, "0") + "1" + cNF;
    return { chave: base + this.dv(base), cNF };
  }

  /** Extrai chave privada + certificado (PEM) do .pfx + devolve o .pfx bruto p/ o mTLS. */
  private async loadCert(certKey: string, passEnc: string) {
    const pfx = (await this.storage.getPrivate(certKey)).body;
    const pass = this.dec(passEnc);
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), pass);
    const KEYBAG = forge.pki.oids.pkcs8ShroudedKeyBag as string; const CERTBAG = forge.pki.oids.certBag as string;
    const key = (p12.getBags({ bagType: KEYBAG })[KEYBAG] ?? [])[0]?.key;
    const cert = (p12.getBags({ bagType: CERTBAG })[CERTBAG] ?? [])[0]?.cert;
    if (!key || !cert) throw new AppError(ErrorCode.ValidationFailed, "Certificado inválido", 400);
    return { keyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey), certPem: forge.pki.certificateToPem(cert), certDer: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()), pfx, pass };
  }

  private tpag(method: string): string {
    return ({ cash: "01", pix: "17", card_full: "03", card_installments: "03", debit: "04", credit: "05" } as Record<string, string>)[method] ?? "99";
  }

  /** Monta o XML da NFC-e (modelo 65, layout 4.00). Caso comum: Simples Nacional (CSOSN). */
  private buildNFe(cfg: any, sale: any, items: any[], chave: string, cNF: string, dataEmi: Date): string {
    const cuf = CUF[cfg.uf] ?? "35";
    const ide = `<ide><cUF>${cuf}</cUF><cNF>${cNF}</cNF><natOp>VENDA</natOp><mod>65</mod><serie>${cfg.nfceSerie}</serie><nNF>${cfg.nfceNext}</nNF>`
      + `<dhEmi>${this.dhIso(dataEmi)}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${this.digits(cfg.cmun)}</cMunFG>`
      + `<tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${cfg.ambiente}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>yugo-1.0</verProc></ide>`;
    const emit = `<emit><CNPJ>${this.digits(cfg.cnpj)}</CNPJ><xNome>${this.xml(cfg.razaoSocial)}</xNome>${cfg.nomeFantasia ? `<xFant>${this.xml(cfg.nomeFantasia)}</xFant>` : ""}`
      + `<enderEmit><xLgr>${this.xml(cfg.logradouro)}</xLgr><nro>${this.xml(cfg.numero || "S/N")}</nro>${cfg.bairro ? `<xBairro>${this.xml(cfg.bairro)}</xBairro>` : ""}<cMun>${this.digits(cfg.cmun)}</cMun><xMun>${this.xml(cfg.municipio)}</xMun><UF>${cfg.uf}</UF>${cfg.cep ? `<CEP>${this.digits(cfg.cep)}</CEP>` : ""}<cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit>`
      + `<IE>${this.digits(cfg.ie)}</IE><CRT>${cfg.crt}</CRT></emit>`;
    let det = ""; let vProd = 0;
    items.forEach((it: any, i: number) => {
      const p = it.product ?? {};
      const vUn = Number(it.unitPriceCents) / 100; const vLine = Number(it.lineTotalCents) / 100; vProd += vLine;
      const imposto = cfg.crt === 3
        ? `<ICMS><ICMS00><orig>${p.origem ?? 0}</orig><CST>${p.cst || "00"}</CST><modBC>0</modBC><vBC>0.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS>`
        : `<ICMS><ICMSSN102><orig>${p.origem ?? 0}</orig><CSOSN>${p.csosn || "102"}</CSOSN></ICMSSN102></ICMS>`;
      det += `<det nItem="${i + 1}"><prod><cProd>${this.xml(p.sku || it.productId || (i + 1))}</cProd><cEAN>${p.barcode || "SEM GTIN"}</cEAN><xProd>${this.xml(cfg.ambiente === 2 && i === 0 ? "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : it.productName)}</xProd>`
        + `<NCM>${this.digits(p.ncm) || "00000000"}</NCM>${p.cest ? `<CEST>${this.digits(p.cest)}</CEST>` : ""}<CFOP>${this.digits(p.cfop) || "5102"}</CFOP><uCom>${this.xml(p.unidade || "UN")}</uCom><qCom>${it.qty.toFixed ? it.qty.toFixed(4) : Number(it.qty).toFixed(4)}</qCom><vUnCom>${vUn.toFixed(2)}</vUnCom><vProd>${vLine.toFixed(2)}</vProd>`
        + `<cEANTrib>${p.barcode || "SEM GTIN"}</cEANTrib><uTrib>${this.xml(p.unidade || "UN")}</uTrib><qTrib>${Number(it.qty).toFixed(4)}</qTrib><vUnTrib>${vUn.toFixed(2)}</vUnTrib><indTot>1</indTot></prod><imposto>${imposto}<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`;
    });
    const vNF = (Number(sale.totalCents) / 100);
    const total = `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vProd.toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${vNF.toFixed(2)}</vNF></ICMSTot></total>`;
    const transp = `<transp><modFrete>9</modFrete></transp>`;
    const pag = `<pag><detPag><tPag>${this.tpag(sale.paymentMethod)}</tPag><vPag>${vNF.toFixed(2)}</vPag></detPag></pag>`;
    const infNFe = `<infNFe versao="4.00" Id="NFe${chave}">${ide}${emit}${det}${total}${transp}${pag}</infNFe>`;
    return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;
  }

  /** Monta o XML da NF-e modelo 55 (layout 4.00) com destinatário. tpImp=1 (DANFE retrato). */
  private buildNFe55(cfg: any, sale: any, items: any[], dest: any, chave: string, cNF: string, dataEmi: Date, natOp: string, indPres: number): string {
    const cuf = CUF[cfg.uf] ?? "35";
    const idDest = (dest.uf && dest.uf !== cfg.uf) ? 2 : 1; // 1=interna, 2=interestadual
    const homolog = cfg.ambiente === 2;
    const ide = `<ide><cUF>${cuf}</cUF><cNF>${cNF}</cNF><natOp>${this.xml(natOp)}</natOp><mod>55</mod><serie>${cfg.nfeSerie}</serie><nNF>${cfg.nfeNext}</nNF>`
      + `<dhEmi>${this.dhIso(dataEmi)}</dhEmi><tpNF>1</tpNF><idDest>${idDest}</idDest><cMunFG>${this.digits(cfg.cmun)}</cMunFG>`
      + `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${cfg.ambiente}</tpAmb><finNFe>1</finNFe><indFinal>${dest.indFinal ?? 1}</indFinal><indPres>${indPres}</indPres><procEmi>0</procEmi><verProc>yugo-1.0</verProc></ide>`;
    const emit = `<emit><CNPJ>${this.digits(cfg.cnpj)}</CNPJ><xNome>${this.xml(cfg.razaoSocial)}</xNome>${cfg.nomeFantasia ? `<xFant>${this.xml(cfg.nomeFantasia)}</xFant>` : ""}`
      + `<enderEmit><xLgr>${this.xml(cfg.logradouro)}</xLgr><nro>${this.xml(cfg.numero || "S/N")}</nro>${cfg.bairro ? `<xBairro>${this.xml(cfg.bairro)}</xBairro>` : ""}<cMun>${this.digits(cfg.cmun)}</cMun><xMun>${this.xml(cfg.municipio)}</xMun><UF>${cfg.uf}</UF>${cfg.cep ? `<CEP>${this.digits(cfg.cep)}</CEP>` : ""}<cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit>`
      + `<IE>${this.digits(cfg.ie)}</IE><CRT>${cfg.crt}</CRT></emit>`;
    // destinatário — em homologação o nome é fixo por norma (sem valor fiscal)
    const doc = this.digits(dest.documento);
    const isCnpj = doc.length === 14;
    const xNomeDest = homolog ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : (dest.nome || "Consumidor");
    const indIE = Number(dest.indIEDest ?? (isCnpj ? 1 : 9)); // 1=contribuinte, 2=isento, 9=não contribuinte
    const ieDest = indIE === 1 && dest.ie ? `<IE>${this.digits(dest.ie)}</IE>` : "";
    const enderDest = (dest.logradouro || dest.cmun) ? `<enderDest><xLgr>${this.xml(dest.logradouro || "S/N")}</xLgr><nro>${this.xml(dest.numero || "S/N")}</nro>${dest.bairro ? `<xBairro>${this.xml(dest.bairro)}</xBairro>` : ""}<cMun>${this.digits(dest.cmun)}</cMun><xMun>${this.xml(dest.municipio)}</xMun><UF>${dest.uf}</UF>${dest.cep ? `<CEP>${this.digits(dest.cep)}</CEP>` : ""}<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>` : "";
    const destBlock = `<dest>${isCnpj ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<xNome>${this.xml(xNomeDest)}</xNome>${enderDest}<indIEDest>${indIE}</indIEDest>${ieDest}${dest.email ? `<email>${this.xml(dest.email)}</email>` : ""}</dest>`;
    let det = ""; let vProd = 0;
    items.forEach((it: any, i: number) => {
      const p = it.product ?? {};
      const vUn = Number(it.unitPriceCents) / 100; const vLine = Number(it.lineTotalCents) / 100; vProd += vLine;
      const imposto = cfg.crt === 3
        ? `<ICMS><ICMS00><orig>${p.origem ?? 0}</orig><CST>${p.cst || "00"}</CST><modBC>0</modBC><vBC>0.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS>`
        : `<ICMS><ICMSSN102><orig>${p.origem ?? 0}</orig><CSOSN>${p.csosn || "102"}</CSOSN></ICMSSN102></ICMS>`;
      det += `<det nItem="${i + 1}"><prod><cProd>${this.xml(p.sku || it.productId || (i + 1))}</cProd><cEAN>${p.barcode || "SEM GTIN"}</cEAN><xProd>${this.xml(it.productName)}</xProd>`
        + `<NCM>${this.digits(p.ncm) || "00000000"}</NCM>${p.cest ? `<CEST>${this.digits(p.cest)}</CEST>` : ""}<CFOP>${this.digits(p.cfop) || (idDest === 2 ? "6102" : "5102")}</CFOP><uCom>${this.xml(p.unidade || "UN")}</uCom><qCom>${Number(it.qty).toFixed(4)}</qCom><vUnCom>${vUn.toFixed(2)}</vUnCom><vProd>${vLine.toFixed(2)}</vProd>`
        + `<cEANTrib>${p.barcode || "SEM GTIN"}</cEANTrib><uTrib>${this.xml(p.unidade || "UN")}</uTrib><qTrib>${Number(it.qty).toFixed(4)}</qTrib><vUnTrib>${vUn.toFixed(2)}</vUnTrib><indTot>1</indTot></prod><imposto>${imposto}<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`;
    });
    const vNF = (Number(sale.totalCents) / 100);
    const total = `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vProd.toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${vNF.toFixed(2)}</vNF></ICMSTot></total>`;
    const transp = `<transp><modFrete>9</modFrete></transp>`;
    const pag = `<pag><detPag><tPag>${this.tpag(sale.paymentMethod)}</tPag><vPag>${vNF.toFixed(2)}</vPag></detPag></pag>`;
    const infNFe = `<infNFe versao="4.00" Id="NFe${chave}">${ide}${emit}${destBlock}${det}${total}${transp}${pag}</infNFe>`;
    return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;
  }

  private dhIso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    const off = -d.getTimezoneOffset(); const sign = off >= 0 ? "+" : "-"; const oh = p(Math.floor(Math.abs(off) / 60)); const om = p(Math.abs(off) % 60);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`;
  }

  /** Assina um elemento (XML-DSig, RSA-SHA1, enveloped) com o A1. Default: infNFe. */
  private sign(xml: string, keyPem: string, certDer: string, localName = "infNFe"): string {
    const xpath = `//*[local-name(.)='${localName}']`;
    const sig = new SignedXml({ privateKey: keyPem, publicCert: certDer, signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315" });
    sig.addReference({
      xpath,
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
      digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    });
    sig.computeSignature(xml, { location: { reference: xpath, action: "after" } });
    return sig.getSignedXml();
  }

  /** QR Code NFC-e (versão 2): monta a URL com hash do CSC. */
  private qrCode(cfg: any, chave: string, dhEmi: Date, vNF: string, digVal: string, cscToken: string, urlConsulta: string): string {
    const params = `${chave}|2|${cfg.ambiente}|${cfg.cscId}`;
    const hash = createHash("sha1").update(params + cscToken).digest("hex").toUpperCase();
    return `${urlConsulta}?p=${params}|${hash}`;
  }

  /** Emite a NFC-e a partir de uma venda do PDV (homologação por padrão). */
  async emitFromSale(ctx: RequestContext, saleId: string) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg?.a1CertKey || !cfg?.a1PassEnc) throw new AppError(ErrorCode.ValidationFailed, "Configure o certificado A1 antes de emitir", 400);
    if (!cfg.cnpj || !cfg.ie || !cfg.uf || !cfg.cmun) throw new AppError(ErrorCode.ValidationFailed, "Complete os dados do emitente (CNPJ, IE, UF, município)", 400);
    if (!cfg.cscId || !cfg.cscTokenEnc) throw new AppError(ErrorCode.ValidationFailed, "Configure o CSC (idCSC + token) da SEFAZ", 400);
    const sale = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.sale.findFirst({ where: { id: saleId }, include: { items: true } }));
    if (!sale) throw new AppError(ErrorCode.NotFound, "Venda não encontrada", 404);
    const prodIds = sale.items.map((i: any) => i.productId).filter(Boolean);
    const prods = prodIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { id: { in: prodIds } } })) : [];
    const prodMap = new Map(prods.map((p: any) => [p.id, p]));
    const items = sale.items.map((i: any) => ({ ...i, product: i.productId ? prodMap.get(i.productId) : null }));

    const dataEmi = new Date();
    const cuf = CUF[cfg.uf] ?? "35";
    const { chave, cNF } = this.montarChave(cuf, dataEmi, this.digits(cfg.cnpj), cfg.nfceSerie, cfg.nfceNext);
    const { keyPem, certDer, pfx, pass } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const xmlNFe = this.buildNFe(cfg, sale, items, chave, cNF, dataEmi);
    const signed = this.sign(xmlNFe, keyPem, certDer);

    // doc rascunho/assinado
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.create({
      data: { organizationId: orgId, storeId: sale.storeId, saleId: sale.id, modelo: "65", serie: cfg.nfceSerie, numero: cfg.nfceNext, chave, ambiente: cfg.ambiente, status: "assinada", totalCents: Number(sale.totalCents) },
    }));
    // incrementa o próximo número
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.update({ where: { organizationId: orgId }, data: { nfceNext: { increment: 1 } } }));

    // transmite (mTLS: o A1 vai no handshake)
    const result = await this.transmit(cfg, signed, pfx, pass).catch((e) => ({ ok: false, cStat: "999", xMotivo: `falha transmissão: ${(e as Error).message}`.slice(0, 250), nProt: null as string | null, xml: null as string | null }));
    const autorizada = result.cStat === "100" || result.cStat === "150";
    let xmlKey: string | null = null;
    if (autorizada && (result.xml || signed)) {
      const { key } = await this.storage.putPrivate({ keyPrefix: `fiscal/nfce/${orgId}`, contentType: "application/xml", body: Buffer.from(result.xml || signed, "utf8") });
      xmlKey = key;
    }
    const cscToken = this.dec(cfg.cscTokenEnc);
    const qr = autorizada ? this.qrCode(cfg, chave, dataEmi, this.cents(sale.totalCents), "", cscToken, this.qrConsultaUrl(cfg)) : null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: autorizada ? "autorizada" : "rejeitada", protocolo: result.nProt, motivo: `${result.cStat} ${result.xMotivo}`.slice(0, 250), xmlKey, qrUrl: qr, authorizedAt: autorizada ? new Date() : null },
    }));
    return { id: doc.id, chave, status: autorizada ? "autorizada" : "rejeitada", cStat: result.cStat, xMotivo: result.xMotivo, protocolo: result.nProt, qr };
  }

  /**
   * Emite NF-e modelo 55 (com destinatário) a partir de uma venda. O destinatário
   * vem do formulário (pré-preenchido pelo cliente da venda) — exige documento, nome,
   * município (cMun IBGE) e UF. Numeração/série próprias da NF-e (independente da NFC-e).
   */
  async emitNfe55(ctx: RequestContext, input: { saleId: string; dest: any; natOp?: string; indPres?: number }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg?.a1CertKey || !cfg?.a1PassEnc) throw new AppError(ErrorCode.ValidationFailed, "Configure o certificado A1 antes de emitir", 400);
    if (!cfg.cnpj || !cfg.ie || !cfg.uf || !cfg.cmun) throw new AppError(ErrorCode.ValidationFailed, "Complete os dados do emitente (CNPJ, IE, UF, município)", 400);
    const dest = input.dest ?? {};
    const docDest = this.digits(dest.documento);
    if (docDest.length !== 11 && docDest.length !== 14) throw new AppError(ErrorCode.ValidationFailed, "Informe o CPF (11) ou CNPJ (14) do destinatário", 400);
    if (!dest.uf || !this.digits(dest.cmun)) throw new AppError(ErrorCode.ValidationFailed, "Informe UF e código IBGE do município do destinatário", 400);
    const sale = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.sale.findFirst({ where: { id: input.saleId }, include: { items: true } }));
    if (!sale) throw new AppError(ErrorCode.NotFound, "Venda não encontrada", 404);
    const prodIds = sale.items.map((i: any) => i.productId).filter(Boolean);
    const prods = prodIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { id: { in: prodIds } } })) : [];
    const prodMap = new Map(prods.map((p: any) => [p.id, p]));
    const items = sale.items.map((i: any) => ({ ...i, product: i.productId ? prodMap.get(i.productId) : null }));

    const dataEmi = new Date();
    const cuf = CUF[cfg.uf] ?? "35";
    const { chave, cNF } = this.montarChave(cuf, dataEmi, this.digits(cfg.cnpj), cfg.nfeSerie, cfg.nfeNext, "55");
    const { keyPem, certDer, pfx, pass } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const xmlNFe = this.buildNFe55(cfg, sale, items, dest, chave, cNF, dataEmi, input.natOp || "VENDA", Number(input.indPres ?? 1));
    const signed = this.sign(xmlNFe, keyPem, certDer);

    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.create({
      data: { organizationId: orgId, storeId: sale.storeId, saleId: sale.id, modelo: "55", serie: cfg.nfeSerie, numero: cfg.nfeNext, chave, ambiente: cfg.ambiente, status: "assinada", totalCents: Number(sale.totalCents) },
    }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.update({ where: { organizationId: orgId }, data: { nfeNext: { increment: 1 } } }));

    const result = await this.transmit55(cfg, signed, pfx, pass);
    const autorizada = result.cStat === "100" || result.cStat === "150";
    let xmlKey: string | null = null;
    if (autorizada) {
      const { key } = await this.storage.putPrivate({ keyPrefix: `fiscal/nfe/${orgId}`, contentType: "application/xml", body: Buffer.from(signed, "utf8") });
      xmlKey = key;
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: autorizada ? "autorizada" : "rejeitada", protocolo: result.nProt, motivo: `${result.cStat} ${result.xMotivo}`.slice(0, 250), xmlKey, authorizedAt: autorizada ? new Date() : null },
    }));
    return { id: doc.id, chave, modelo: "55", status: autorizada ? "autorizada" : "rejeitada", cStat: result.cStat, xMotivo: result.xMotivo, protocolo: result.nProt };
  }

  /** Transmite a NF-e (55) ao NFeAutorizacao4 do autorizador NF-e (síncrono, mTLS). */
  private async transmit55(cfg: any, signedXml: string, pfx: Buffer, pass: string): Promise<{ cStat: string; xMotivo: string; nProt: string | null }> {
    const enviNFe = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${signedXml}</enviNFe>`;
    const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    try {
      const { text } = await this.soapPost(this.nfeAutorizadorUrl(cfg), soap, pfx, pass);
      const j = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(text);
      const ret = j?.Envelope?.Body?.nfeResultMsg?.retEnviNFe ?? {};
      const prot = ret?.protNFe?.infProt ?? {};
      return { cStat: String(prot.cStat ?? ret.cStat ?? "999"), xMotivo: String(prot.xMotivo ?? ret.xMotivo ?? "sem retorno"), nProt: prot.nProt ? String(prot.nProt) : null };
    } catch (e) {
      return { cStat: "999", xMotivo: `falha transmissão NF-e: ${(e as Error).message}`.slice(0, 250), nProt: null };
    }
  }

  private qrConsultaUrl(cfg: any): string {
    // URL de consulta do QR Code por UF da empresa. Fallback SP enquanto a UF não tiver entrada.
    const fallback = { hom: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode", prod: "https://www.nfce.fazenda.sp.gov.br/qrcode" };
    const uf = QR_CONSULTA[cfg.uf] ?? fallback;
    return uf[cfg.ambiente === 2 ? "hom" : "prod"];
  }

  /** Resolve a URL do autorizador NFC-e (65): override da empresa > mapa por UF > SVRS. */
  private autorizadorUrl(cfg: any): string {
    const override = cfg.ambiente === 2 ? cfg.nfceUrlHom : cfg.nfceUrlProd;
    if (override) return override;
    return (AUTORIZADOR[cfg.uf] ?? SVRS)[cfg.ambiente === 2 ? "hom" : "prod"];
  }

  /** Resolve a URL do autorizador NF-e (55): override da empresa > mapa por UF > SVRS. */
  private nfeAutorizadorUrl(cfg: any): string {
    const override = cfg.ambiente === 2 ? cfg.nfeUrlHom : cfg.nfeUrlProd;
    if (override) return override;
    return (NFE_AUTORIZADOR[cfg.uf] ?? NFE_SVRS)[cfg.ambiente === 2 ? "hom" : "prod"];
  }

  /** POST SOAP 1.2 com mTLS (o A1 vai no handshake). Retorna o texto cru da resposta. */
  private soapPost(urlStr: string, soap: string, pfx: Buffer, pass: string): Promise<{ statusCode: number; text: string }> {
    const url = new URL(urlStr);
    const body = Buffer.from(soap, "utf8");
    // rejeitar o cert do servidor (cadeia ICP-Brasil) pode falhar em alguns Node;
    // controlável por env enquanto não embarcamos o bundle ICP-Brasil.
    const rejectUnauthorized = process.env.FISCAL_TLS_REJECT_UNAUTHORIZED === "1";
    return new Promise((resolve, reject) => {
      const req = https.request(
        { method: "POST", host: url.hostname, port: url.port || 443, path: url.pathname + url.search, pfx, passphrase: pass, rejectUnauthorized,
          headers: { "Content-Type": "application/soap+xml; charset=utf-8", "Content-Length": body.length } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.setTimeout(20000, () => { req.destroy(new Error("timeout SEFAZ")); });
      req.on("error", reject);
      req.write(body); req.end();
    });
  }

  /** Transmite ao NFeAutorizacao4 (SOAP síncrono) com mTLS. */
  private async transmit(cfg: any, signedXml: string, pfx: Buffer, pass: string): Promise<{ ok: boolean; cStat: string; xMotivo: string; nProt: string | null; xml: string | null }> {
    const enviNFe = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${signedXml}</enviNFe>`;
    const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    try {
      const { statusCode, text } = await this.soapPost(this.autorizadorUrl(cfg), soap, pfx, pass);
      const j = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(text);
      const ret = j?.Envelope?.Body?.nfeResultMsg?.retEnviNFe ?? {};
      const prot = ret?.protNFe?.infProt ?? {};
      const cStat = String(prot.cStat ?? ret.cStat ?? "999");
      const xMotivo = String(prot.xMotivo ?? ret.xMotivo ?? "sem retorno");
      return { ok: statusCode < 300, cStat, xMotivo, nProt: prot.nProt ? String(prot.nProt) : null, xml: null };
    } catch (e) {
      return { ok: false, cStat: "999", xMotivo: `falha transmissão: ${(e as Error).message}`.slice(0, 250), nProt: null, xml: null };
    }
  }

  /** Resolve a URL do serviço de evento (cancelamento) conforme o modelo (55/65). */
  private eventoUrl(cfg: any, modelo = "65"): string {
    const amb = cfg.ambiente === 2 ? "hom" : "prod";
    if (modelo === "55") return (NFE_EVENTO[cfg.uf] ?? NFE_SVRS_EVENTO)[amb];
    return (EVENTO[cfg.uf] ?? SVRS_EVENTO)[amb];
  }

  /**
   * Cancela uma NFC-e autorizada (evento tpEvento=110111). Janela legal: até 24h
   * da autorização na maioria das UFs (a SEFAZ valida e devolve o cStat). Justificativa
   * obrigatória de 15 a 255 caracteres.
   */
  async cancelNfce(ctx: RequestContext, docId: string, justificativa: string) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const just = String(justificativa ?? "").trim();
    if (just.length < 15 || just.length > 255) throw new AppError(ErrorCode.ValidationFailed, "Justificativa deve ter entre 15 e 255 caracteres", 400);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg?.a1CertKey || !cfg?.a1PassEnc) throw new AppError(ErrorCode.ValidationFailed, "Configure o certificado A1", 400);
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento fiscal não encontrado", 404);
    if (doc.status !== "autorizada") throw new AppError(ErrorCode.ValidationFailed, "Só é possível cancelar uma NFC-e autorizada", 400);
    if (!doc.chave || !doc.protocolo) throw new AppError(ErrorCode.ValidationFailed, "Documento sem chave/protocolo de autorização", 400);

    const cuf = CUF[cfg.uf ?? ""] ?? "35";
    const dh = this.dhIso(new Date());
    const idEvt = `ID110111${doc.chave}01`;
    const detEvento = `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${this.xml(doc.protocolo)}</nProt><xJust>${this.xml(just)}</xJust></detEvento>`;
    const infEvento = `<infEvento Id="${idEvt}"><cOrgao>${cuf}</cOrgao><tpAmb>${doc.ambiente}</tpAmb><CNPJ>${this.digits(cfg.cnpj)}</CNPJ><chNFe>${doc.chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>${detEvento}</infEvento>`;
    const evento = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEvento}</evento>`;
    const { keyPem, certDer, pfx, pass } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const signed = this.sign(evento, keyPem, certDer, "infEvento");
    const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${signed}</envEvento>`;
    const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

    let cStat = "999"; let xMotivo = "sem retorno"; let nProt: string | null = null;
    try {
      const { text } = await this.soapPost(this.eventoUrl(cfg, doc.modelo), soap, pfx, pass);
      const j = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(text);
      const ret = j?.Envelope?.Body?.nfeResultMsg?.retEnvEvento ?? {};
      const inf = ret?.retEvento?.infEvento ?? ret?.retEvento?.[0]?.infEvento ?? {};
      cStat = String(inf.cStat ?? ret.cStat ?? "999");
      xMotivo = String(inf.xMotivo ?? ret.xMotivo ?? "sem retorno");
      nProt = inf.nProt ? String(inf.nProt) : null;
    } catch (e) {
      xMotivo = `falha no cancelamento: ${(e as Error).message}`.slice(0, 250);
    }
    // 135/136 = evento registrado e vinculado / registrado fora de prazo
    const cancelada = cStat === "135" || cStat === "136" || cStat === "155";
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({
      where: { id: doc.id },
      data: cancelada ? { status: "cancelada", cancelMotivo: just, motivo: `${cStat} ${xMotivo}`.slice(0, 250), protocolo: nProt ?? doc.protocolo } : { motivo: `cancelamento ${cStat} ${xMotivo}`.slice(0, 250) },
    }));
    return { id: doc.id, status: cancelada ? "cancelada" : doc.status, cStat, xMotivo, nProt };
  }

  /**
   * Carta de Correção (CC-e, tpEvento=110110). Corrige erros que NÃO mudem valores de
   * imposto, remetente/destinatário ou data. Texto de 15 a 1000 caracteres. Cada CC-e
   * usa um nSeqEvento crescente (1..20) — informe `nSeq` para correções subsequentes.
   */
  async correcaoNfe(ctx: RequestContext, docId: string, correcao: string, nSeq = 1) {
    this.requireAdmin(ctx);
    const corr = String(correcao ?? "").trim();
    if (corr.length < 15 || corr.length > 1000) throw new AppError(ErrorCode.ValidationFailed, "A correção deve ter entre 15 e 1000 caracteres", 400);
    const seq = Math.min(20, Math.max(1, Number(nSeq) || 1));
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    if (!cfg?.a1CertKey || !cfg?.a1PassEnc) throw new AppError(ErrorCode.ValidationFailed, "Configure o certificado A1", 400);
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento fiscal não encontrado", 404);
    if (doc.status !== "autorizada") throw new AppError(ErrorCode.ValidationFailed, "Só é possível corrigir uma nota autorizada", 400);
    if (!doc.chave) throw new AppError(ErrorCode.ValidationFailed, "Documento sem chave de autorização", 400);

    const cuf = CUF[cfg.uf ?? ""] ?? "35";
    const dh = this.dhIso(new Date());
    const xCondUso = "A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.";
    const idEvt = `ID110110${doc.chave}${String(seq).padStart(2, "0")}`;
    const detEvento = `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${this.xml(corr)}</xCorrecao><xCondUso>${xCondUso}</xCondUso></detEvento>`;
    const infEvento = `<infEvento Id="${idEvt}"><cOrgao>${cuf}</cOrgao><tpAmb>${doc.ambiente}</tpAmb><CNPJ>${this.digits(cfg.cnpj)}</CNPJ><chNFe>${doc.chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>110110</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>${detEvento}</infEvento>`;
    const evento = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEvento}</evento>`;
    const { keyPem, certDer, pfx, pass } = await this.loadCert(cfg.a1CertKey, cfg.a1PassEnc);
    const signed = this.sign(evento, keyPem, certDer, "infEvento");
    const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${signed}</envEvento>`;
    const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

    let cStat = "999"; let xMotivo = "sem retorno"; let nProt: string | null = null;
    try {
      const { text } = await this.soapPost(this.eventoUrl(cfg, doc.modelo), soap, pfx, pass);
      const j = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(text);
      const ret = j?.Envelope?.Body?.nfeResultMsg?.retEnvEvento ?? {};
      const inf = ret?.retEvento?.infEvento ?? ret?.retEvento?.[0]?.infEvento ?? {};
      cStat = String(inf.cStat ?? ret.cStat ?? "999");
      xMotivo = String(inf.xMotivo ?? ret.xMotivo ?? "sem retorno");
      nProt = inf.nProt ? String(inf.nProt) : null;
    } catch (e) {
      xMotivo = `falha na correção: ${(e as Error).message}`.slice(0, 250);
    }
    const registrada = cStat === "135" || cStat === "136";
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.update({
      where: { id: doc.id },
      data: { motivo: `CC-e #${seq} ${cStat} ${xMotivo}`.slice(0, 250) },
    }));
    return { id: doc.id, nSeq: seq, registrada, cStat, xMotivo, nProt };
  }

  /** Gera o DANFCe (cupom) em PDF a partir de um documento fiscal autorizado. */
  async danfce(ctx: RequestContext, docId: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireAdmin(ctx);
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento fiscal não encontrado", 404);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalConfig.findFirst({ where: {} }));
    const sale = doc.saleId ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.sale.findFirst({ where: { id: doc.saleId! }, include: { items: true } })) : null;
    if (doc.modelo === "55") {
      const buffer = await this.renderDanfe55(cfg, doc, sale);
      return { buffer, filename: `danfe-${doc.numero ?? doc.id.slice(0, 8)}.pdf` };
    }
    const qrPng = doc.qrUrl ? await QRCode.toBuffer(doc.qrUrl, { type: "png", margin: 1, width: 200 }).catch(() => null) : null;
    const buffer = await this.renderDanfce(cfg, doc, sale, qrPng);
    return { buffer, filename: `danfce-${doc.numero ?? doc.id.slice(0, 8)}.pdf` };
  }

  /**
   * Envia o DANFE/DANFCe (PDF) + XML autorizado ao cliente por WhatsApp e/ou e-mail.
   * Contato vem do cliente da venda; pode ser sobrescrito por email/whatsapp no input.
   */
  async sendToCustomer(ctx: RequestContext, docId: string, override?: { email?: string | null; whatsapp?: string | null }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { id: docId } }));
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento fiscal não encontrado", 404);
    if (doc.status !== "autorizada") throw new AppError(ErrorCode.ValidationFailed, "Só é possível enviar uma nota autorizada", 400);
    const storeId = doc.storeId;
    if (!storeId) throw new AppError(ErrorCode.ValidationFailed, "Documento sem loja vinculada", 400);

    // contato do cliente da venda (com override do operador)
    let customer: any = null;
    if (doc.saleId) {
      const sale = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.sale.findFirst({ where: { id: doc.saleId! }, select: { customerId: true } }));
      if (sale?.customerId) customer = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: sale.customerId! }, select: { id: true, name: true, email: true, phone: true, whatsappPhone: true } }));
    }
    const email = (override?.email ?? customer?.email) || null;
    const whatsapp = (override?.whatsapp ?? customer?.whatsappPhone ?? customer?.phone) || null;
    if (!email && !whatsapp) throw new AppError(ErrorCode.ValidationFailed, "Informe e-mail ou WhatsApp do cliente", 400);

    // gera o PDF (DANFE/DANFCe) e publica num link
    const { buffer, filename } = await this.danfce(ctx, docId);
    const { url: pdfUrl } = await this.storage.putPublic({ keyPrefix: `fiscal/danfe/${orgId}`, contentType: "application/pdf", body: buffer, originalName: filename });
    // XML autorizado (se houver) também publicado pro cliente importar
    let xmlUrl: string | null = null;
    if (doc.xmlKey) {
      try {
        const xml = await this.storage.getPrivate(doc.xmlKey);
        const r = await this.storage.putPublic({ keyPrefix: `fiscal/xml/${orgId}`, contentType: "application/xml", body: xml.body, originalName: `${doc.chave ?? "nota"}.xml` });
        xmlUrl = r.url;
      } catch { /* segue só com o PDF */ }
    }

    const label = doc.modelo === "55" ? "NF-e" : "NFC-e";
    const nome = (customer?.name ?? "").split(" ")[0];
    const text = `Olá${nome ? " " + nome : ""}! Segue a sua nota fiscal (${label}) da sua compra.`
      + (doc.chave ? `\nChave: ${doc.chave}` : "")
      + (xmlUrl ? `\nXML: ${xmlUrl}` : "");
    const html = `<p>Olá${nome ? " " + this.xml(nome) : ""}! Segue a sua nota fiscal (<b>${label}</b>) da sua compra.</p>`
      + (doc.chave ? `<p style="font-size:12px;color:#555">Chave: ${doc.chave}</p>` : "")
      + (xmlUrl ? `<p><a href="${xmlUrl}" target="_blank" rel="noopener">Baixar XML</a></p>` : "");

    const r = await this.notifications.notify({
      organizationId: orgId, storeId, customerId: customer?.id ?? null,
      whatsappPhone: whatsapp, email,
      subject: `Sua nota fiscal (${label})`, text, html,
      templateCode: "nota_fiscal",
      media: { url: pdfUrl, fileName: filename, mediatype: "document" },
    });
    return { sent: r, pdfUrl, xmlUrl };
  }

  private renderDanfce(cfg: any, doc: any, sale: any, qrPng: Buffer | null): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const W = 226; // ~80mm
      const pdf = new PDFDocument({ size: [W, 800], margin: 10 });
      const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      const M = 10, innerW = W - M * 2;
      const center = (t: string, size = 7, font = "Helvetica") => { pdf.font(font).fontSize(size).fillColor("#000").text(t, M, undefined as any, { width: innerW, align: "center" }); };
      const line = () => { const y = pdf.y + 2; pdf.moveTo(M, y).lineTo(W - M, y).dash(1, { space: 1 }).strokeColor("#000").lineWidth(0.5).stroke().undash(); pdf.moveDown(0.5); };

      center(String(cfg?.razaoSocial || cfg?.nomeFantasia || "Emitente"), 8, "Helvetica-Bold");
      if (cfg?.cnpj) center(`CNPJ ${cfg.cnpj}  IE ${cfg.ie ?? ""}`, 6);
      if (cfg?.logradouro) center(`${cfg.logradouro}, ${cfg.numero ?? "S/N"} - ${cfg.bairro ?? ""}`, 6);
      if (cfg?.municipio) center(`${cfg.municipio}/${cfg.uf ?? ""}`, 6);
      line();
      center("DANFE NFC-e - Documento Auxiliar", 6, "Helvetica-Bold");
      center("da Nota Fiscal de Consumidor Eletrônica", 6);
      if (doc.ambiente === 2) center("*** HOMOLOGAÇÃO - SEM VALOR FISCAL ***", 6, "Helvetica-Bold");
      line();

      // itens
      pdf.font("Helvetica-Bold").fontSize(6).fillColor("#000").text("ITEM  DESCRIÇÃO", M, undefined as any, { width: innerW });
      pdf.font("Helvetica").fontSize(6);
      const items = sale?.items ?? [];
      items.forEach((it: any, i: number) => {
        const qtd = Number(it.qty ?? 1);
        const vUn = Number(it.unitPriceCents ?? 0) / 100;
        const vTot = Number(it.lineTotalCents ?? 0) / 100;
        pdf.text(`${String(i + 1).padStart(3, "0")} ${it.productName ?? "Item"}`, M, undefined as any, { width: innerW });
        pdf.text(`     ${qtd} x ${vUn.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} = ${vTot.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, M, undefined as any, { width: innerW });
      });
      line();
      const total = Number(doc.totalCents ?? sale?.totalCents ?? 0) / 100;
      pdf.font("Helvetica-Bold").fontSize(8).text(`TOTAL R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, M, undefined as any, { width: innerW, align: "right" });
      line();

      if (doc.chave) { center("Consulte pela Chave de Acesso em", 5); center(this.qrConsultaBase(cfg), 5); center(String(doc.chave).replace(/(\d{4})/g, "$1 ").trim(), 6, "Helvetica-Bold"); }
      if (doc.protocolo) center(`Protocolo de autorização: ${doc.protocolo}`, 5);
      if (doc.authorizedAt) center(new Date(doc.authorizedAt).toLocaleString("pt-BR"), 5);
      line();
      if (qrPng) { const qs = 120; pdf.image(qrPng, (W - qs) / 2, pdf.y + 2, { width: qs, height: qs }); pdf.y += qs + 6; }
      else center("(QR Code indisponível — nota não autorizada)", 5);
      pdf.end();
    });
  }

  private qrConsultaBase(cfg: any): string {
    try { return new URL(this.qrConsultaUrl(cfg)).host; } catch { return ""; }
  }

  /** DANFE A4 (retrato) da NF-e modelo 55, com código de barras CODE128 da chave. */
  private renderDanfe55(cfg: any, doc: any, sale: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 28 });
      const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      const M = 28, W = pdf.page.width, right = W - M, innerW = right - M;
      const box = (x: number, y: number, w: number, h: number) => pdf.rect(x, y, w, h).strokeColor("#000").lineWidth(0.7).stroke();
      const label = (t: string, x: number, y: number, size = 5) => pdf.font("Helvetica").fontSize(size).fillColor("#444").text(t, x + 3, y + 2, { lineBreak: false });
      const value = (t: string, x: number, y: number, size = 8, font = "Helvetica-Bold") => pdf.font(font).fontSize(size).fillColor("#000").text(t ?? "", x + 3, y + 9, { width: 1000, lineBreak: false });

      // ===== cabeçalho: emitente | identificação =====
      let y = M;
      const colEmitW = innerW * 0.56;
      box(M, y, colEmitW, 80);
      pdf.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(String(cfg?.razaoSocial || cfg?.nomeFantasia || "Emitente"), M + 6, y + 8, { width: colEmitW - 12 });
      pdf.font("Helvetica").fontSize(7).fillColor("#222");
      pdf.text(`${cfg?.logradouro ?? ""}, ${cfg?.numero ?? "S/N"}${cfg?.bairro ? " - " + cfg.bairro : ""}`, M + 6, undefined as any, { width: colEmitW - 12 });
      pdf.text(`${cfg?.municipio ?? ""}/${cfg?.uf ?? ""}  CEP ${cfg?.cep ?? ""}`, M + 6, undefined as any, { width: colEmitW - 12 });
      pdf.text(`CNPJ ${cfg?.cnpj ?? ""}   IE ${cfg?.ie ?? ""}`, M + 6, undefined as any, { width: colEmitW - 12 });

      const colId = M + colEmitW; const colIdW = innerW - colEmitW;
      box(colId, y, colIdW, 80);
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("DANFE", colId, y + 6, { width: colIdW, align: "center" });
      pdf.font("Helvetica").fontSize(6).text("Documento Auxiliar da Nota Fiscal Eletrônica", colId, y + 20, { width: colIdW, align: "center" });
      pdf.font("Helvetica-Bold").fontSize(7).text("1 - SAÍDA", colId, y + 32, { width: colIdW, align: "center" });
      pdf.font("Helvetica-Bold").fontSize(8).text(`Nº ${String(doc.numero ?? "").padStart(9, "0")}   Série ${doc.serie ?? ""}`, colId, y + 44, { width: colIdW, align: "center" });
      pdf.font("Helvetica").fontSize(7).text(`Modelo 55${doc.ambiente === 2 ? "  ·  HOMOLOGAÇÃO" : ""}`, colId, y + 58, { width: colIdW, align: "center" });

      // ===== barra do código de barras (chave) =====
      y += 86;
      box(M, y, innerW, 56);
      if (doc.chave) {
        try { this.drawCode128(pdf, String(doc.chave), M + 8, y + 6, innerW - 16, 30); } catch { /* ignora */ }
        pdf.font("Helvetica").fontSize(7).fillColor("#000").text(String(doc.chave).replace(/(\d{4})(?=\d)/g, "$1 "), M, y + 40, { width: innerW, align: "center" });
      }
      // ===== natureza / protocolo =====
      y += 62;
      box(M, y, innerW, 26);
      label("NATUREZA DA OPERAÇÃO", M, y); value("VENDA", M, y, 8);
      label("PROTOCOLO DE AUTORIZAÇÃO", M + innerW * 0.55, y);
      value(`${doc.protocolo ?? "—"}${doc.authorizedAt ? "  " + new Date(doc.authorizedAt).toLocaleString("pt-BR") : ""}`, M + innerW * 0.55, y, 7, "Helvetica");

      // ===== destinatário =====
      y += 32;
      box(M, y, innerW, 26);
      pdf.font("Helvetica-Bold").fontSize(6).fillColor("#000").text("DESTINATÁRIO / REMETENTE", M + 3, y + 2);
      pdf.font("Helvetica").fontSize(8).fillColor("#000").text("Conforme XML autorizado (consulte pela chave acima)", M + 3, y + 11, { width: innerW - 6 });

      // ===== itens =====
      y += 32;
      const cols = [
        { t: "CÓD", w: innerW * 0.10 }, { t: "DESCRIÇÃO", w: innerW * 0.44 }, { t: "QTD", w: innerW * 0.12 },
        { t: "V.UNIT", w: innerW * 0.17 }, { t: "V.TOTAL", w: innerW * 0.17 },
      ];
      box(M, y, innerW, 16);
      let cx = M; pdf.font("Helvetica-Bold").fontSize(6).fillColor("#000");
      cols.forEach((c) => { pdf.text(c.t, cx + 3, y + 5, { width: c.w - 6, lineBreak: false }); cx += c.w; });
      y += 16;
      const items = sale?.items ?? [];
      pdf.font("Helvetica").fontSize(7);
      items.forEach((it: any, i: number) => {
        const rowH = 14;
        box(M, y, innerW, rowH);
        const vUn = Number(it.unitPriceCents ?? 0) / 100, vTot = Number(it.lineTotalCents ?? 0) / 100;
        const vals = [String(i + 1).padStart(3, "0"), it.productName ?? "Item", String(Number(it.qty ?? 1)), vUn.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), vTot.toLocaleString("pt-BR", { minimumFractionDigits: 2 })];
        cx = M; cols.forEach((c, k) => { pdf.fillColor("#000").text(vals[k]!, cx + 3, y + 4, { width: c.w - 6, lineBreak: false }); cx += c.w; });
        y += rowH;
      });

      // ===== total =====
      box(M, y, innerW, 22);
      const total = Number(doc.totalCents ?? sale?.totalCents ?? 0) / 100;
      pdf.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(`VALOR TOTAL DA NOTA   R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, M, y + 6, { width: innerW - 8, align: "right" });

      if (doc.ambiente === 2) { y += 30; pdf.font("Helvetica-Bold").fontSize(9).fillColor("#b00").text("AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL", M, y, { width: innerW, align: "center" }); }
      pdf.end();
    });
  }

  // ===== CODE128 (subset B/C) — barra de código da chave de acesso (44 dígitos) =====
  private static readonly C128 = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112",
  ];

  /** Desenha CODE128-C (chave numérica par) no PDF. */
  private drawCode128(pdf: any, data: string, x: number, y: number, maxW: number, h: number) {
    const codes: number[] = [105]; // Start C
    for (let i = 0; i < data.length; i += 2) codes.push(Number(data.substr(i, 2)));
    let sum = codes[0]!; codes.forEach((c, i) => { if (i > 0) sum += c * i; });
    codes.push(sum % 103); // check digit
    codes.push(106); // stop
    const patterns = codes.map((c) => NfceService.C128[c]!).join("");
    const totalUnits = patterns.split("").reduce((a, b) => a + Number(b), 0);
    const unit = Math.min(1.6, maxW / totalUnits);
    let cx = x; let bar = true;
    for (const ch of patterns) {
      const w = Number(ch) * unit;
      if (bar) pdf.rect(cx, y, w, h).fillColor("#000").fill();
      cx += w; bar = !bar;
    }
  }
}
