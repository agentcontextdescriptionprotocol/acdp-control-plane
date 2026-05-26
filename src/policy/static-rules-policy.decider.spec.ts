import {
  PolicyAction,
  PolicyDecision,
  PolicyRequest,
} from './policy-decider';
import { StaticRulesPolicyDecider } from './static-rules-policy.decider';

function req(over: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    subjectDid: 'did:web:alice',
    action: 'context.retrieve',
    resourceId: 'acdp://r/1',
    scopes: [],
    ...over,
  };
}

function assertAllow(d: PolicyDecision) {
  expect(d.kind).toBe('allow');
}
function assertDeny(d: PolicyDecision, code: string) {
  expect(d.kind).toBe('deny');
  if (d.kind === 'deny') expect(d.code).toBe(code);
}
function assertIndeterminate(d: PolicyDecision) {
  expect(d.kind).toBe('indeterminate');
}

describe('StaticRulesPolicyDecider — retrieve / visibility', () => {
  const d = new StaticRulesPolicyDecider();

  it('public + authenticated → allow', () => {
    assertAllow(d.decide(req({ resourceVisibility: 'public' })));
  });

  it('public + unauthenticated → allow (anonymous reads)', () => {
    assertAllow(d.decide(req({ subjectDid: '', resourceVisibility: 'public' })));
  });

  it('private + authenticated → deny visibility', () => {
    assertDeny(d.decide(req({ resourceVisibility: 'private' })), 'visibility');
  });

  it('restricted with subject in audience → allow', () => {
    assertAllow(
      d.decide(
        req({
          resourceVisibility: 'restricted',
          resourceAudience: ['did:web:bob', 'did:web:alice'],
        }),
      ),
    );
  });

  it('restricted with subject NOT in audience → deny audience', () => {
    assertDeny(
      d.decide(
        req({
          resourceVisibility: 'restricted',
          resourceAudience: ['did:web:bob'],
        }),
      ),
      'audience',
    );
  });

  it('restricted with empty audience → deny audience', () => {
    assertDeny(
      d.decide(req({ resourceVisibility: 'restricted', resourceAudience: [] })),
      'audience',
    );
  });

  it('retrieve without visibility → indeterminate (caller bug signal)', () => {
    assertIndeterminate(d.decide(req({ resourceVisibility: undefined })));
  });
});

describe('StaticRulesPolicyDecider — unauthenticated', () => {
  const d = new StaticRulesPolicyDecider();

  it('publish without subject → deny unauthenticated', () => {
    assertDeny(d.decide(req({ subjectDid: '', action: 'context.publish' })), 'unauthenticated');
  });

  it('list without subject → allow (default-public list endpoint)', () => {
    assertAllow(d.decide(req({ subjectDid: '', action: 'context.list' })));
  });
});

describe('StaticRulesPolicyDecider — scope gate', () => {
  it('action with required scope: subject missing it → deny scope', () => {
    const d = new StaticRulesPolicyDecider({
      requiredScopes: { 'context.publish': ['publish'] },
    });
    assertDeny(
      d.decide(req({ action: 'context.publish', scopes: ['read'] })),
      'scope',
    );
  });

  it('action with required scope: subject has it → allow', () => {
    const d = new StaticRulesPolicyDecider({
      requiredScopes: { 'context.publish': ['publish'] },
    });
    assertAllow(d.decide(req({ action: 'context.publish', scopes: ['publish'] })));
  });

  it('action without configured required scope → no scope gate', () => {
    const d = new StaticRulesPolicyDecider();
    assertAllow(d.decide(req({ action: 'context.publish' })));
  });

  it('action requires multiple scopes: subject must have all', () => {
    const d = new StaticRulesPolicyDecider({
      requiredScopes: { 'context.publish': ['publish', 'tenant:write'] },
    });
    assertDeny(
      d.decide(req({ action: 'context.publish', scopes: ['publish'] })),
      'scope',
    );
    assertAllow(
      d.decide(
        req({ action: 'context.publish', scopes: ['publish', 'tenant:write'] }),
      ),
    );
  });
});

describe('StaticRulesPolicyDecider — tenant gate (anticipates #6)', () => {
  it('no resourceTenantOf configured → tenant gate is a no-op', () => {
    const d = new StaticRulesPolicyDecider();
    assertAllow(
      d.decide(req({ action: 'context.publish', tenantId: 'tenant-A' })),
    );
  });

  it('request tenant != resource tenant → deny tenant_mismatch', () => {
    const d = new StaticRulesPolicyDecider({
      resourceTenantOf: () => 'tenant-B',
    });
    assertDeny(
      d.decide(req({ action: 'context.publish', tenantId: 'tenant-A' })),
      'tenant_mismatch',
    );
  });

  it('request tenant == resource tenant → pass tenant gate', () => {
    const d = new StaticRulesPolicyDecider({
      resourceTenantOf: () => 'tenant-A',
    });
    assertAllow(
      d.decide(
        req({ action: 'context.publish', tenantId: 'tenant-A' }),
      ),
    );
  });

  it('request without tenantId → tenant gate is a no-op (single-tenant deployments)', () => {
    const d = new StaticRulesPolicyDecider({
      resourceTenantOf: () => 'tenant-B',
    });
    assertAllow(d.decide(req({ action: 'context.publish' })));
  });
});

describe('StaticRulesPolicyDecider — non-retrieve actions default allow after gates', () => {
  const d = new StaticRulesPolicyDecider();
  it.each<PolicyAction>([
    'context.publish',
    'context.list',
    'capability.declare',
    'run.start',
    'run.read',
  ])('action %s with authenticated subject → allow', (action) => {
    assertAllow(d.decide(req({ action })));
  });
});
