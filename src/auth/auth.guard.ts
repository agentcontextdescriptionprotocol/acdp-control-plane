import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService } from '../config/app-config.service';
import {
  buildTenantLookup,
  DEFAULT_TENANT_ID,
  parseTenantApiKeys,
} from '../tenant/tenant-context';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  /**
   * `apiKey → tenantId` lookup built at first `canActivate`. Lazy
   * init avoids parsing in the constructor (which the linter prefers
   * for testability — tests can swap the config without triggering
   * unwanted side effects).
   */
  private tenantLookup: Map<string, string> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (!token) {
      throw new UnauthorizedException('Empty authorization token');
    }

    const validTokens = this.config.authApiKeys;
    if (validTokens.length === 0) {
      this.logger.warn('No AUTH_API_KEYS configured; allowing request');
      request.tenantId = DEFAULT_TENANT_ID;
      return true;
    }

    if (!validTokens.includes(token)) {
      throw new UnauthorizedException('Invalid authorization token');
    }

    request.actorId = token.slice(0, 8) + '...';
    request.actorType = 'api-key';
    request.actorIsAdmin = this.config.authAdminApiKeys.includes(token);
    request.tenantId = this.tenantFor(token);

    return true;
  }

  private tenantFor(apiKey: string): string {
    if (this.tenantLookup === null) {
      this.tenantLookup = buildTenantLookup(parseTenantApiKeys(this.config.tenantApiKeysRaw));
    }
    return this.tenantLookup.get(apiKey) ?? DEFAULT_TENANT_ID;
  }
}
