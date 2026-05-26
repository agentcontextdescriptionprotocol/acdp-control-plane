 
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POLICY_ACTION_KEY } from './check-policy.decorator';
import {
  PolicyDecider,
  PolicyDecision,
  PolicyDecisions,
} from './policy-decider';
import { PolicyGuard } from './policy.guard';

function ctx(req: any, _action?: string): ExecutionContext {
  const handler = function fakeHandler() {};
  class FakeClass {}
  return {
    getHandler: jest.fn().mockReturnValue(handler),
    getClass: jest.fn().mockReturnValue(FakeClass),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  } as unknown as ExecutionContext;
}

function newReflector(action: string | undefined): Reflector {
  const r: any = new Reflector();
  // Pre-stub the metadata lookup so we don't have to wire @SetMetadata.
  jest
    .spyOn(r, 'getAllAndOverride')
    .mockImplementation((...args: unknown[]) =>
      args[0] === POLICY_ACTION_KEY ? action : undefined,
    );
  return r as Reflector;
}

class StubDecider implements PolicyDecider {
  constructor(private readonly result: PolicyDecision) {}
  async decide(): Promise<PolicyDecision> {
    return this.result;
  }
}

describe('PolicyGuard', () => {
  it('passes through handlers without @CheckPolicy()', async () => {
    const g = new PolicyGuard(newReflector(undefined), new StubDecider(PolicyDecisions.deny('audience', 'no')));
    expect(await g.canActivate(ctx({ actorId: 'x' }))).toBe(true);
  });

  it('allow → returns true', async () => {
    const g = new PolicyGuard(newReflector('context.retrieve'), new StubDecider(PolicyDecisions.allow()));
    expect(await g.canActivate(ctx({ actorId: 'did:web:alice' }))).toBe(true);
  });

  it('deny → throws ForbiddenException with structured reason', async () => {
    const g = new PolicyGuard(
      newReflector('context.retrieve'),
      new StubDecider(PolicyDecisions.deny('audience', 'not in audience')),
    );
    await expect(
      g.canActivate(ctx({ actorId: 'did:web:alice' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('indeterminate → also denies (with note in body)', async () => {
    const g = new PolicyGuard(
      newReflector('context.retrieve'),
      new StubDecider(PolicyDecisions.indeterminate('no rule')),
    );
    await expect(
      g.canActivate(ctx({ actorId: 'did:web:alice' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('no decider registered → open-by-default with a warn log', async () => {
    const g = new PolicyGuard(newReflector('context.retrieve'));
    expect(await g.canActivate(ctx({ actorId: 'x' }))).toBe(true);
  });

  it('builds PolicyRequest from actorId / tenantId / params', async () => {
    let observed: any = null;
    const sink: PolicyDecider = {
      async decide(req): Promise<PolicyDecision> {
        observed = req;
        return PolicyDecisions.allow();
      },
    };
    const g = new PolicyGuard(newReflector('capability.declare'), sink);
    await g.canActivate(
      ctx({
        actorId: 'did:web:alice',
        tenantId: 'tenant-A',
        params: { runId: 'r-123' },
      }),
    );
    expect(observed.subjectDid).toBe('did:web:alice');
    expect(observed.tenantId).toBe('tenant-A');
    expect(observed.action).toBe('capability.declare');
    expect(observed.resourceId).toBe('r-123');
  });

  it('joins array params (ctxId from path-to-regexp v6 wildcard)', async () => {
    let observed: any = null;
    const sink: PolicyDecider = {
      async decide(req): Promise<PolicyDecision> {
        observed = req;
        return PolicyDecisions.allow();
      },
    };
    const g = new PolicyGuard(newReflector('context.retrieve'), sink);
    await g.canActivate(
      ctx({
        actorId: 'did:web:alice',
        params: { ctxId: ['acdp:', 'r.local', 'abc'] },
      }),
    );
    expect(observed.resourceId).toBe('acdp:/r.local/abc');
  });
});
