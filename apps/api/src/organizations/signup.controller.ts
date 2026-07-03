import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/decorators";
import { OrganizationsService } from "./organizations.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";

const SignupSchema = z.object({
  organization: z.object({
    name: z.string().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
    contactEmail: z.string().email().max(320).optional(),
    contactPhone: z.string().max(30).optional(),
  }),
  owner: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(320),
    password: z
      .string()
      .min(12)
      .max(256)
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
        message: "Inclua maiuscula, minuscula e numero",
      }),
  }),
  store: z.object({
    name: z.string().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
    city: z.string().max(80).optional(),
    state: z.string().length(2).optional(),
  }),
  planSlug: z.string().min(1),
});

@Controller("signup")
export class SignupController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async signup(@Body() body: unknown) {
    const input = SignupSchema.parse(body);

    const created = await this.orgs.create({
      platformUserId: "self-signup",
      input: {
        slug: input.organization.slug,
        name: input.organization.name,
        contactEmail: input.organization.contactEmail ?? input.owner.email,
        contactPhone: input.organization.contactPhone ?? null,
        firstUser: {
          email: input.owner.email,
          name: input.owner.name,
          password: input.owner.password,
        },
        firstStore: {
          slug: input.store.slug,
          name: input.store.name,
          city: input.store.city ?? null,
          state: input.store.state ?? null,
        },
        autoProvision: false, // self-signup nao provisiona externos automaticamente
      },
    });

    const subscription = await this.subs.assignPlan({
      organizationId: created.organization.id,
      planSlug: input.planSlug,
    });

    return {
      organization: {
        id: created.organization.id,
        slug: created.organization.slug,
        name: created.organization.name,
      },
      user: created.user,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
      },
    };
  }
}
