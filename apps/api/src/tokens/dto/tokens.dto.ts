import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class ConsumeTokensDto {
  @IsString()
  feature: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  cost?: number;
}

export class PurchaseTokensDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
