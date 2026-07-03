import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export interface EmployeeContext {
  employeeId: string;
  organizationId: string;
  storeId: string | null;
  name: string;
  cpf: string;
}

declare module "fastify" {
  interface FastifyRequest {
    employee?: EmployeeContext;
  }
}

export const CurrentEmployee = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EmployeeContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.employee) throw new Error("Sessão de funcionário não resolvida");
    return req.employee;
  },
);
