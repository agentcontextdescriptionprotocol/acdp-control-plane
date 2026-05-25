import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class DashboardOverviewQueryDto {
  @ApiPropertyOptional({ enum: ['1h', '6h', '24h', '7d', '30d'], default: '24h' })
  @IsOptional()
  @IsIn(['1h', '6h', '24h', '7d', '30d'])
  window?: '1h' | '6h' | '24h' | '7d' | '30d';
}
