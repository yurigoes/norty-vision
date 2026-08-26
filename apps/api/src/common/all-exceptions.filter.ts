import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { Logger } from "pino";
import { AppError } from "@yugo/shared";
import { ZodError } from "zod";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<{ method?: string; url?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "Internal server error";
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = "VALIDATION_FAILED";
      const flat = exception.flatten();
      // monta mensagem amigavel com o primeiro erro
      const fieldErrors = Object.entries(flat.fieldErrors ?? {}).flatMap(
        ([field, msgs]) => (msgs ?? []).map((m) => `${field}: ${m}`),
      );
      const formErrors = flat.formErrors ?? [];
      const all = [...fieldErrors, ...formErrors];
      message = all.length > 0
        ? `Validacao falhou — ${all.join("; ")}`
        : "Validacao falhou";
      details = flat;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      message = typeof resp === "string" ? resp : (resp as any)?.message ?? exception.message;
      code = mapHttpToCode(status);
    } else if (ehIdMalFormado(exception)) {
      // um `:id` que não é uuid: `/api/credit/accounts/uma-conta-qualquer`.
      // O Prisma estoura, e isso virava 500 com o caminho do arquivo e a
      // consulta dentro da resposta. É pedido malfeito, não erro do servidor.
      status = HttpStatus.BAD_REQUEST;
      code = "BAD_REQUEST";
      message = "Identificador inválido";
    } else if (exception instanceof Error) {
      // NUNCA repassa a mensagem de um erro inesperado: ela carrega caminho de
      // arquivo, nome de tabela e trecho da consulta. Vai inteira pro log, e o
      // cliente recebe só que deu errado.
      message = "Erro interno";
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, method: req?.method, url: req?.url, status },
        "request error",
      );
    } else {
      // erro que NÓS traduzimos (não veio como AppError/Zod/HttpException) vai
      // pro log com o original junto: esconder do cliente não é esconder de
      // você. Se um dia `ehIdMalFormado` errar o alvo, o rastro está aqui.
      const traduzido =
        !(exception instanceof AppError) &&
        !(exception instanceof ZodError) &&
        !(exception instanceof HttpException);
      this.logger.warn(
        {
          ...(traduzido ? { err: exception } : {}),
          code,
          status,
          method: req?.method,
          url: req?.url,
          message,
        },
        "request rejected",
      );
    }

    reply.status(status).send({
      error: { code, message, ...(details ? { details } : {}) },
    });
  }
}

/**
 * O Prisma reclamando de um id que não é uuid.
 *
 * `P2023` é "Inconsistent column data"; a mensagem traz "invalid input syntax
 * for type uuid" (ou "Malformed ObjectID"). Duck-typing de propósito: não vale
 * acoplar o filtro global ao pacote do Prisma só por causa disto.
 */
function ehIdMalFormado(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const codigo = (e as { code?: unknown }).code;
  if (codigo === "P2023") return true;
  const msg = String((e as { message?: unknown }).message ?? "");
  return /invalid input syntax for type uuid|Malformed ObjectID|inconsistent column data/i.test(msg);
}

function mapHttpToCode(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 422: return "VALIDATION_FAILED";
    case 429: return "RATE_LIMITED";
    default:  return "INTERNAL_ERROR";
  }
}
