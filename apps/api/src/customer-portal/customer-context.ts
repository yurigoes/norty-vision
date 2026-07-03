import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export interface CustomerContext {
  /** Identidade do portal = cliente (qualquer cliente, com ou sem crediario). */
  customerId: string;
  /** Conta de crediario vinculada, se houver (cliente pode nao ter). */
  creditAccountId: string | null;
  organizationId: string;
  document: string;
  holderName: string;
  /** Compat: mesmo que customerId (codigo antigo usava primaryCustomerId). */
  primaryCustomerId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    customer?: CustomerContext;
  }
}

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.customer) {
      throw new Error("Sessao de cliente nao resolvida");
    }
    return req.customer;
  },
);
