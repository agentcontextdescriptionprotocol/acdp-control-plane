import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListRunsQueryDto {
  @ApiPropertyOptional({
    enum: ['running', 'completed', 'failed', 'cancelled'],
  })
  @IsOptional()
  @IsIn(['running', 'completed', 'failed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by scenario_id' })
  @IsOptional()
  @IsString()
  scenarioId?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  offset?: number;
}
