import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Injectable,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../services/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';

const PROVIDERS = [
  { name: 'google', displayName: 'Google', icon: 'google' },
  { name: 'github', displayName: 'GitHub', icon: 'github' },
];

const ALLOWED_PROVIDERS = new Set(PROVIDERS.map((p) => p.name.toUpperCase()));
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Forward the `state` query parameter to Passport. passport-oauth2 with a
 * NullStore passes a string state through verbatim, so the value the client
 * obtained from /state is echoed back by the provider on the callback.
 */
function createStateAwareOAuthGuard(type: 'google' | 'github') {
  @Injectable()
  class StateAwareOAuthGuard extends AuthGuard(type) {
    getAuthenticateOptions(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest<Request>();
      const state = req.query?.state;
      if (typeof state !== 'string' || !state) {
        // Never start an unbound OAuth flow: the client must first call
        // GET /auth/oauth2/state?provider=... and pass the returned state.
        throw new ForbiddenException('Missing OAuth2 state');
      }
      return { state };
    }
  }
  return StateAwareOAuthGuard;
}

const GoogleStateGuard = createStateAwareOAuthGuard('google');
const GithubStateGuard = createStateAwareOAuthGuard('github');

@ApiTags('OAuth2')
@Controller('auth/oauth2')
export class OAuth2Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── List available providers ─────────────────────────────────────────────
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'List available OAuth2 providers' })
  getProviders() {
    return { providers: PROVIDERS };
  }

  // ─── OAuth2 Callback ──────────────────────────────────────────────────────
  // Passport gọi strategy → validate() → req.user = OAuthProfile
  // Sau đó controller lấy req.user và xử lý

  @Public()
  @Get('callback/google')
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  @UseGuards(GoogleStateGuard)
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('state') state?: string,
  ) {
    this.verifyState(req, state, res);
    const profile = (req as any).user;
    return this.authService.handleOAuthLogin(profile, req);
  }

  @Public()
  @Get('callback/github')
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  @UseGuards(GithubStateGuard)
  async githubCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('state') state?: string,
  ) {
    this.verifyState(req, state, res);
    const profile = (req as any).user;
    return this.authService.handleOAuthLogin(profile, req);
  }

  /**
   * Issue a short-lived anti-CSRF state token bound to the browser via an
   * httpOnly cookie. Pass the returned `state` as a query param on the
   * authorization URL you redirect the user to.
   */
  @Public()
  @Get('state')
  @ApiOperation({ summary: 'Create an OAuth2 anti-CSRF state token' })
  createState(
    @Query('provider') provider: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const normalized = String(provider ?? '').toLowerCase();
    if (!ALLOWED_PROVIDERS.has(normalized.toUpperCase())) {
      throw new BadRequestException('Unsupported OAuth2 provider');
    }
    const issuedAt = Date.now();
    const nonce = crypto.randomBytes(32).toString('hex');
    const state = `${normalized}.${issuedAt}.${nonce}`;
    res.cookie(OAUTH_STATE_COOKIE, `${state}.${this.signState(state)}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: OAUTH_STATE_TTL_MS,
      path: '/',
    });
    return { state };
  }

  private signState(state: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET must be defined to secure OAuth2 state');
    }
    return crypto.createHmac('sha256', secret).update(state).digest('hex');
  }

  private verifyState(
    req: Request,
    state: string | undefined,
    res: Response,
  ): void {
    const rawCookie = (req as any).cookies?.[OAUTH_STATE_COOKIE] as
      | string
      | undefined;
    // Consume the cookie immediately so a captured callback URL cannot be replayed.
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!state || !rawCookie) {
      throw new ForbiddenException('Missing or invalid OAuth2 state');
    }
    const separator = rawCookie.lastIndexOf('.');
    if (separator === -1) {
      throw new ForbiddenException('Invalid OAuth2 state');
    }
    const cookieState = rawCookie.slice(0, separator);
    const signature = rawCookie.slice(separator + 1);
    const expected = this.signState(cookieState);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b) ||
      cookieState !== state
    ) {
      throw new ForbiddenException('Invalid OAuth2 state');
    }
    const issuedAt = Number(state.split('.')[1]);
    if (
      !Number.isFinite(issuedAt) ||
      Date.now() - issuedAt > OAUTH_STATE_TTL_MS
    ) {
      throw new ForbiddenException('OAuth2 state expired');
    }
  }

  // ─── Connected accounts ───────────────────────────────────────────────────
  @Get('connected-accounts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List linked OAuth accounts' })
  async getConnectedAccounts(@CurrentUser('id') userId: string) {
    const accounts = await this.prisma.oauth_accounts.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        provider: true,
        email: true,
        name: true,
        image_url: true,
      },
      orderBy: { provider: 'asc' },
    });
    return { accounts };
  }

  // ─── Disconnect provider ──────────────────────────────────────────────────
  @Delete('connected-accounts/:provider')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect an OAuth provider' })
  async disconnectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ) {
    const normalized = String(provider ?? '')
      .trim()
      .toUpperCase();
    if (!ALLOWED_PROVIDERS.has(normalized)) {
      throw new BadRequestException('Unsupported OAuth2 provider');
    }

    const existing = await this.prisma.oauth_accounts.findFirst({
      where: { user_id: userId, provider: normalized },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Provider is not linked to this account');
    }

    await this.prisma.oauth_accounts.delete({ where: { id: existing.id } });
    return { message: `${normalized.toLowerCase()} disconnected` };
  }
}
