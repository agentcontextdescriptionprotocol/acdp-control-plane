import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService } from '../config/app-config.service';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('AuthGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let config: { authApiKeys: string[] };
  let request: Record<string, any>;
  let guard: AuthGuard;

  function ctx(req: Record<string, any>): ExecutionContext {
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

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    config = { authApiKeys: ['valid-token-12345678'] };
    request = { headers: {} };
    guard = new AuthGuard(reflector as unknown as Reflector, config as AppConfigService);
  });

  it('allows @Public() endpoints to pass through', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(ctx(request))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('rejects requests without Authorization header', () => {
    expect(() => guard.canActivate(ctx(request))).toThrow(UnauthorizedException);
  });

  it('rejects requests with empty Bearer token', () => {
    request.headers.authorization = 'Bearer ';
    expect(() => guard.canActivate(ctx(request))).toThrow(UnauthorizedException);
  });

  it('accepts requests with a valid Bearer token', () => {
    request.headers.authorization = 'Bearer valid-token-12345678';
    expect(guard.canActivate(ctx(request))).toBe(true);
    expect(request.actorId).toBe('valid-to...');
    expect(request.actorType).toBe('api-key');
  });

  it('accepts requests with a raw API key (no Bearer prefix)', () => {
    request.headers.authorization = 'valid-token-12345678';
    expect(guard.canActivate(ctx(request))).toBe(true);
  });

  it('rejects requests with an unknown token', () => {
    request.headers.authorization = 'Bearer wrong-token';
    expect(() => guard.canActivate(ctx(request))).toThrow(UnauthorizedException);
  });

  it('allows any token when AUTH_API_KEYS is empty (dev mode)', () => {
    config.authApiKeys = [];
    request.headers.authorization = 'Bearer anything-goes';
    expect(guard.canActivate(ctx(request))).toBe(true);
  });
});
