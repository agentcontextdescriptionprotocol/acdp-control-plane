import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ description: 'URL to receive webhook POST requests' })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({
    description: 'Events to subscribe to. Empty array = all events.',
    default: [],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiProperty({ description: 'Secret used for HMAC-SHA256 signature' })
  @IsString()
  secret!: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ description: 'Webhook delivery URL' })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional({ description: 'Event types to subscribe to', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ description: 'HMAC-SHA256 signing secret' })
  @IsOptional()
  @IsString()
  secret?: string;

  @ApiPropertyOptional({ description: 'Enable or disable the webhook' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
