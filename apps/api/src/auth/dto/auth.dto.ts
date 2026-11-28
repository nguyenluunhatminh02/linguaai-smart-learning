import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).+$/;

@ValidatorConstraint({ name: 'matchProperty', async: false })
class MatchPropertyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [property] = args.constraints as [string];
    return (
      typeof value === 'string' &&
      value === (args.object as Record<string, unknown>)[property]
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const [property] = args.constraints as [string];
    return `${args.property} must match ${property}`;
  }
}

function MatchProperty(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [property],
      validator: MatchPropertyConstraint,
    });
  };
}

// ─── Forgot Password ──────────────────────────────────────────────────────────
export class ForgotPasswordDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

// ─── Reset Password ───────────────────────────────────────────────────────────
export class ResetPasswordDto {
  @ApiProperty({ description: 'Token received in email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({ example: 'NewP@ssw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  newPassword: string;

  @ApiProperty({ example: 'NewP@ssw0rd!' })
  @IsString()
  @MatchProperty('newPassword', {
    message: 'confirmPassword must match newPassword',
  })
  confirmPassword: string;
}

// ─── Refresh Token ────────────────────────────────────────────────────────────
export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Optional if sent via HttpOnly Cookie' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}

// ─── Resend Verification ──────────────────────────────────────────────────────
export class ResendVerificationDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

// ─── MFA Verify (sau khi login, khi mfaRequired=true) ────────────────────────
export class MfaVerifyDto {
  @ApiProperty({ description: 'MFA pending JWT returned from login' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  mfaToken: string;

  @ApiProperty({ description: '6-digit TOTP code or backup code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  totpCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  deviceType?: string;
}

// ─── MFA Setup Confirm ────────────────────────────────────────────────────────
export class MfaSetupConfirmDto {
  @ApiProperty({ description: '6-digit TOTP code to confirm setup' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  code: string;
}

// ─── Rename Device ────────────────────────────────────────────────────────────
export class RenameDeviceDto {
  @ApiProperty({ example: 'My MacBook' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  newName: string;
}

// ─── Update Profile ───────────────────────────────────────────────────────────
export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;
}
