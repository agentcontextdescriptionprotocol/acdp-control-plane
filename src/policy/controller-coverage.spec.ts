/**
 * Regression-fence test: confirms that the controllers we audited as
 * needing @CheckPolicy still carry it. A silent removal of the
 * decorator (e.g. during a refactor) would let unauthenticated /
 * cross-tenant traffic past the guard.
 */
import { CapabilityController } from '../agents/capability.controller';
import { ContextsController } from '../contexts/contexts.controller';
import { RunsController } from '../runs/runs.controller';
import { POLICY_ACTION_KEY } from './check-policy.decorator';

function actionOf(target: object): unknown {
  return Reflect.getMetadata(POLICY_ACTION_KEY, target);
}

describe('PolicyGuard controller coverage', () => {
  it('CapabilityController.declare → capability.declare', () => {
    expect(actionOf(CapabilityController.prototype.declare)).toBe(
      'capability.declare',
    );
  });

  it('ContextsController.getContext → context.retrieve', () => {
    expect(actionOf(ContextsController.prototype.getContext)).toBe(
      'context.retrieve',
    );
  });

  it('RunsController.listRuns → run.read', () => {
    expect(actionOf(RunsController.prototype.listRuns)).toBe('run.read');
  });

  it('RunsController.getRun → run.read', () => {
    expect(actionOf(RunsController.prototype.getRun)).toBe('run.read');
  });

  it('RunsController.getLineage → run.read', () => {
    expect(actionOf(RunsController.prototype.getLineage)).toBe('run.read');
  });

  it('RunsController.getRunEvents → run.read', () => {
    expect(actionOf(RunsController.prototype.getRunEvents)).toBe('run.read');
  });

  it('RunsController.markComplete → run.start (write op on runs)', () => {
    expect(actionOf(RunsController.prototype.markComplete)).toBe('run.start');
  });
});
