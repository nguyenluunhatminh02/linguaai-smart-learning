# Endpoint / Auth / Quota Inventory — Part A (auth + admin)

Scope: route policies for `apps/api/src/auth/` and `apps/api/src/admin/`.
Source files were read only; no source behaviour was changed. All paths include
the global prefix `/api/v1` (`main.ts:112` `setGlobalPrefix("api")`,
`main.ts:126` `enableVersioning({ type: VersioningType.URI, defaultVersion: "1" })`).
Line numbers refer to the files as inspected for this inventory.

## Enforcement context

| Mechanism | Evidence | Effect |
| --- | --- | --- |
| Global auth | `auth/auth.module.ts:87` registers the public-aware `JwtAuthGuard` as `APP_GUARD`; `auth/guards/jwt-auth.guard.ts:11-21` skips when metadata `isPublic` is set, otherwise delegates to `AuthGuard('jwt')` | Every route in scope requires an ACCESS JWT unless decorated `@Public()`. `@ApiBearerAuth()` alone does **not** grant or waive auth. |
| Global throttling | `app.module.ts:85-91` `ThrottlerModule.forRoot` with `ttl = RATE_LIMIT_WINDOW_MS || 60000`, `limit = RATE_LIMIT_MAX_REQUESTS || 100`; `app.module.ts:127-132` registers `HttpOnlyThrottlerGuard` as `APP_GUARD` (`app.module.ts:49-56` skips non-HTTP contexts) | Applies to all routes in scope, including public ones. No deployment-specific env values were recorded. |
| `@RateLimit()` | `common/decorators/rate-limit.decorator.ts:8-23` (`RATE_LIMIT_CONFIGS`, `RATE_LIMIT_KEY = 'rate_limit'`); `common/guards/rate-limit.guard.ts:42-62` reads that metadata | **Not enforced on these routes.** `RateLimitGuard` is only listed as a provider at `auth/auth.module.ts:86`; it is not registered as `APP_GUARD` and no `@UseGuards(RateLimitGuard)` exists in scope. `RateLimitMiddleware` is not registered either. Decorator limits below are labelled *declared, not enforced by RateLimitGuard*. |
| Roles | `admin/admin.controller.ts:41-42` class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.ADMIN)`; `common/guards/roles.guard.ts:33-49` is fail-closed and honours `PUBLIC_KEY`; `common/decorators/roles.decorator.ts:20-24`; `auth/decorators/public.decorator.ts:3` (`isPublic`) | `@Public()` exempts both the global auth guard and role checks. No other controller in scope declares `@Roles()`. |
| JWT validation | `auth/strategies/jwt.strategy.ts:35-45` (only `type === 'ACCESS'`, `jti` required, blacklist check), `:57-88,95-132` (active / not deleted / not locked checks, roles), `:140-155` (`deviceId` must match an active `user_devices` row), `:158-164` (`req.user` = `{...appUser, roles, deviceId, accessToken}`) | `@CurrentUser()` in `auth/decorators/current-user.decorator.ts:3-8` and `common/decorators/current-user.decorator.ts:3-8` reads this object. |
| Two distinct guards | `auth/guards/jwt-auth.guard.ts` (public-aware, global) vs `common/guards/jwt-auth.guard.ts:5` (`AuthGuard('jwt')`, no `@Public()` awareness, used by `admin/`) | Do not conflate them. Admin routes get a second, explicit JWT check; `@Public()` would not exempt the plain guard. |

`RATE_LIMIT_CONFIGS` (`common/decorators/rate-limit.decorator.ts:8-16`): LOGIN 5/900s,
REGISTER 3/3600s, PASSWORD_RESET 3/3600s, EMAIL_VERIFICATION 5/3600s,
MFA 3/300s, GENERAL 100/60s, IP 1000/3600s. Service-level limits cited below
come from the service code, not from these declarations.

## `auth/controllers/auth.controller.ts` — `/api/v1/auth`

Controller has no class-level guard/role/quota (`auth.controller.ts:45-47`).

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST `/api/v1/auth/register` | `register` (`:66`; route `:60`) | Public (`:59`) | none | `@RateLimit("REGISTER")` (`:61`) = 3/3600s **declared, not enforced by RateLimitGuard**; global throttler applies | n/a | Service registers the account; no per-IP service limiter at the controller. |
| GET `/api/v1/auth/verify-email` | `verifyEmail` (`:75`; route `:72`) | Public (`:71`) | none | global throttler only | n/a | `Cache-Control: no-store` (`:73`); single-use email token verified in service. |
| POST `/api/v1/auth/login` | `login` (`:91`; route `:81`) | Public (`:80`) | none | Global throttler; service `loginAttemptService.checkBruteForce(email, ip)` (`auth.service.ts:130`) — `MAX_LOGIN_ATTEMPTS` default 5, `LOCKOUT_DURATION_MINUTES` default 30, IP cap 50/hour (`login-attempt.service.ts:16-28,39-83`); fail-closed on Redis outage in production (`:40-44`) | n/a | Refresh token set as HttpOnly/Secure/SameSite=Lax cookie (`auth.controller.ts:331-357`). |
| POST `/api/v1/auth/verify-mfa` | `verifyMfa` (`:114`; route `:105`) | Public (`:104`) | none | `@RateLimit("MFA")` (`:107`) = 3/300s **declared, not enforced by RateLimitGuard**; separate service brute-force check `checkBruteForce('mfa:'+email, 'mfa:'+ip)` (`auth.service.ts:239`) plus MFA code verification; global throttler | n/a | Pending MFA token is checked for account state and expiry in service (`auth.service.ts:218-240`). |
| POST `/api/v1/auth/refresh-token` | `refreshToken` (`:140`; route `:135`) | Public (`:134`) — credential is the refresh token, not a JWT access token | none | global throttler only | Token binding enforced in `resolveRefreshToken` (`:275-307`): body token must equal cookie when both present (`:279-282`), `type === 'REFRESH'` (`:289-294`), `deviceId` must match body and presenting access-token claim (`:296-304`); service re-checks stored `refresh:{userId}:{deviceId}` jti (`token.service.ts:135-156`) | No DB ownership lookup here; binding uses JWT claims + user-scoped Redis key. |
| POST `/api/v1/auth/logout` | `logout` (`:159`; route `:154`) | Authenticated (no `@Public()`) | none | global throttler only | `@CurrentUser()` (`:160`); `auth.service.ts:313-327` blacklists access token and revokes only the session in `payload.deviceId` from the refresh token with `user.id` scope (`token.service.ts:311-329`) | Returns 204 (`:155`). |
| POST `/api/v1/auth/logout-all` | `logoutAll` (`:177`; route `:173`) | Authenticated | none | global throttler only | `@CurrentUser()` (`:178`); `auth.service.ts:330-334` blacklists current token and revokes all sessions by `user.id` (`token.service.ts:332-352`) | Returns 204. |
| POST `/api/v1/auth/logout-session/:deviceId` | `logoutSession` (`:193`; route `:189`) | Authenticated | none | global throttler only | `@CurrentUser()` (`:194`); `auth.service.ts:336-344` blacklists calling access token and calls `revokeDeviceSession(user.id, deviceId)` (`:341`), i.e. user-scoped Redis keys `refresh:{userId}:{deviceId}` / `revoked-device:{userId}:{deviceId}` (`token.service.ts:311-329`) | **No explicit DB ownership check** for the path `deviceId`; relies on the user-scoped keys/`updateMany` filter. Revoking another user's device does not occur because the key includes the caller id, but a nonexistent id is a no-op. |
| POST `/api/v1/auth/forgot-password` | `forgotPassword` (`:208`; route `:206`) | Public (`:205`) | none | Service limiter in `password.service.ts:59-70`: 3 requests per 900s per normalised email **and** per IP (`FORGOT_PASSWORD_LIMIT = 3`, `FORGOT_PASSWORD_WINDOW_SEC = 900` at `:28-29`), plus 15-minute resend cooldown (`:31,85`); global throttler | n/a | Generic response for unknown/unthrottled accounts; no `@RateLimit()` declaration on this route. |
| POST `/api/v1/auth/reset-password` | `resetPassword` (`:216`; route `:214`) | Public (`:213`) | none | Global throttler only (no `@RateLimit`/`@Throttle` on this handler) | n/a | Consumes a hashed, one-use reset token in service (`password.service.ts`). |
| POST `/api/v1/auth/change-password` | `changePassword` (`:227`; route `:224`) | Authenticated | none | global throttler only | `@CurrentUser()` (`:229`) passed to `authService.changePassword`; current-password verification in service | `ApiBearerAuth` at `:225`. |
| POST `/api/v1/auth/resend-verification` | `resendVerification` (`:241`; route `:237`) | Public (`:236`) | none | **Enforced**: `@Throttle({ default: { limit: 5, ttl: 60_000 } })` (`:238`); **declared only**: `@RateLimit("EMAIL_VERIFICATION")` (`:239`) = 5/3600s, not enforced by RateLimitGuard; service 1/min + 5/hour per key (`email-verification.service.ts:60-61`) | n/a | Three overlapping layers; global throttler also applies. |
| GET `/api/v1/auth/login-history` | `loginHistory` (`:249`; route `:246`) | Authenticated | none | global throttler only | `@CurrentUser("id")` (`:250`) → `loginAttemptService.getLoginHistory(userId, ...)` filters `where: { user_id: userId }` (`login-attempt.service.ts:196-212`) | Last 90 days per Swagger summary (`:248`). |
| GET `/api/v1/auth/security-events` | `securityEvents` (`:261`; route `:258`) | Authenticated | none | global throttler only | `@CurrentUser("id")` (`:262`) → `auditLogService.getAuditLogs(userId, ...)` filters `user_id: userId` (`common/services/audit-log.service.ts:91-116`) | Paginated; query values validated in service. |

## `auth/controllers/device.controller.ts` — `/api/v1/devices`

Class-level `@ApiBearerAuth()` (`:22`) is Swagger only; authentication comes from
the global guard. No class-level role/quota declarations (`:21-24`).

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/api/v1/devices` | `getDevices` (`:33`; route `:31`) | Authenticated | none | global throttler only | `deviceService.getActiveDevices(user.id)` queries `where: { user_id: userId, active: true }` (`device.service.ts:148-151`) | Lists own devices only. |
| GET `/api/v1/devices/sessions` | `getSessions` (`:41`; route `:39`) | Authenticated | none | global throttler only | `getActiveDevices(user.id)` + `tokenService.getActiveSessionCount(user.id)` (`:43-44`) | Own session summary. |
| DELETE `/api/v1/devices/others` | `removeOtherDevices` (`:56`; route `:53`) | Authenticated | none | global throttler only | `deactivateOtherDevices(user.id, currentDeviceId)` filters `user_id` and `device_id != currentDeviceId` (`device.service.ts:218-223`); `revokeOtherSessions(user.id, currentDeviceId)` (`token.service.ts:354-375`) | `currentDeviceId` comes from the validated JWT device claim (`:58`). Returns 204. |
| DELETE `/api/v1/devices/:deviceId` | `removeDevice` (`:68`; route `:65`) | Authenticated | none | global throttler only | `deactivateDevice` calls `ensureDeviceBelongsToUser(user.id, deviceId)` (`device.service.ts:203-211,240-248`); `revokeDeviceSession(user.id, deviceId)` uses user-scoped Redis keys (`token.service.ts:311-329`) | 404 when device is not the caller's. Returns 204. |
| POST `/api/v1/devices/:deviceId/trust` | `trustDevice` (`:79`; route `:77`) | Authenticated | none | global throttler only | Controller first requires the device among `getActiveDevices(user.id)` (`:83-89`, else 404); service additionally calls `ensureDeviceBelongsToUser` (`device.service.ts:175-181,240-248`) | Trust bypasses MFA, hence the active-device requirement. |
| DELETE `/api/v1/devices/:deviceId/trust` | `untrustDevice` (`:96`; route `:93`) | Authenticated | none | global throttler only | `ensureDeviceBelongsToUser(user.id, deviceId)` (`device.service.ts:183-190,240-248`). Service updates with both `user_id` and `device_id` | Returns 204. |
| PUT `/api/v1/devices/:deviceId/name` | `renameDevice` (`:106`; route `:104`) | Authenticated | none | global throttler only | `ensureDeviceBelongsToUser(user.id, deviceId)` (`device.service.ts:193-200,240-248`). Service updates with both `user_id` and `device_id` | Body `RenameDeviceDto.newName`. |

