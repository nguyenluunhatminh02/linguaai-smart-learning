import { User } from "../../users/entities/user.entity";
import { UserResponse } from "../../users/dto/user-response.dto";

export function toAppUser(user: any): User {
  const roles = (user.user_roles ?? [])
    .map((ur: any) => ur.roles)
    .filter(Boolean);
  return {
    id: user.id,
    email: user.email,
    password: user.password,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    dateOfBirth: user.date_of_birth,
    gender: user.gender,
    provider: user.provider,
    providerId: user.provider_id,
    emailVerified: user.email_verified,
    emailVerificationToken: user.email_verification_token,
    emailVerificationExpiry: user.email_verification_expiry,
    passwordResetToken: user.password_reset_token,
    passwordResetExpiry: user.password_reset_expiry,
    twoFactorEnabled: user.two_factor_enabled,
    isActive: user.is_active,
    isLocked: user.is_locked,
    failedLoginAttempts: user.failed_login_attempts,
    lockTime: user.lock_time,
    lastLoginAt: user.last_login_at,
    lastLoginIp: user.last_login_ip,
    isDeleted: user.is_deleted,
    deletedAt: user.deleted_at,
    language: user.language,
    nativeLanguage: user.native_language,
    targetLanguage: user.target_language,
    timezone: user.timezone,
    notificationEmailEnabled: user.notification_email_enabled,
    notificationPushEnabled: user.notification_push_enabled,
    notificationInAppEnabled: user.notification_in_app_enabled,
    notificationSecurityEnabled: user.notification_security_enabled,
    profilePublic: user.profile_public,
    showEmail: user.show_email,
    showPhone: user.show_phone,
    showActivityStatus: user.show_activity_status,
    deleteStatus: user.delete_status,
    deleteRequestedAt: user.delete_requested_at,
    fcmToken: user.fcm_token,
    roles,
    refreshTokens: [],
    loginHistories: [],
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  } as User;
}

/**
 * Maps the domain `User` produced by {@link toAppUser} to the public API shape.
 * All callers pass that camelCase domain shape (roles are role objects), so
 * there is no need to also guess at a raw Prisma record here.
 */
export function mapToUserResponse(user: User): UserResponse {
  const firstRole = user.roles?.[0] as { name?: string } | string | undefined;
  const rawRoleName =
    typeof firstRole === "string" ? firstRole : firstRole?.name;
  // Role names in the database are uppercase (ADMIN | USER | MODERATOR).
  // Normalize legacy lowercase values so frontend admin guards can rely on this.
  const roleName = rawRoleName ? rawRoleName.toUpperCase() : "USER";
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    gender: user.gender ?? null,
    role: roleName,
    isEmailVerified: user.emailVerified ?? false,
    // No phone-verification field exists on the user model; do not fabricate one.
    isPhoneVerified: false,
    isActive: user.isActive ?? true,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    language: user.language ?? "en",
    nativeLanguage: user.nativeLanguage ?? null,
    targetLanguage: user.targetLanguage ?? null,
    timezone: user.timezone ?? "UTC",
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}
