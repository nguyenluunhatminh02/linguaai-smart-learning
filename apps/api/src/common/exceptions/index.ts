import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(message: string, status: HttpStatus) {
    super({ success: false, message, statusCode: status }, status);
  }
}

export class AuthException extends AppException {
  constructor(message: string, status: HttpStatus) {
    super(message, status);
  }
}

export class BadCredentialsException extends AuthException {
  constructor(message = 'Invalid email or password') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTokenException extends AuthException {
  constructor(message = 'Token is invalid or expired') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class MfaException extends AuthException {
  constructor(message = 'Invalid MFA code') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class EmailNotVerifiedException extends AuthException {
  constructor(message = 'Please verify your email before logging in') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class DeviceLimitExceededException extends AuthException {
  constructor(message = 'Maximum number of devices reached. Please remove a device first.') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ResourceAlreadyExistsException extends AppException {
  constructor(resource = 'Resource') {
    super(`${resource} already exists`, HttpStatus.CONFLICT);
  }
}

export class AccountLockedException extends AuthException {
  constructor(message = 'Account is locked due to too many failed attempts. Try again later.') {
    super(message, 423 as any as HttpStatus);
  }
}

export class RateLimitExceededException extends AppException {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class PasswordValidationException extends AppException {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super('Password does not meet requirements', HttpStatus.BAD_REQUEST);
    this.errors = errors;
    const response = this.getResponse() as Record<string, unknown>;
    (response as any).errors = errors;
  }
}