## `auth/controllers/mfa.controller.ts` — `/api/v1/mfa`

Class-level `@ApiBearerAuth()` (`:18`) is Swagger only; global guard applies.

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/api/v1/mfa/status` | `getStatus` (`:26`; route `:24`) | Authenticated | none | global throttler only | `@CurrentUser('id')` (`:26`) | Reads own MFA status. |
| POST `/api/v1/mfa/setup` | `setup` (`:34`; route `:31`) | Authenticated | none | **Enforced** `@Throttle({ default: { limit: 5, ttl: 300_000 } })` (`:32`); global throttler | `@CurrentUser()` (`:34`) | Generates secret/QR/backup codes. |
| POST `/api/v1/mfa/setup/confirm` | `confirmSetup` (`:42`; route `:39`) | Authenticated | none | **Enforced** `@Throttle` 5/300s (`:40`); service `checkRateLimit(user.id, 'confirm')` 5 failures/900s (`mfa.service.ts:21-22,70-77,184`) | `@CurrentUser()` (`:44`) | TOTP required. |
| POST `/api/v1/mfa/disable` | `disable` (`:54`; route `:51`) | Authenticated | none | **Enforced** `@Throttle` 5/300s (`:52`); service per-user failure counter (`mfa.service.ts:70-77,224`) | `@CurrentUser()` (`:56`) | TOTP required. |
| POST `/api/v1/mfa/backup-codes/regenerate` | `regenerateBackupCodes` (`:66`; route `:63`) | Authenticated | none | **Enforced** `@Throttle` 5/300s (`:64`); service `checkRateLimit(userId, 'regenerate')` (`mfa.service.ts:320`) | `@CurrentUser('id')` (`:68`) | TOTP required. |
| GET `/api/v1/mfa/backup-codes/count` | `backupCodesCount` (`:76`; route `:74`) | Authenticated | none | global throttler only | `@CurrentUser('id')` (`:76`) | Reads own count. |

## `auth/controllers/oauth2.controller.ts` — `/api/v1/auth/oauth2`

Controller has no class-level guard/role/quota (`:59-61`).

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/api/v1/auth/oauth2/providers` | `getProviders` (`:71`; route `:69`) | Public (`:68`) | none | global throttler only | n/a | Static provider list. |
| GET `/api/v1/auth/oauth2/callback/google` | `googleCallback` (`:83`; route `:80`) | Public (`:79`), but provider-authenticated via `GoogleStateGuard` (`:82`, guard factory `:39-54`) | none | global throttler only | Anti-CSRF state: HMAC-signed cookie `oauth_state`, 10-minute TTL, `timingSafeEqual`, cookie consumed on callback (`:31-32,126-132,136-174`) | `verifyState` at `:88` runs **after** the Passport guard. |
| GET `/api/v1/auth/oauth2/callback/github` | `githubCallback` (`:97`; route `:94`) | Public (`:93`), `GithubStateGuard` (`:96`) | none | global throttler only | Same state/cookie binding as Google (`:88,144-174`) | Missing/expired state is rejected. |
| GET `/api/v1/auth/oauth2/state` | `createState` (`:115`; route `:113`) | Public (`:112`) | none | global throttler only | Random 32-byte nonce, HMAC with `JWT_SECRET`, HttpOnly cookie with 10-minute TTL (`:119-133,136-142`) | Provider allow-list `{GOOGLE, GITHUB}` (`:25-30,119-121`). |
| GET `/api/v1/auth/oauth2/connected-accounts` | `getConnectedAccounts` (`:180`; route `:177`) | Authenticated | none | global throttler only | `prisma.oauth_accounts.findMany({ where: { user_id: userId } })` (`:181-191`), `userId` from `@CurrentUser('id')` | Own links only. |
| DELETE `/api/v1/auth/oauth2/connected-accounts/:provider` | `disconnectProvider` (`:199`; route `:196`) | Authenticated | none | global throttler only | Provider allow-list (`:203-206`) and `findFirst({ where: { user_id: userId, provider: normalized } })` before delete by that row id (`:208-216`) | 404 if not linked; no other user's row can be deleted. |

