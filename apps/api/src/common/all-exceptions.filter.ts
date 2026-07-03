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
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, method: req?.method, url: req?.url, status },
        "request error",
      );
    } else {
      this.logger.warn(
        { code, status, method: req?.method, url: req?.url, message },
        "request rejected",
      );
    }

    reply.status(status).send({
      error: { code, message, ...(details ? { details } : {}) },
    });
  }
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
