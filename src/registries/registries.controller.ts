import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryRepository } from '../storage/registry.repository';

@ApiTags('registries')
@Controller('registries')
export class RegistriesController {
  constructor(private readonly registryRepo: RegistryRepository) {}

  @Get()
  @ApiOperation({ summary: 'List known registries with event counts.' })
  async listRegistries() {
    const data = await this.registryRepo.list();
    return { data, total: data.length };
  }
}