## `auth/controllers/user.controller.ts` — `/api/v1/users/me` (NOT REGISTERED)

**Important:** this controller is exported from `auth/controllers/index.ts:2` but
is absent from every `controllers: [...]` array (`auth/auth.module.ts:67-72`
registers only Auth/Device/MFA/OAuth2; `users/users.module.ts:8` registers
`UsersController`). It therefore does **not** currently create live routes.
The active `/api/v1/users/me` family is defined in `users/users.controller.ts:38`,
which is outside this inventory's assigned directories. The policies below are
those the file would have if registered.

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/api/v1/users/me` | `getMe` (`:38`; route `:36`) | Authenticated (global guard) | none | global throttler only | `@CurrentUser()` → `usersService.getProfile(user.id)` | Class `@ApiBearerAuth()` (`:26`) is Swagger only. |
| PUT `/api/v1/users/me` | `updateMe` (`:45`; route `:43`) | Authenticated | none | global throttler only | `@CurrentUser()` → `usersService.updateProfile(user.id, dto)` | — |
| POST `/api/v1/users/me/deactivate` | `deactivate` (`:52`; route `:50`) | Authenticated | none | global throttler only | `@CurrentUser()`; revokes all sessions (`:56`), blacklists `user.accessToken` (`:57-59`), deactivates only `user.id` (`:60`), evicts 60s JWT cache key `cache:user:${user.id}` (`:61-63`) | Does not schedule deletion. |
| POST `/api/v1/users/me/avatar` | `uploadAvatar` (`:72`; route `:68`) | Authenticated | none | global throttler only (file-size 5 MB and image MIME validation at `:75-81` are not request quotas) | `@CurrentUser()` → `usersService.uploadAvatar(user.id, file)` | multipart/form-data. |
| DELETE `/api/v1/users/me/avatar` | `deleteAvatar` (`:90`; route `:88`) | Authenticated | none | global throttler only | `@CurrentUser()` → `usersService.deleteAvatar(user.id)` | — |

## `admin/admin.controller.ts` — `/api/v1/admin`

Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.ADMIN)` +
`@ApiBearerAuth()` (`:39-43`): **all routes require authentication and the
ADMIN role**. The guard here is `common/guards/jwt-auth.guard.ts:5` (plain
`AuthGuard('jwt')`), not the public-aware global guard. No `@Throttle` or
`@RateLimit` appears anywhere in this file, so only the global throttler applies.
No per-target ownership check: privilege is role-based by design; the three
mutating user actions write an `audit_logs` row via `recordAdminAction`
(`:58-85,101-107,140-146,158-164`).

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST `/api/v1/admin/users/:id/tokens` | `grantTokens` (`:89`; route `:87`) | Authenticated | ADMIN | global throttler only | No ownership (admin acts on `:id`); audit `ADMIN_TOKEN_GRANT` with actor `admin.id`, target id, amount/reason (`:95-107`) | `ParseUUIDPipe` on id. |
| GET `/api/v1/admin/users/:id/tokens/history` | `getUserTokenHistory` (`:113`; route `:111`) | Authenticated | ADMIN | global throttler only | No ownership; reads any user's token history | No audit entry. |
| GET `/api/v1/admin/overview` | `getOverview` (`:119`; route `:117`) | Authenticated | ADMIN | global throttler only | n/a | Dashboard aggregates. |
| GET `/api/v1/admin/users` | `getUsers` (`:127`; route `:123`) | Authenticated | ADMIN | global throttler only | n/a | `page`/`limit` default 1/20 (`:128`). |
| PATCH `/api/v1/admin/users/:id/role` | `updateRole` (`:133`; route `:131`) | Authenticated | ADMIN | global throttler only | No ownership; audit `ADMIN_ROLE_CHANGE` (`:139-146`); service enforces last-admin guard and evicts JWT cache (`admin.service.ts:106-151`) | `UpdateUserRoleDto.role`. |
| DELETE `/api/v1/admin/users/:id` | `deleteUser` (`:152`; route `:150`) | Authenticated | ADMIN | global throttler only | No ownership; audit `ADMIN_USER_DELETE` (`:157-164`); service evicts 60s JWT cache (`admin.service.ts:162-173`) | Destructive; actor recorded in audit log. |
| GET `/api/v1/admin/content` | `getContent` (`:173`; route `:170`) | Authenticated | ADMIN | global throttler only | n/a | Optional `type` filter. |
| POST `/api/v1/admin/content` | `createContent` (`:179`; route `:177`) | Authenticated | ADMIN | global throttler only | n/a | `published` defaults to true (`admin.service.ts:196`). |
| PATCH `/api/v1/admin/content/:id` | `updateContent` (`:185`; route `:183`) | Authenticated | ADMIN | global throttler only | n/a | `ParseUUIDPipe` on id. |
| DELETE `/api/v1/admin/content/:id` | `deleteContent` (`:194`; route `:192`) | Authenticated | ADMIN | global throttler only | n/a | `ParseUUIDPipe` on id. |

