import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MinLength,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).+$/;

@ValidatorConstraint({ name: 'matchField', async: false })
class MatchFieldConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const related = (args.object as Record<string, unknown>)[
      args.constraints[0] as string
    ];
    return typeof value === 'string' && value === related;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must match ${args.constraints[0]}`;
  }
}

/** Cross-field equality check (class-validator 0.14 has no built-in Match decorator). */
function MatchField(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [property],
      validator: MatchFieldConstraint,
    });
  };
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

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
  @IsNotEmpty()
  @MatchField('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;

  @ApiPropertyOptional({
    description: 'Logout all other devices after password change',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  logoutAllDevices?: boolean;
}
