import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class RunCompleteDto {
  @ApiProperty({ enum: ['completed', 'failed', 'cancelled'] })
  @IsString()
  @IsIn(['completed', 'failed', 'cancelled'])
  status!: 'completed' | 'failed' | 'cancelled';

  @ApiPropertyOptional({
    description: 'Arbitrary JSON describing run outcome (e.g. final answer, metrics).',
  })
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;
}
