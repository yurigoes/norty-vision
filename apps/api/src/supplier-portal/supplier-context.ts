export interface SupplierContext {
  supplierId: string;
  organizationId: string;
  name: string;
  type: string;
  document: string | null;
  mustReset: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    supplier?: SupplierContext;
  }
}
