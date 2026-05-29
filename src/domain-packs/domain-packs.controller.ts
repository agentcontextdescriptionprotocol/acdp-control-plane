import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { DomainPackRegistry } from './domain-pack';

class ContextTypeRuleDto {
  @ApiProperty() contextType!: string;
  @ApiProperty({ type: [String] }) requiredFields!: string[];
  @ApiProperty({ enum: ['public', 'restricted', 'private'] })
  defaultVisibility!: 'public' | 'restricted' | 'private';
}

class DomainPackSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ type: [ContextTypeRuleDto] })
  contextTypes!: ContextTypeRuleDto[];
}

class DomainPacksResponseDto {
  @ApiProperty({ type: [DomainPackSummaryDto] })
  packs!: DomainPackSummaryDto[];
}

@ApiTags('domain-packs')
@Controller('domain-packs')
export class DomainPacksController {
  constructor(private readonly registry: DomainPackRegistry) {}

  @Get()
  @ApiOperation({
    summary: 'List active domain packs',
    description:
      'Returns each pack registered at boot via DOMAIN_PACKS, with its ' +
      'declared context types. Empty when no packs are configured.',
  })
  @ApiOkResponse({ type: DomainPacksResponseDto })
  list(): DomainPacksResponseDto {
    return {
      packs: this.registry.list().map((p) => ({
        id: p.id,
        version: p.version,
        label: p.label,
        contextTypes: p.contextTypes.map((c) => ({
          contextType: c.contextType,
          requiredFields: [...c.requiredFields],
          defaultVisibility: c.defaultVisibility,
        })),
      })),
    };
  }
}
