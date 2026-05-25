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

  @Get(':did(.*)')
  @ApiOperation({ summary: 'Agent detail + context count.' })
  async getAgent(@Param('did') did: string) {
    const agent = await this.agentRepo.findByDid(did);
    if (!agent) throw new NotFoundException(`agent ${did} not found`);
    return agent;
  }
}
