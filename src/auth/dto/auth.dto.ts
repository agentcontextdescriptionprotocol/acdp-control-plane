import { IsInt, IsString, MinLength, Min } from 'class-validator';

export class ChallengeRequestDto {
  @IsString()
  @MinLength(1)
  agent_id!: string;
}

export class ChallengeResponseDto {
  nonce!: string;
  registry_authority!: string;
  /** Unix seconds. */
  expires_at!: number;
  signing_input!: string;
}

export class TokenRequestDto {
  @IsString()
  @MinLength(1)
  agent_id!: string;

  @IsString()
  @MinLength(1)
  key_id!: string;

  @IsString()
  @MinLength(1)
  nonce!: string;

  @IsInt()
  @Min(0)
  expires_at!: number;

  @IsString()
  algorithm!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class TokenResponseDto {
  token!: string;
  token_type!: string;
  expires_at!: number;
}