`admin.controller.ts` declares 10 route decorators; together with the two
`LessonsController` routes below this accounts for the 12 admin-scope routes.

## `admin/lessons.controller.ts` — `/api/v1/lessons`

| Method + full path | Handler (line) | Auth | Role | Quota / rate limit | Ownership check | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/api/v1/lessons` | `getLessons` (`:16`; route `:13`) | **Authenticated** — class-level `@UseGuards(JwtAuthGuard)` (`:8`) | **None** — no `RolesGuard`, no `@Roles()` | global throttler only | n/a | Swagger summary says "public/student" (`:14`), but auth is required. `adminService.getContent(type)` filters only by `type`, not `published` (`admin.service.ts:178-183`), so unpublished content is returned. |
| GET `/api/v1/lessons/:id` | `getLesson` (`:23`; route `:21`) | **Authenticated** (`:8`) | None | global throttler only | n/a | Same summary/auth mismatch (`:22`); `getContentById` uses `findUnique({ where: { id } })` with **no `published` filter** (`admin.service.ts:224-226`), so any authenticated user can read unpublished lesson content by UUID. |

## Findings to flag

1. **Inert `@RateLimit()` metadata.** `register`, `verify-mfa`, and
   `resend-verification` carry `@RateLimit()` values that are never read by a
   registered guard (`RateLimitGuard` is a provider only — `auth.module.ts:86`;
   no `APP_GUARD`/`@UseGuards` registration for it). Enforced limits on those
   paths are the global `ThrottlerGuard` and, where present, service-level Redis
   checks. Documenting these as active would overstate protection.
2. **Two JWT guards.** The public-aware global guard in `auth/guards/` and the
   plain guard in `common/guards/` used by both admin controllers are different
   classes; only the former honours `@Public()`.
3. **`PUBLIC_KEY === 'isPublic'`** in both decorator files, so `@Public()`
   bypasses both auth and role metadata checks. OAuth callbacks are public but
   state-cookie-bound; `googleCallback`/`githubCallback` verify state in the
   controller after the Passport guard.
4. **`LessonsController` is not admin-restricted** despite living under
   `admin/`; its Swagger summaries say public/student while auth is mandatory,
   and `adminService.getContent`/`getContentById` do not filter unpublished
   content. This is an access-policy inconsistency, not merely a doc wording
   issue.
5. **Device/session ownership is mostly user-scoped keys, not DB lookups.**
   `logout-session/:deviceId` and session revocation rely on Redis keys keyed by
   `(userId, deviceId)` plus `updateMany({ where: { user_id, device_id } })`;
   only the `devices/*` controller handlers consistently call
   `ensureDeviceBelongsToUser` (`device.service.ts:240-248`).
6. **`auth/controllers/user.controller.ts` is unregistered** (see its section),
   while `users/users.controller.ts:38` serves overlapping `/users/me` paths.
   Any policy decision about `/users/me` must target the registered controller.

## Out-of-scope follow-ups (recorded, not changed)

- Register `RateLimitGuard` (as `APP_GUARD` or per-controller) or remove the
  inert `@RateLimit()` decorators — requires editing `auth.module.ts` (in scope)
  and/or shared guard wiring (out of scope), plus tests.
- Resolve the `LessonsController` role/publication policy and align Swagger
  summaries — requires editing `admin/lessons.controller.ts` (in scope) and
  `admin/admin.service.ts` (out of scope).
- Clarify the duplicate `/users/me` controllers — requires editing
  `users/users.controller.ts` / `users/users.module.ts` (out of scope).
