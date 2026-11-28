// @ts-nocheck
import { ExecutionContext, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ProficiencyController } from './proficiency.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PUBLIC_KEY, ROLES_KEY } from '../common/decorators/roles.decorator';

const ROUTE_METHODS = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
};

const routes = Object.getOwnPropertyNames(ProficiencyController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => {
    const handler = ProficiencyController.prototype[name];
    const method = Reflect.getMetadata('method', handler);
    const path = Reflect.getMetadata('path', handler);
    if (method === undefined || path === undefined) return null;
    return {
      handler,
      name,
      label: `${ROUTE_METHODS[method] ?? String(method)} proficiency/${String(path).replace(/^\//, '')}`,
    };
  })
  .filter((route) => route !== null);

const makeContext = (): ExecutionContext => {
  const request = { user: { id: 'learner-1', roles: ['USER'] } };
  return {
    getHandler: () => () => undefined,
    getClass: () => ProficiencyController,
    getRequest: () => request,
    getResponse: () => ({}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as any;
};

describe('ProficiencyController authorization policy', () => {
  const reflector = new Reflector();

  it('discovers GET proficiency/summary, GET proficiency/placement-attempts and POST proficiency/placement from Nest metadata', () => {
    expect(routes.map((route) => route.label)).toEqual([
      'GET proficiency/summary',
      'GET proficiency/placement-attempts',
      'POST proficiency/placement',
    ]);
  });

  it.each(routes)('$label requires only JwtAuthGuard', ({ handler }) => {
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, ProficiencyController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
    ];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(RolesGuard);
    expect(reflector.getAllAndOverride(ROLES_KEY, [handler, ProficiencyController])).toBeUndefined();
    expect(reflector.getAllAndOverride(PUBLIC_KEY, [handler, ProficiencyController])).toBeFalsy();
    expect(makeContext().switchToHttp().getRequest().user.roles).toEqual(['USER']);
  });
});

describe('ProficiencyController delegation', () => {
  const service = {
    getSummary: jest.fn(),
    getPlacementAttempts: jest.fn(),
    submitPlacement: jest.fn(),
  };
  const controller = new ProficiencyController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('passes CurrentUser id and query parameters to the matching service methods without transformation beyond delegation', () => {
    const dto = { language: 'english', skill: 'reading', score: 8, total: 10 };
    controller.getSummary('learner-1', 'english');
    controller.getPlacementAttempts('learner-1', 'english', 'reading', 10);
    controller.submitPlacement('learner-1', dto);

    expect(service.getSummary).toHaveBeenCalledWith('learner-1', 'english');
    expect(service.getPlacementAttempts).toHaveBeenCalledWith('learner-1', {
      language: 'english',
      skill: 'reading',
      limit: 10,
    });
    expect(service.submitPlacement).toHaveBeenCalledWith('learner-1', dto);
  });
});
