import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentRepository } from '../storage/agent.repository';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentRepo: AgentRepository) {}

  @Get()
  @ApiOperation({ summary: 'List known agents (observed DIDs).' })
  async listAgents() {
    const agents = await this.agentRepo.list();
    return { data: agents, total: agents.length };
  }

  // `*did` catches the full DID path. NestJS 11 / path-to-regexp v6+ uses
  // this syntax in place of the older `:did(.*)` regex form.
  @Get('*did')
  @ApiOperation({ summary: 'Agent detail + context count.' })
  async getAgent(@Param('did') didParts: string[] | string) {
    const did = Array.isArray(didParts) ? didParts.join('/') : didParts;
    const agent = await this.agentRepo.findByDid(did);
    if (!agent) throw new NotFoundException(`agent ${did} not found`);
    return agent;
  }
}
