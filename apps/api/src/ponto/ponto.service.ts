import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";

export type PunchInput = { employeeId: string; pin?: string; origin?: string; device?: string; deviceAt?: string; offline?: boolean; lat?: number; lng?: number; accuracy?: number; photoUrl?: string; faceScore?: number | null; faceMatch?: boolean | null; livenessOk?: boolean | null; fraudFlags?: string[] };

/**
 * Ponto eletrônico (REP-A) — Fase 0: cadastro, marcação imutável e auditoria.
 * Cada marcação grava o HORÁRIO DO SERVIDOR, recebe um NSR sequencial por empresa
 * e um HASH ENCADEADO (sha256 do hash anterior + dados) → adulterar uma marcação
 * quebra a cadeia. Marcação nunca é alterada/apagada; ajuste é um registro novo.
 */
@Injectable()
export class PontoService {
  private readonly logger = new Logger("Ponto");
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  /** Bloqueia alteração de ponto em meses já FECHADOS (status closed). Reabra o fechamento para editar. */
  private async assertDaysNotClosed(ctx: RequestContext, days: string[]) {
    const firsts = [...new Set(days.map((d) => (d || "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].map((m) => new Date(`${m}-01T00:00:00.000Z`));
    if (!firsts.length) return;
    const closed = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.findFirst({ where: { refMonth: { in: firsts }, status: "closed" }, select: { refMonth: true } })).catch(() => null);
    if (closed) throw new AppError(ErrorCode.Forbidden, "Período fechado: não é possível alterar o ponto deste mês. Reabra o fechamento (RH) para editar.", 403);
  }
  private sha(s: string) { return createHash("sha256").update(s, "utf8").digest("hex"); }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }

  /** Dígito verificador EAN-13 sobre os 12 primeiros dígitos. */
  private ean13Check(base12: string): string {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
  }
  /** Gera um EAN-13 interno (prefixo 200) único por empresa, p/ crachá de marcação. */
  private async genBarcode(tx: any, orgId: string): Promise<string> {
    for (let tries = 0; tries < 5; tries++) {
      const rnd = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0");
      const base = `200${rnd}`; // 12 dígitos
      const code = base + this.ean13Check(base);
      const exists = await tx.pontoEmployee.findFirst({ where: { organizationId: orgId, barcode: code }, select: { id: true } });
      if (!exists) return code;
    }
    const base = `200${Date.now().toString().slice(-9).padStart(9, "0")}`;
    return base + this.ean13Check(base);
  }

  /** Consome um NSR da sequência única da empresa (atômico). Todo registro do AFD
   *  com NSR próprio (empregador tipo 2, empregado tipo 5, marcação tipo 7) usa isto. */
  /** NSR sequencial POR EMPREGADOR (cada CNPJ tem a sua sequência, sem gaps). */
  private async consumeNsr(tx: any, employerId: string): Promise<bigint> {
    const e = await tx.pontoEmployer.update({ where: { id: employerId }, data: { lastNsr: { increment: 1 } }, select: { lastNsr: true } });
    return e.lastNsr as bigint;
  }
  /** Resolve o empregador para a marcação/registro: o explícito, senão o DEFAULT
   *  da org (cria um a partir do ponto_config se ainda não existir). Nunca retorna null. */
  private async resolveEmployerId(tx: any, orgId: string, explicit?: string | null): Promise<string> {
    if (explicit) return explicit;
    const def = await tx.pontoEmployer.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (def) return def.id;
    const any = await tx.pontoEmployer.findFirst({ select: { id: true } });
    if (any) return any.id;
    const cfg = await tx.pontoConfig.findFirst({ select: { razaoOuNome: true, tpIdtEmpregador: true, idtEmpregador: true, caepf: true, lastNsr: true } });
    const created = await tx.pontoEmployer.create({ data: { organizationId: orgId, name: (cfg?.razaoOuNome || "Empregador"), tpIdtEmpregador: cfg?.tpIdtEmpregador ?? 1, idtEmpregador: cfg?.idtEmpregador ?? null, caepf: cfg?.caepf ?? null, lastNsr: cfg?.lastNsr ?? 0n, isDefault: true } });
    return created.id;
  }

  // ----- CONFIG do empregador -----
  async getConfig(ctx: RequestContext) {
    this.requireOrg(ctx);
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {} }));
    return {
      tpIdtEmpregador: c?.tpIdtEmpregador ?? 1, idtEmpregador: c?.idtEmpregador ?? "", caepf: c?.caepf ?? "", cno: c?.cno ?? "",
      razaoOuNome: c?.razaoOuNome ?? "", repAProcesso: c?.repAProcesso ?? "", timezone: c?.timezone ?? "-0300",
      localPrestacao: c?.localPrestacao ?? "", responsavelCpf: c?.responsavelCpf ?? "",
      devTpIdt: c?.devTpIdt ?? 1, devIdt: c?.devIdt ?? "",
      faceProvider: c?.faceProvider ?? "none", faceProviderUrl: c?.faceProviderUrl ?? "", faceProviderKeySet: !!c?.faceProviderKey,
      faceThreshold: c?.faceThreshold ?? 60, requireFace: c?.requireFace ?? false, requireLiveness: c?.requireLiveness ?? false, faceEnforce: c?.faceEnforce ?? false,
      nightReducedHour: c?.nightReducedHour ?? true, dsrLossEnabled: c?.dsrLossEnabled ?? true,
      bgImageUrl: c?.bgImageUrl ?? "", bgUntil: c?.bgUntil ?? null,
      webhookUrl: c?.webhookUrl ?? "", webhookSecretSet: !!c?.webhookSecret,
      alertsEnabled: c?.alertsEnabled ?? true, alertWhatsapp: c?.alertWhatsapp ?? "", alertEmail: c?.alertEmail ?? "",
      alertSummaryHour: c?.alertSummaryHour ?? 20, overtimeWeeklyAlertMin: c?.overtimeWeeklyAlertMin ?? 600,
      bankExpiryMonths: c?.bankExpiryMonths ?? 6,
      showBankToEmployee: c?.showBankToEmployee ?? true,
      requestsRestrictHours: c?.requestsRestrictHours ?? false,
      requestsWindowStart: c?.requestsWindowStart ?? "08:00",
      requestsWindowEnd: c?.requestsWindowEnd ?? "18:00",
      requestsWindowDays: c?.requestsWindowDays ?? "1,2,3,4,5",
      requestsRestrictMachine: c?.requestsRestrictMachine ?? false,
      assidBonusCents: c?.assidBonusCents != null ? Number(c.assidBonusCents) : 15000,
      assidMaxAtestadoDays: c?.assidMaxAtestadoDays ?? 2,
      assidMaxLates: c?.assidMaxLates ?? 4,
      assidBlockMeasure: c?.assidBlockMeasure ?? true,
      assidBlockFalta: c?.assidBlockFalta ?? true,
      assidProportional: c?.assidProportional ?? true,
      accountantEmail: c?.accountantEmail ?? "",
    };
  }
  async updateConfig(ctx: RequestContext, input: { tpIdtEmpregador?: number; idtEmpregador?: string; caepf?: string; cno?: string; razaoOuNome?: string; repAProcesso?: string; timezone?: string; localPrestacao?: string; responsavelCpf?: string; devTpIdt?: number; devIdt?: string; faceProvider?: string; faceProviderUrl?: string; faceProviderKey?: string; faceThreshold?: number; requireFace?: boolean; requireLiveness?: boolean; faceEnforce?: boolean; nightReducedHour?: boolean; dsrLossEnabled?: boolean; bgImageUrl?: string; bgUntil?: string | null; webhookUrl?: string; webhookSecret?: string; alertsEnabled?: boolean; alertWhatsapp?: string; alertEmail?: string; alertSummaryHour?: number; overtimeWeeklyAlertMin?: number; bankExpiryMonths?: number; showBankToEmployee?: boolean; requestsRestrictHours?: boolean; requestsWindowStart?: string; requestsWindowEnd?: string; requestsWindowDays?: string; requestsRestrictMachine?: boolean; assidBonusCents?: number; assidMaxAtestadoDays?: number; assidMaxLates?: number; assidBlockMeasure?: boolean; assidBlockFalta?: boolean; assidProportional?: boolean; accountantEmail?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const data: any = {};
    if (input.tpIdtEmpregador !== undefined) data.tpIdtEmpregador = input.tpIdtEmpregador === 2 ? 2 : 1;
    if (input.idtEmpregador !== undefined) data.idtEmpregador = this.digits(input.idtEmpregador) || null;
    if (input.caepf !== undefined) data.caepf = this.digits(input.caepf) || null;
    if (input.cno !== undefined) data.cno = this.digits(input.cno) || null;
    if (input.razaoOuNome !== undefined) data.razaoOuNome = (input.razaoOuNome || "").slice(0, 150) || null;
    if (input.repAProcesso !== undefined) data.repAProcesso = this.digits(input.repAProcesso) || null;
    if (input.timezone !== undefined) data.timezone = (input.timezone || "-0300").slice(0, 5);
    if (input.localPrestacao !== undefined) data.localPrestacao = (input.localPrestacao || "").slice(0, 100) || null;
    if (input.responsavelCpf !== undefined) data.responsavelCpf = this.digits(input.responsavelCpf) || null;
    if (input.devTpIdt !== undefined) data.devTpIdt = input.devTpIdt === 2 ? 2 : 1;
    if (input.devIdt !== undefined) data.devIdt = this.digits(input.devIdt) || null;
    if (input.faceProvider !== undefined) data.faceProvider = ["none", "http"].includes(input.faceProvider) ? input.faceProvider : "none";
    if (input.faceProviderUrl !== undefined) data.faceProviderUrl = (input.faceProviderUrl || "").slice(0, 500) || null;
    if (input.faceProviderKey !== undefined && input.faceProviderKey !== "") data.faceProviderKey = input.faceProviderKey.slice(0, 500);
    if (input.faceThreshold !== undefined) data.faceThreshold = Math.max(0, Math.min(100, input.faceThreshold));
    if (input.requireFace !== undefined) data.requireFace = !!input.requireFace;
    if (input.requireLiveness !== undefined) data.requireLiveness = !!input.requireLiveness;
    if (input.faceEnforce !== undefined) data.faceEnforce = !!input.faceEnforce;
    if (input.nightReducedHour !== undefined) data.nightReducedHour = !!input.nightReducedHour;
    if (input.dsrLossEnabled !== undefined) data.dsrLossEnabled = !!input.dsrLossEnabled;
    if (input.bgImageUrl !== undefined) data.bgImageUrl = input.bgImageUrl || null;
    if (input.bgUntil !== undefined) data.bgUntil = input.bgUntil ? new Date(input.bgUntil) : null;
    if (input.webhookUrl !== undefined) data.webhookUrl = (input.webhookUrl || "").slice(0, 500) || null;
    if (input.webhookSecret !== undefined && input.webhookSecret !== "") data.webhookSecret = input.webhookSecret.slice(0, 200);
    if (input.alertsEnabled !== undefined) data.alertsEnabled = !!input.alertsEnabled;
    if (input.alertWhatsapp !== undefined) data.alertWhatsapp = this.digits(input.alertWhatsapp) || null;
    if (input.alertEmail !== undefined) data.alertEmail = (input.alertEmail || "").slice(0, 200) || null;
    if (input.alertSummaryHour !== undefined) data.alertSummaryHour = Math.max(0, Math.min(23, Math.trunc(Number(input.alertSummaryHour) || 20)));
    if (input.overtimeWeeklyAlertMin !== undefined) data.overtimeWeeklyAlertMin = Math.max(0, Math.trunc(Number(input.overtimeWeeklyAlertMin) || 600));
    if (input.bankExpiryMonths !== undefined) data.bankExpiryMonths = Math.max(0, Math.min(36, Math.trunc(Number(input.bankExpiryMonths) || 6)));
    if (input.showBankToEmployee !== undefined) data.showBankToEmployee = !!input.showBankToEmployee;
    if (input.requestsRestrictHours !== undefined) data.requestsRestrictHours = !!input.requestsRestrictHours;
    if (input.requestsWindowStart !== undefined) data.requestsWindowStart = /^\d{2}:\d{2}$/.test(input.requestsWindowStart) ? input.requestsWindowStart : "08:00";
    if (input.requestsWindowEnd !== undefined) data.requestsWindowEnd = /^\d{2}:\d{2}$/.test(input.requestsWindowEnd) ? input.requestsWindowEnd : "18:00";
    if (input.requestsWindowDays !== undefined) data.requestsWindowDays = (input.requestsWindowDays || "").split(",").map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).join(",") || "1,2,3,4,5";
    if (input.requestsRestrictMachine !== undefined) data.requestsRestrictMachine = !!input.requestsRestrictMachine;
    if (input.assidBonusCents !== undefined) data.assidBonusCents = BigInt(Math.max(0, Math.round(Number(input.assidBonusCents) || 0)));
    if (input.assidMaxAtestadoDays !== undefined) data.assidMaxAtestadoDays = Math.max(0, Math.trunc(Number(input.assidMaxAtestadoDays) || 0));
    if (input.assidMaxLates !== undefined) data.assidMaxLates = Math.max(0, Math.trunc(Number(input.assidMaxLates) || 0));
    if (input.assidBlockMeasure !== undefined) data.assidBlockMeasure = !!input.assidBlockMeasure;
    if (input.assidBlockFalta !== undefined) data.assidBlockFalta = !!input.assidBlockFalta;
    if (input.assidProportional !== undefined) data.assidProportional = !!input.assidProportional;
    if (input.accountantEmail !== undefined) data.accountantEmail = (input.accountantEmail || "").slice(0, 200) || null;
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.pontoConfig.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, ...data } });
      // Atribui o NSR do registro de empregador (tipo 2) do empregador DEFAULT na 1ª vez.
      const employerId = await this.resolveEmployerId(tx, orgId);
      const empRow = await tx.pontoEmployer.findFirst({ where: { id: employerId }, select: { employerNsr: true } });
      if (empRow && empRow.employerNsr == null) {
        const nsr = await this.consumeNsr(tx, employerId);
        await tx.pontoEmployer.update({ where: { id: employerId }, data: { employerNsr: nsr, employerRecordedAt: new Date() } });
        await tx.pontoConfig.update({ where: { organizationId: orgId }, data: { employerNsr: nsr, employerRecordedAt: new Date() } }).catch(() => undefined);
      }
    });
    return this.getConfig(ctx);
  }

  // ----- FUNCIONÁRIOS -----
  async listEmployees(ctx: RequestContext) {
    this.requireOrg(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoEmployee.findMany({ where: {}, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true, pis: true, matricula: true, matEsocial: true, cargo: true, scheduleCode: true, storeId: true, active: true, faceRefKey: true, barcode: true, hrEmployeeId: true, allowedDeviceIds: true } }),
    );
    return rows.map(({ faceRefKey, ...e }) => ({ ...e, faceEnrolled: !!faceRefKey }));
  }
  async upsertEmployee(ctx: RequestContext, input: { id?: string; name: string; cpf?: string; pis?: string; matricula?: string; matEsocial?: string; cargo?: string; scheduleCode?: string; pin?: string; active?: boolean; allowedDeviceIds?: string[] }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Nome obrigatório", 400);
    const data: any = {
      name: input.name.trim(), cpf: this.digits(input.cpf) || null, pis: this.digits(input.pis) || null,
      matricula: (input.matricula || "").trim() || null, matEsocial: (input.matEsocial || "").trim() || null,
      cargo: (input.cargo || "").trim() || null, scheduleCode: (input.scheduleCode || "").trim() || null,
      active: input.active ?? true,
    };
    if (Array.isArray(input.allowedDeviceIds)) data.allowedDeviceIds = input.allowedDeviceIds.filter((x) => typeof x === "string").slice(0, 200);
    if (input.pin && input.pin.trim()) data.pinHash = this.sha(input.pin.trim());
    const row = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      if (input.id) {
        const cur = await tx.pontoEmployee.findFirst({ where: { id: input.id }, select: { employerId: true } });
        const employerId = await this.resolveEmployerId(tx, orgId, cur?.employerId);
        const r = await tx.pontoEmployee.update({ where: { id: input.id }, data: { ...data, employerId } });
        // Backfill: empregado pré-existente sem NSR/código de barras ganha um (na sequência do empregador).
        const patch: any = {};
        if (r.nsr == null) { patch.nsr = await this.consumeNsr(tx, employerId); patch.afdRecordedAt = new Date(); }
        if (!r.barcode) patch.barcode = await this.genBarcode(tx, orgId);
        if (Object.keys(patch).length) await tx.pontoEmployee.update({ where: { id: r.id }, data: patch });
        return r;
      }
      const employerId = await this.resolveEmployerId(tx, orgId);
      const nsr = await this.consumeNsr(tx, employerId);
      const barcode = await this.genBarcode(tx, orgId);
      return tx.pontoEmployee.create({ data: { organizationId: orgId, ...data, employerId, nsr, afdRecordedAt: new Date(), barcode } });
    });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => this.audit(tx, orgId, input.id ? "employee.update" : "employee.create", "employee", row.id, ctx.userId ?? null, null, { name: data.name }));
    return { id: row.id };
  }

  /** Define os terminais liberados de um funcionário ([] = sem restrição). */
  async setAllowedDevices(ctx: RequestContext, employeeId: string, deviceIds: string[]) {
    this.requireAdmin(ctx);
    const ids = (Array.isArray(deviceIds) ? deviceIds : []).filter((x) => typeof x === "string").slice(0, 200);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.update({ where: { id: employeeId }, data: { allowedDeviceIds: ids } }));
    return { ok: true, allowedDeviceIds: ids };
  }

  // ----- SOLICITAÇÕES DE SALDO DE BANCO (somente RH; o líder NÃO vê) -----
  /** Lista as solicitações de visualização de saldo (RH). */
  async listBankRequests(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankRequest.findMany({ where: {}, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], take: 300 }));
    const ids = [...new Set(rows.map((r) => r.pontoEmployeeId))];
    const emps = ids.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name] as const));
    return rows.map((r) => ({ id: r.id, employeeId: r.pontoEmployeeId, employeeName: nm.get(r.pontoEmployeeId) ?? "—", status: r.status, reason: r.reason, responseNote: r.responseNote, balanceMin: r.balanceMin, requestedAt: r.requestedAt, respondedAt: r.respondedAt }));
  }
  /** RH responde (aprova = libera a visualização; rejeita = nega). */
  async respondBankRequest(ctx: RequestContext, id: string, input: { approve: boolean; note?: string }) {
    this.requireAdmin(ctx);
    const req = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankRequest.findFirst({ where: { id } }));
    if (!req) throw new AppError(ErrorCode.NotFound, "Solicitação não encontrada", 404);
    let balanceMin: number | null = null;
    if (input.approve) {
      const mv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.findMany({ where: { employeeId: req.pontoEmployeeId }, select: { minutes: true } })).catch(() => [] as any[]);
      balanceMin = (mv as any[]).reduce((s, m) => s + m.minutes, 0);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankRequest.update({ where: { id }, data: { status: input.approve ? "approved" : "rejected", responseNote: (input.note || "").slice(0, 500) || null, balanceMin, respondedAt: new Date(), respondedByUserId: ctx.userId ?? null } }));
    // notifica o funcionário (WhatsApp/e-mail) — best-effort
    try {
      const pe = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: req.pontoEmployeeId }, select: { name: true, hrEmployeeId: true } }));
      let phone: string | null = null, email: string | null = null;
      if (pe?.hrEmployeeId) {
        const hr = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findFirst({ where: { id: pe.hrEmployeeId! }, select: { phone: true, whatsappPhone: true, email: true } }));
        phone = hr?.whatsappPhone || hr?.phone || null; email = hr?.email || null;
      }
      if (phone || email) {
        const first = (pe?.name || "").split(" ")[0] || "";
        const hm = (m: number) => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, "0")}`;
        const text = input.approve
          ? `Olá ${first}! O RH liberou a visualização do seu banco de horas${balanceMin != null ? ` — saldo atual: ${hm(balanceMin)}` : ""}. Acesse o portal para ver os detalhes.`
          : `Olá ${first}. Sua solicitação para ver o saldo do banco de horas foi avaliada pelo RH${input.note ? `: ${input.note}` : "."}`;
        await this.notifications.notify({ organizationId: ctx.orgId!, storeId: "", whatsappPhone: phone, email, subject: "Banco de horas — resposta do RH", text }).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    return { ok: true };
  }

  // ----- MÁQUINAS HOMOLOGADAS (libera solicitações no portal) -----
  async listMachines(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoHomologatedMachine.findMany({ where: {}, orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }], select: { id: true, label: true, lastSeenAt: true, lastSeenIp: true, revokedAt: true, createdAt: true } }));
    return rows;
  }
  /** Cria uma máquina homologada e devolve a CHAVE crua (exibida só agora). */
  async createMachine(ctx: RequestContext, label: string) {
    this.requireAdmin(ctx);
    const name = (label || "").trim().slice(0, 80); if (!name) throw new AppError(ErrorCode.ValidationFailed, "Informe um nome para a máquina", 400);
    const key = randomBytes(24).toString("base64url");
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoHomologatedMachine.create({ data: { organizationId: ctx.orgId!, label: name, keyHash: this.sha(key) }, select: { id: true } }));
    return { id: row.id, label: name, key }; // chave crua só aqui
  }
  async revokeMachine(ctx: RequestContext, id: string, revoke: boolean) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoHomologatedMachine.updateMany({ where: { id }, data: { revokedAt: revoke ? new Date() : null } }));
    return { ok: true };
  }
  /** Valida a chave de máquina para uma org (uso interno do gate). Marca lastSeen. */
  async machineValid(orgId: string, rawKey: string | null | undefined, ip?: string | null): Promise<boolean> {
    const k = (rawKey || "").trim(); if (!k) return false;
    const m = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoHomologatedMachine.findFirst({ where: { organizationId: orgId, keyHash: this.sha(k), revokedAt: null }, select: { id: true } }));
    if (!m) return false;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoHomologatedMachine.update({ where: { id: m.id }, data: { lastSeenAt: new Date(), lastSeenIp: ip ?? null } })).catch(() => undefined);
    return true;
  }

  /** Une registros de ponto duplicados (mesmo CPF): mantém o vinculado ao RH (ou o mais antigo)
   *  e migra batidas/justificativas/banco/férias/assinaturas para ele; remove os duplicados. */
  async dedupeEmployees(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const all = await tx.pontoEmployee.findMany({ where: {}, select: { id: true, cpf: true, hrEmployeeId: true, createdAt: true } });
      const byCpf = new Map<string, typeof all>();
      for (const e of all) { if (!e.cpf) continue; const g = byCpf.get(e.cpf) ?? []; g.push(e); byCpf.set(e.cpf, g); }
      let merged = 0;
      for (const [, group] of byCpf) {
        if (group.length < 2) continue;
        // mantém o que tem vínculo RH; senão o mais antigo
        const keeper = [...group].sort((a, b) => (b.hrEmployeeId ? 1 : 0) - (a.hrEmployeeId ? 1 : 0) || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()))[0]!;
        const dups = group.filter((g) => g.id !== keeper.id);
        for (const d of dups) {
          await tx.pontoPunch.updateMany({ where: { employeeId: d.id }, data: { employeeId: keeper.id } }).catch(() => undefined);
          await tx.pontoJustification.updateMany({ where: { employeeId: d.id }, data: { employeeId: keeper.id } }).catch(() => undefined);
          await tx.pontoBankMovement.updateMany({ where: { employeeId: d.id }, data: { employeeId: keeper.id } }).catch(() => undefined);
          await tx.pontoVacation.updateMany({ where: { employeeId: d.id }, data: { employeeId: keeper.id } }).catch(() => undefined);
          await tx.pontoAlertLog.deleteMany({ where: { employeeId: d.id } }).catch(() => undefined);
          // assinaturas de espelho: migra as que o keeper não tem; descarta colisões de mês
          const dupSigs = await tx.pontoEspelhoSignature.findMany({ where: { employeeId: d.id } }).catch(() => []);
          for (const s of dupSigs) {
            const has = await tx.pontoEspelhoSignature.findFirst({ where: { employeeId: keeper.id, refMonth: s.refMonth }, select: { id: true } });
            if (has) await tx.pontoEspelhoSignature.delete({ where: { id: s.id } });
            else await tx.pontoEspelhoSignature.update({ where: { id: s.id }, data: { employeeId: keeper.id } });
          }
          // herda vínculo RH e dados úteis, depois remove o duplicado
          const patch: any = {};
          if (!keeper.hrEmployeeId && d.hrEmployeeId) { patch.hrEmployeeId = d.hrEmployeeId; keeper.hrEmployeeId = d.hrEmployeeId; }
          if (Object.keys(patch).length) await tx.pontoEmployee.update({ where: { id: keeper.id }, data: patch }).catch(() => undefined);
          await tx.pontoEmployee.delete({ where: { id: d.id } }).catch(() => undefined);
          merged++;
        }
      }
      await this.audit(tx, orgId, "employee.dedupe", "employee", orgId, ctx.userId ?? null, null, { merged });
      return { ok: true, merged };
    });
  }

  /** Vincula/cria o ponto_employee a partir de um funcionário do RH (employees).
   *  Chamado quando o RH cria/atualiza um funcionário — herda os dados e gera código. */
  async syncFromHr(orgId: string, hr: { id: string; name: string; cpf?: string | null; roleTitle?: string | null; storeId?: string | null; userId?: string | null; status?: string | null; employerId?: string | null; pis?: string | null }) {
    await this.prisma.runWithContext({ orgId, isOrgAdmin: true }, async (tx) => {
      const cpf = this.digits(hr.cpf) || null;
      // empregador: usa o do HR; se faltar, cai no empregador default da conta
      let employerId = hr.employerId ?? null;
      if (!employerId) employerId = (await tx.pontoEmployer.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
      // Evita duplicar: usa o vínculo (hrEmployeeId) OU um registro manual com o MESMO CPF
      // ainda sem vínculo — nesse caso, ADOTA esse registro (liga o hrEmployeeId nele).
      const existing = await tx.pontoEmployee.findFirst({
        where: { OR: [{ hrEmployeeId: hr.id }, ...(cpf ? [{ cpf, hrEmployeeId: null } as any] : [])] },
        orderBy: { hrEmployeeId: "desc" }, // prioriza o que já tem vínculo
      });
      const base = {
        name: hr.name, cpf, cargo: hr.roleTitle ?? null, employerId, ...(hr.pis ? { pis: this.digits(hr.pis) } : {}),
        storeId: hr.storeId ?? null, userId: hr.userId ?? null, active: (hr.status ?? "active") === "active",
      };
      if (existing) { await tx.pontoEmployee.update({ where: { id: existing.id }, data: { ...base, hrEmployeeId: hr.id } }); return; }
      const nsr = await this.consumeNsr(tx, employerId ?? await this.resolveEmployerId(tx, orgId));
      const barcode = await this.genBarcode(tx, orgId);
      await tx.pontoEmployee.create({ data: { organizationId: orgId, hrEmployeeId: hr.id, ...base, nsr, afdRecordedAt: new Date(), barcode } });
    });
  }

  /** Bate o ponto pelo portal do funcionário (já autenticado): resolve o ponto_employee
   *  vinculado ao funcionário do RH e marca. Sem PIN (a sessão já autentica). */
  async punchByHrEmployee(orgId: string, hrEmployeeId: string, input: Omit<PunchInput, "employeeId" | "pin">, ip: string | null) {
    const emp = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId, active: true }, select: { id: true } }));
    if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não vinculado ao ponto", 404);
    const r = await this.punchCore(orgId, { ...input, employeeId: emp.id, origin: input.origin ?? "web" }, ip);
    const notices = await this.activeNotices(orgId, emp.id);
    return { ...r, notices };
  }

  /** Resolve um funcionário pelo identificador batido no painel: código de barras, CPF ou matrícula. */
  async resolveIdentifier(orgId: string, raw: string): Promise<{ id: string; name: string; requiresPin: boolean } | null> {
    const id = (raw ?? "").trim(); if (!id) return null;
    const dig = this.digits(id);
    const emp = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findFirst({
      where: { active: true, OR: [{ barcode: id }, { barcode: dig }, ...(dig ? [{ cpf: dig } as any] : []), { matricula: id }] },
      select: { id: true, name: true, pinHash: true },
    }));
    return emp ? { id: emp.id, name: emp.name, requiresPin: !!emp.pinHash } : null;
  }

  // ----- AVISOS (painel de marcação) -----
  async listNotices(ctx: RequestContext) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoNotice.findMany({ where: {}, orderBy: { createdAt: "desc" }, take: 200 }));
  }
  async createNotice(ctx: RequestContext, input: { employeeId?: string | null; message: string; until?: string }) {
    this.requireAdmin(ctx);
    if (!input.message?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Mensagem obrigatória", 400);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoNotice.create({
      data: { organizationId: ctx.orgId!, employeeId: input.employeeId || null, message: input.message.trim().slice(0, 500), until: input.until ? new Date(input.until) : null },
    }));
    return { id: row.id };
  }
  async deleteNotice(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoNotice.update({ where: { id }, data: { active: false } }));
    return { ok: true };
  }
  /** Avisos ativos aplicáveis: gerais + os do funcionário (se informado). */
  async activeNotices(orgId: string, employeeId?: string | null): Promise<string[]> {
    const now = new Date();
    const rows = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoNotice.findMany({
      where: { active: true, AND: [{ OR: [{ until: null }, { until: { gte: now } }] }, { OR: [{ employeeId: null }, ...(employeeId ? [{ employeeId } as any] : [])] }] },
      orderBy: { createdAt: "desc" }, take: 20, select: { message: true },
    }));
    return rows.map((r) => r.message);
  }

  // ----- MARCAÇÃO (núcleo) -----
  /** Bate o ponto: NSR + horário do servidor + hash encadeado. Retorna o comprovante. */
  async punch(ctx: RequestContext, input: PunchInput, ip?: string | null) {
    this.requireOrg(ctx);
    return this.punchCore(ctx.orgId!, input, ip ?? null, { userId: ctx.userId ?? null });
  }

  /** Núcleo da marcação reutilizável (web/admin e PWA por dispositivo). Roda no RLS da org.
   *  Offline: o horário do dispositivo (deviceAt) é a hora da marcação; o servidor grava o
   *  createdAt na sincronização e a marcação fica com offline=1 (Portaria 671). */
  async punchCore(orgId: string, input: PunchInput, ip: string | null, opts?: { userId?: string | null; device?: string; deviceId?: string | null }) {
    const res = await this.prisma.runWithContext({ orgId }, async (tx) => {
      const emp = await tx.pontoEmployee.findFirst({ where: { id: input.employeeId, active: true } });
      if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);
      if (emp.pinHash) {
        if (!input.pin || this.sha(input.pin.trim()) !== emp.pinHash) throw new AppError(ErrorCode.Unauthorized, "PIN incorreto", 401);
      }
      // NSR sequencial POR EMPREGADOR (atômico via increment) + cadeia de hash por empregador
      const employerId = await this.resolveEmployerId(tx, orgId, emp.employerId);
      const nsr = await this.consumeNsr(tx, employerId);
      const last = await tx.pontoPunch.findFirst({ where: { employerId }, orderBy: { nsr: "desc" }, select: { hash: true } });
      const prevHash = last?.hash ?? null;
      const offline = !!input.offline;
      const punchedAt = offline && input.deviceAt ? new Date(input.deviceAt) : new Date(); // offline = hora do dispositivo; senão servidor
      const hash = this.sha(`${prevHash ?? ""}|${nsr}|${emp.id}|${punchedAt.toISOString()}|O`);
      const punch = await tx.pontoPunch.create({
        data: {
          organizationId: orgId, employeeId: emp.id, employerId, nsr, punchedAt,
          deviceAt: input.deviceAt ? new Date(input.deviceAt) : null,
          origin: ["web", "pwa", "kiosk"].includes(input.origin ?? "") ? input.origin! : "web",
          source: "O", ip: ip ?? null, device: (input.device || opts?.device || "").slice(0, 120) || null, deviceId: opts?.deviceId ?? null,
          offline, lat: input.lat ?? null, lng: input.lng ?? null, accuracy: input.accuracy ?? null,
          photoUrl: input.photoUrl ?? null,
          faceScore: input.faceScore ?? null, faceMatch: input.faceMatch ?? null, livenessOk: input.livenessOk ?? null,
          fraudFlags: input.fraudFlags && input.fraudFlags.length ? input.fraudFlags : undefined,
          createdByUserId: opts?.userId ?? null, prevHash, hash,
        },
        select: { id: true, nsr: true, punchedAt: true, hash: true },
      });
      await this.audit(tx, orgId, "punch.create", "punch", punch.id, opts?.userId ?? null, ip, { nsr: String(nsr), employee: emp.name, offline });
      return { id: punch.id, nsr: String(punch.nsr), punchedAt: punch.punchedAt, hash: punch.hash, employeeName: emp.name };
    });
    this.fireWebhook(orgId, "ponto.punch.created", { nsr: res.nsr, employeeId: input.employeeId, employeeName: res.employeeName, punchedAt: res.punchedAt, origin: input.origin ?? "web", offline: !!input.offline }); // fire-and-forget
    return res;
  }

  /** Registra o evento no inbox interno da empresa (sempre) e entrega na URL externa (se houver). */
  private async fireWebhook(orgId: string, event: string, data: any) {
    try {
      const cfg = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoConfig.findFirst({ where: {}, select: { webhookUrl: true, webhookSecret: true } }));
      // 1) sempre grava no feed interno (a empresa consulta sem precisar de servidor externo)
      const ev = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoWebhookEvent.create({
        data: { organizationId: orgId, event, payload: data as any, targetUrl: cfg?.webhookUrl ?? null },
        select: { id: true },
      }));
      // 2) se houver URL externa, entrega e registra o status
      if (cfg?.webhookUrl) {
        const body = JSON.stringify({ event, orgId, at: new Date().toISOString(), data });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (cfg.webhookSecret) headers["x-ponto-signature"] = createHash("sha256").update(cfg.webhookSecret + body).digest("hex");
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
        fetch(cfg.webhookUrl, { method: "POST", headers, body, signal: ctrl.signal })
          .then((r) => this.prisma.runWithContext({ orgId }, (tx) => tx.pontoWebhookEvent.update({ where: { id: ev.id }, data: { delivered: r.ok, statusCode: r.status } })))
          .catch((e) => this.prisma.runWithContext({ orgId }, (tx) => tx.pontoWebhookEvent.update({ where: { id: ev.id }, data: { delivered: false, error: String(e?.message ?? e).slice(0, 200) } })))
          .finally(() => clearTimeout(t));
      }
    } catch { /* webhook nunca quebra a marcação */ }
  }

  /** Garante um segredo de webhook (gera na 1ª vez) e devolve info + URLs prontas pra empresa. */
  async webhookInfo(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    let cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { webhookUrl: true, webhookSecret: true } }));
    if (!cfg?.webhookSecret) {
      const secret = "whsec_" + randomBytes(24).toString("base64url");
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.upsert({ where: { organizationId: orgId }, update: { webhookSecret: secret }, create: { organizationId: orgId, webhookSecret: secret } }));
      cfg = { webhookUrl: cfg?.webhookUrl ?? null, webhookSecret: secret };
    }
    return { secret: cfg.webhookSecret, pushUrl: cfg.webhookUrl ?? "", feedUrl: "/api/ponto/eventos", events: ["ponto.punch.created"] };
  }
  /** Regenera o segredo do webhook. */
  async regenWebhookSecret(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const secret = "whsec_" + randomBytes(24).toString("base64url");
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.upsert({ where: { organizationId: ctx.orgId! }, update: { webhookSecret: secret }, create: { organizationId: ctx.orgId!, webhookSecret: secret } }));
    return { secret };
  }
  /** Feed de eventos do ponto (inbox interno por empresa). */
  async listEvents(ctx: RequestContext, opts?: { limit?: number }) {
    this.requireAdmin(ctx);
    const take = Math.min(200, Math.max(1, opts?.limit ?? 50));
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoWebhookEvent.findMany({ where: {}, orderBy: { createdAt: "desc" }, take, select: { id: true, event: true, payload: true, delivered: true, statusCode: true, targetUrl: true, createdAt: true } }));
    return { items };
  }

  /** Marcações de um funcionário num período (espelho bruto). */
  async listPunches(ctx: RequestContext, opts: { employeeId?: string; from?: string; to?: string }) {
    this.requireOrg(ctx);
    const where: any = {};
    if (opts.employeeId) where.employeeId = opts.employeeId;
    if (opts.from || opts.to) where.punchedAt = { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) };
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoPunch.findMany({ where, orderBy: { punchedAt: "desc" }, take: 1000, select: { id: true, nsr: true, employeeId: true, punchedAt: true, origin: true, source: true, offline: true, hash: true, photoUrl: true, faceScore: true, faceMatch: true, livenessOk: true, fraudFlags: true, voided: true } }),
    );
    return rows.map((r) => ({ ...r, nsr: String(r.nsr) }));
  }

  /** Comprovante de marcação (recibo) — exigência legal por batida. */
  async comprovante(ctx: RequestContext, punchId: string) {
    this.requireOrg(ctx);
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findFirst({ where: { id: punchId } }));
    if (!p) throw new AppError(ErrorCode.NotFound, "Marcação não encontrada", 404);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: p.employeeId }, select: { name: true, cpf: true, pis: true } }));
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true, idtEmpregador: true } }));
    return {
      nsr: String(p.nsr), punchedAt: p.punchedAt, hash: p.hash, origin: p.origin,
      employee: { name: emp?.name ?? "", cpf: emp?.cpf ?? null, pis: emp?.pis ?? null },
      employer: { name: cfg?.razaoOuNome ?? "", document: cfg?.idtEmpregador ?? null },
    };
  }

  /**
   * Lançamento manual de batidas pelo empregador (ajuste e migração de ponto).
   * Cada horário informado vira uma marcação nova (origin="manual", source="O")
   * no encadeamento NSR + hash — coerente com a regra "ajuste é registro novo,
   * marcação nunca é apagada". Aceita várias datas de uma vez (ajuste em massa).
   * Os horários são interpretados no fuso da empresa (PontoConfig.timezone).
   */
  async adminPunches(
    ctx: RequestContext,
    input: { employeeId: string; days: Array<{ day: string; times: string[] }>; motivo?: string | null; replaceDay?: boolean },
  ) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    await this.assertDaysNotClosed(ctx, (input.days ?? []).map((d) => d.day));
    const cfg0 = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoConfig.findFirst({ where: {}, select: { timezone: true } }),
    );
    const tz = cfg0?.timezone || "-0300";
    const offMin = (tz.startsWith("-") ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));

    // dias/horários -> instantes UTC (local = UTC + offMin  ⟹  UTC = local - offMin)
    const stamps: Date[] = [];
    for (const d of input.days ?? []) {
      const ymd = (d.day || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      for (const raw of d.times ?? []) {
        const m = /^(\d{1,2}):(\d{2})$/.exec((raw || "").trim());
        if (!m) continue;
        const hh = Number(m[1]), mm = Number(m[2]);
        if (hh > 23 || mm > 59) continue;
        const localMs = Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
        if (Number.isNaN(localMs)) continue;
        stamps.push(new Date(localMs - offMin * 60000));
      }
    }
    if (!stamps.length) throw new AppError(ErrorCode.ValidationFailed, "Nenhuma batida válida informada", 400);
    stamps.sort((a, b) => a.getTime() - b.getTime());

    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoEmployee.findFirst({ where: { id: input.employeeId, active: true }, select: { id: true, name: true, employerId: true } }),
    );
    if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);
    const motivo = (input.motivo || "ajuste do empregador").slice(0, 200);

    // REAJUSTE: anula (não apaga — Portaria 671/hash-chain) as batidas ATIVAS dos dias
    // editados, pra não duplicar. O espelho passa a considerar só as ativas (a última edição).
    let voided = 0;
    if (input.replaceDay) {
      for (const d of input.days ?? []) {
        const ymd = (d.day || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        const dayStart = new Date(Date.parse(`${ymd}T00:00:00Z`) - offMin * 60000);
        const dayEnd = new Date(dayStart.getTime() + 86400000);
        const r = await this.prisma.runWithContext({ orgId }, (tx) =>
          tx.pontoPunch.updateMany({ where: { employeeId: emp.id, punchedAt: { gte: dayStart, lt: dayEnd }, voided: false }, data: { voided: true, voidedAt: new Date(), voidedBy: ctx.userId ?? null } }),
        );
        voided += r.count;
      }
    }

    let created = 0;
    const CHUNK = 100;
    for (let i = 0; i < stamps.length; i += CHUNK) {
      const slice = stamps.slice(i, i + CHUNK);
      await this.prisma.runWithContext({ orgId }, async (tx) => {
        const employerId = await this.resolveEmployerId(tx, orgId, emp.employerId);
        for (const at of slice) {
          const nsr = await this.consumeNsr(tx, employerId);
          const last = await tx.pontoPunch.findFirst({ where: { employerId }, orderBy: { nsr: "desc" }, select: { hash: true } });
          const prevHash = last?.hash ?? null;
          const hash = this.sha(`${prevHash ?? ""}|${nsr}|${emp.id}|${at.toISOString()}|O`);
          await tx.pontoPunch.create({ data: { organizationId: orgId, employeeId: emp.id, employerId, nsr, punchedAt: at, deviceAt: null, origin: "manual", source: "O", offline: false, motivo, createdByUserId: ctx.userId ?? null, prevHash, hash } });
          created++;
        }
      });
    }
    await this.prisma.runWithContext({ orgId }, (tx) => this.audit(tx, orgId, "punch.manual", "employee", emp.id, ctx.userId ?? null, null, { count: String(created), voided: String(voided), motivo }));
    return { created, voided, employee: emp.name };
  }

  /**
   * Zera as marcações da empresa para refazer os espelhos (migração/recomeço).
   * Apaga SEMPRE ponto_punch e, conforme as flags, justificativas, banco de horas
   * e assinaturas de espelho. Org-scoped (RLS). DESTRUTIVO e irreversível — só admin.
   * NÃO mexe em fechamentos de folha nem no contador de NSR (lastNsr continua
   * monotônico; novas batidas seguem a numeração — sem conflito, pois as antigas
   * foram apagadas). O espelho é derivado das batidas, então recalcula sozinho.
   */
  async resetMarcacoes(ctx: RequestContext, opts?: { justifications?: boolean; bank?: boolean; signatures?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    return this.prisma.runWithContext({ orgId }, async (tx) => {
      const punches = (await tx.pontoPunch.deleteMany({ where: { organizationId: orgId } })).count;
      let justifications = 0, bank = 0, signatures = 0;
      if (opts?.justifications) justifications = (await tx.pontoJustification.deleteMany({ where: { organizationId: orgId } })).count;
      if (opts?.bank) bank = (await tx.pontoBankMovement.deleteMany({ where: { organizationId: orgId } })).count;
      if (opts?.signatures) signatures = (await tx.pontoEspelhoSignature.deleteMany({ where: { organizationId: orgId } })).count;
      await this.audit(tx, orgId, "punch.reset", "org", orgId, ctx.userId ?? null, null, { punches: String(punches), justifications: String(justifications), bank: String(bank), signatures: String(signatures) });
      return { punches, justifications, bank, signatures };
    });
  }

  /** Verifica a integridade da cadeia de hash das marcações (auditoria). */
  async verifyChain(ctx: RequestContext) {
    this.requireAdmin(ctx);
    // cadeia POR EMPREGADOR: ordena por (empregador, nsr) e reinicia a cada empregador
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findMany({ where: {}, orderBy: [{ employerId: "asc" }, { nsr: "asc" }], select: { nsr: true, employerId: true, employeeId: true, punchedAt: true, source: true, prevHash: true, hash: true } }));
    let prev: string | null = null;
    let curEmployer: string | null | undefined = undefined;
    for (const r of rows) {
      if (r.employerId !== curEmployer) { curEmployer = r.employerId; prev = null; } // novo empregador → nova cadeia
      const expected = this.sha(`${prev ?? ""}|${r.nsr}|${r.employeeId}|${new Date(r.punchedAt).toISOString()}|${r.source}`);
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, brokenAtNsr: String(r.nsr), total: rows.length };
      prev = r.hash;
    }
    return { ok: true, total: rows.length };
  }

  // ----- AFD: registros tipo "7" (marcação REP-P/REP-A), fixed-width 137 -----
  /** Formata data/hora no padrão DH do AFD: AAAA-MM-ddThh:mm:00ZZZZZ (24 ch). */
  private fmtDH(date: Date, tz: string): string {
    const sign = tz.startsWith("-") ? -1 : 1;
    const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    const d = new Date(date.getTime() + offMin * 60000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00${tz}`;
  }
  private coletor(origin: string): string {
    return ({ pwa: "01", web: "02", desktop: "03", kiosk: "04" } as Record<string, string>)[origin] ?? "05";
  }
  /** Data D do AFD: AAAA-MM-dd (10 ch) no fuso configurado. */
  private fmtD(date: Date, tz: string): string {
    const sign = tz.startsWith("-") ? -1 : 1;
    const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    const d = new Date(date.getTime() + offMin * 60000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  private padN(v: string | number | bigint, len: number): string { return String(v).replace(/\D/g, "").padStart(len, "0").slice(-len); }
  /** Campo alfanumérico: à esquerda, completa com espaços à direita, corta no tamanho. */
  private padA(v: string | null | undefined, len: number): string { return (v ?? "").padEnd(len, " ").slice(0, len); }

  /** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) sobre os bytes ISO-8859-1 do registro
   *  (sem o próprio campo CRC). 4 hex maiúsculos. ATENÇÃO: a variante exata exigida pela
   *  Portaria 671 precisa ser confirmada com arquivo-teste oficial; trocar aqui se divergir. */
  private crc16(s: string): string {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
      crc ^= (s.charCodeAt(i) & 0xff) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0").slice(-4);
  }

  /** Trailer tipo "9" (64 ch): "999999999" + qtd tipos 2..7 (9 cada) + "9". */
  private afdTrailer(counts: { t2: number; t3: number; t4: number; t5: number; t6: number; t7: number }): string {
    return `999999999${this.padN(counts.t2, 9)}${this.padN(counts.t3, 9)}${this.padN(counts.t4, 9)}${this.padN(counts.t5, 9)}${this.padN(counts.t6, 9)}${this.padN(counts.t7, 9)}9`;
  }

  /** Registro de assinatura digital (100 ch, tipo A) — última linha do AFD.
   *  Placeholder até a Fase 4 (assinatura real ICP-Brasil / certificado e-CNPJ A1). */
  private afdSignature(): string {
    return this.padA("ASSINATURA_DIGITAL_PENDENTE_ICP_BRASIL", 100);
  }

  /** Gera o AFD (Arquivo-Fonte de Dados) — REP-A.
   *  Monta: cabeçalho tipo 1 + [empregador tipo 2 + empregados tipo 5 + marcações tipo 7]
   *  ordenados por NSR + trailer tipo 9 + assinatura.
   *  PENDENTE (complete:false): confirmar variante do CRC-16 com arquivo-teste oficial e
   *  trocar a assinatura placeholder pela real P7S/ICP-Brasil (Fase 4). */
  async afd(ctx: RequestContext, opts: { from?: string; to?: string; employerId?: string }): Promise<{ content: string; counts: Record<string, number>; complete: boolean; missing: string[]; employer?: { id: string; name: string } }> {
    this.requireAdmin(ctx);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {} }));
    // AFD é POR EMPREGADOR (CNPJ). Sem employerId, usa o empregador padrão.
    const employer = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      opts.employerId ? tx.pontoEmployer.findFirst({ where: { id: opts.employerId } }) : tx.pontoEmployer.findFirst({ where: { isDefault: true } }),
    );
    if (!employer) throw new AppError(ErrorCode.ValidationFailed, "Empregador não encontrado (cadastre em Empregadores)", 400);
    const where: any = { employerId: employer.id };
    if (opts.from || opts.to) where.punchedAt = { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) };
    const punches = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoPunch.findMany({ where, orderBy: { nsr: "asc" }, take: 100000, select: { nsr: true, punchedAt: true, createdAt: true, origin: true, offline: true, hash: true, employeeId: true } }),
    );
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoEmployee.findMany({ where: { employerId: employer.id, nsr: { not: null } }, orderBy: { nsr: "asc" }, select: { id: true, name: true, cpf: true, nsr: true, afdRecordedAt: true } }),
    );
    const cpfOf = new Map(emps.map((e) => [e.id, this.digits(e.cpf)]));
    const tz = cfg?.timezone ?? "-0300";
    const withCrc = (rec: string) => rec + this.crc16(rec); // CRC-16 sobre o registro sem o próprio campo

    // ----- Cabeçalho tipo 1 (302 ch) — NSR fixo "000000000" -----
    const dates = punches.map((p) => new Date(p.punchedAt).getTime());
    const dIni = dates.length ? new Date(Math.min(...dates)) : new Date();
    const dFim = dates.length ? new Date(Math.max(...dates)) : new Date();
    const repNum = this.digits(cfg?.repAProcesso) ? this.padN(cfg?.repAProcesso ?? "", 17) : "9".repeat(17);
    const header = withCrc(
      "000000000" + "1" +
      String(employer.tpIdtEmpregador ?? 1) +
      this.padN(employer.idtEmpregador ?? "", 14) +
      this.padN(employer.caepf || cfg?.cno || "", 14) +
      this.padA(employer.name, 150) +
      repNum +
      this.fmtD(dIni, tz) + this.fmtD(dFim, tz) +
      this.fmtDH(new Date(), tz) +
      "003" +
      String(cfg?.devTpIdt ?? 1) +
      this.padN(cfg?.devIdt ?? "", 14) +
      this.padA("", 30),
    ); // + CRC(4) = 302

    // ----- Corpo: tipo 2 (empregador), tipo 5 (empregados), tipo 7 (marcações) por NSR -----
    const body: { nsr: bigint; line: string }[] = [];
    if (employer.employerNsr != null) {
      const rec = withCrc(
        this.padN(employer.employerNsr, 9) + "2" +
        this.fmtDH(new Date(employer.employerRecordedAt ?? new Date()), tz) +
        this.padN(cfg?.responsavelCpf ?? "", 14) +
        String(employer.tpIdtEmpregador ?? 1) +
        this.padN(employer.idtEmpregador ?? "", 14) +
        this.padN(employer.caepf || cfg?.cno || "", 14) +
        this.padA(employer.name, 150) +
        this.padA(cfg?.localPrestacao, 100),
      ); // + CRC(4) = 331
      body.push({ nsr: employer.employerNsr as bigint, line: rec });
    }
    for (const e of emps) {
      const rec = withCrc(
        this.padN(e.nsr!, 9) + "5" +
        this.fmtDH(new Date(e.afdRecordedAt ?? new Date()), tz) +
        "I" +
        this.padN(cpfOf.get(e.id) ?? "", 12) +
        this.padA(e.name, 52) +
        this.padA("", 4) +
        this.padN(cfg?.responsavelCpf ?? "", 11),
      ); // + CRC(4) = 118
      body.push({ nsr: e.nsr as bigint, line: rec });
    }
    for (const p of punches) {
      const line =
        this.padN(p.nsr, 9) + "7" +
        this.fmtDH(new Date(p.punchedAt), tz) +
        this.padN(cpfOf.get(p.employeeId) ?? "", 12) +
        this.fmtDH(new Date(p.createdAt), tz) +
        this.coletor(p.origin) +
        (p.offline ? "1" : "0") +
        this.padA(p.hash, 64); // 137 ch (tipo 7 não tem CRC — usa hash)
      body.push({ nsr: p.nsr as bigint, line });
    }
    body.sort((a, b) => (a.nsr < b.nsr ? -1 : a.nsr > b.nsr ? 1 : 0));

    const counts = { t2: employer.employerNsr != null ? 1 : 0, t3: 0, t4: 0, t5: emps.length, t6: 0, t7: punches.length };
    const lines = [header, ...body.map((r) => r.line), this.afdTrailer(counts), this.afdSignature()];
    return {
      content: lines.join("\r\n"),
      counts,
      employer: { id: employer.id, name: employer.name },
      complete: false,
      missing: ["confirmar variante do CRC-16 com arquivo-teste oficial", "assinatura real P7S/ICP-Brasil (Fase 3)"],
    };
  }

  private async audit(tx: any, orgId: string, action: string, entity: string | null, entityId: string | null, performedBy: string | null, ip: string | null, detail: any) {
    const last = await tx.pontoAudit.findFirst({ where: {}, orderBy: { createdAt: "desc" }, select: { hash: true } });
    const prev = last?.hash ?? null;
    const hash = this.sha(`${prev ?? ""}|${action}|${entityId ?? ""}|${new Date().toISOString()}`);
    await tx.pontoAudit.create({ data: { organizationId: orgId, action, entity, entityId, performedBy, ip, detail, prevHash: prev, hash } });
  }
}
