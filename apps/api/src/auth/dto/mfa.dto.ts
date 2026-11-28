import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const BACKUP_CODE_PATTERN = /^[A-F0-9]{10}$/;

export function isBackupCode(code: string): boolean {
  return BACKUP_CODE_PATTERN.test(code.toUpperCase());
}

export class MfaVerifyDto {
  @ApiProperty({
    description: '6-digit TOTP code or 10-char backup code',
    example: '123456',
  })
  @IsNotEmpty()
  @IsString()
  @Length(6, 10)
  code: string;
}

export class MfaLoginDto {
  @ApiProperty({ description: 'Temporary MFA token from login response' })
  @IsNotEmpty()
  @IsString()
  mfaTempToken: string;

  @ApiProperty({
    description: '6-digit TOTP code or 10-char backup code',
    example: '123456',
  })
  @IsNotEmpty()
  @IsString()
  @Length(6, 10)
  code: string;
}
