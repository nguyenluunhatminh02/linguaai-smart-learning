// @ts-nocheck
import { ExecutionContext, ForbiddenException, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { ContentWorkflowController } from "./content-workflow.controller";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PUBLIC_KEY, ROLES_KEY } from "../common/decorators/roles.decorator";
import { Role } from "../users/enums/role.enum";
const ROUTE_METHODS = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.ALL]: "ALL",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
  [RequestMethod.SEARCH]: "SEARCH",
};

type Route = {
  handler: (...args: any[]) => any;
  name: string;
  label: string;
};

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const MODERATOR_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const CONTENT_ID = "00000000-0000-4000-8000-000000000010";
const SUBMISSION_ID = "00000000-0000-4000-8000-000000000020";

const sampleArgs: Record<string, any[]> = {
  list: [{ status: "PENDING", limit: 20, offset: 0 }],
  get: [SUBMISSION_ID],
  submit: [{ contentItemId: CONTENT_ID }, { id: USER_ID }],
  approve: [
    SUBMISSION_ID,
    { reviewNotes: "Looks good", version: 1 },
    { id: ADMIN_ID },
    { headers: {}, socket: {} },
  ],
  reject: [
    SUBMISSION_ID,
    { reviewNotes: "Needs work", version: 1 },
    { id: MODERATOR_ID },
    { headers: {}, socket: {} },
  ],
};

const routes: Route[] = Object.getOwnPropertyNames(ContentWorkflowController.prototype)
  .filter((name) => name !== "constructor")
  .map((name) => {
    const handler = ContentWorkflowController.prototype[name];
    const method = Reflect.getMetadata("method", handler);
    const path = Reflect.getMetadata("path", handler);
    if (method === undefined || path === undefined) return null;
    return {
      handler,
      name,
      label: `${ROUTE_METHODS[method] ?? String(method)} content-workflow/${String(path).replace(/^\//, "")}`,
    };
  })
  .filter((route): route is Route => route !== null);

const makeContext = (handler: (...args: any[]) => any, roles?: string[]): ExecutionContext => {
  const request = roles === undefined ? {} : { user: { id: "test-user", roles } };
  return {
    getHandler: () => handler,
    getClass: () => ContentWorkflowController,
    getRequest: () => request,
    getResponse: () => ({}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as any;
};

describe("ContentWorkflowController authorization policy", () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  let service: any;
  let prisma: any;
  let controller: ContentWorkflowController;
  let serviceMocks: jest.Mock[];

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      submit: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };
    prisma = { audit_logs: { create: jest.fn() } };
    controller = new ContentWorkflowController(service, prisma);
    serviceMocks = [...Object.values(service), prisma.audit_logs.create] as jest.Mock[];
  });

  it("discovers every content-workflow route from Nest metadata", () => {
    expect(routes.map((route) => route.label)).toEqual([
      "GET content-workflow/submissions",
      "GET content-workflow/submissions/:id",
      "POST content-workflow/submissions",
      "PATCH content-workflow/submissions/:id/approve",
      "PATCH content-workflow/submissions/:id/reject",
    ]);
  });

  it.each(routes)("$label declares JwtAuthGuard, RolesGuard and @Roles(ADMIN, MODERATOR)", ({ handler }) => {
    const classRoles = Reflect.getMetadata(ROLES_KEY, ContentWorkflowController) ?? [];
    const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) ?? [];
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, ContentWorkflowController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
    ];

    expect([...classRoles, ...methodRoles]).toEqual(expect.arrayContaining([Role.ADMIN, Role.MODERATOR]));
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata(PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PUBLIC_KEY, ContentWorkflowController)).toBeUndefined();
  });

  it.each(routes)("$label invokes its service only after the guard allows an ADMIN or MODERATOR", ({ handler, name }) => {
    expect(() => guard.canActivate(makeContext(handler, [Role.ADMIN]))).not.toThrow();
    expect(() => controller[name](...(sampleArgs[name] ?? []))).not.toThrow();
    expect(serviceMocks.some((mock) => mock.mock.calls.length > 0)).toBe(true);
  });

  it("rejects USER role on every content-workflow route before any service/Prisma work", () => {
    for (const route of routes) {
      expect(() => guard.canActivate(makeContext(route.handler, [Role.USER]))).toThrow(ForbiddenException);
    }
    expect(serviceMocks.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  it("rejects requests without an authenticated user on every content-workflow route", () => {
    for (const route of routes) {
      expect(() => guard.canActivate(makeContext(route.handler))).toThrow(ForbiddenException);
    }
    expect(serviceMocks.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });
});
