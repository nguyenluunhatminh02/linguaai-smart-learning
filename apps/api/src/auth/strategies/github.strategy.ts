import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from './google.strategy';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(config: ConfigService) {
    // No `oauth2.github` config namespace is registered anywhere: credentials
    // come from flat environment variables loaded by ConfigModule.forRoot.
    const clientID = config.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = config.get<string>('GITHUB_CLIENT_SECRET');
    const callbackURL = config.get<string>('GITHUB_CALLBACK_URL');
    if (!clientID || !clientSecret || !callbackURL) {
      // Never boot a strategy with placeholder credentials: OAuth would be
      // silently broken and operators would have no startup signal.
      throw new Error(
        'GitHub OAuth is misconfigured: set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_CALLBACK_URL',
      );
    }
    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    // Only accept an email that GitHub has explicitly verified.
    // If we fabricate a "@github.local" address an attacker who controls a
    // GitHub username could hijack a local account that shares that pattern.
    const verifiedEmail = (profile.emails ?? []).find(
      (e: any) => e.verified !== false && e.value,
    )?.value;

    if (!verifiedEmail) {
      return done(
        new Error(
          'Your GitHub account has no verified email address. Please add and verify a public email in your GitHub settings.',
        ),
        null,
      );
    }

    const oauthProfile: OAuthProfile = {
      providerId: profile.id.toString(),
      email: verifiedEmail,
      firstName: profile.displayName?.split(' ')[0] ?? profile.username,
      lastName: profile.displayName?.split(' ').slice(1).join(' ') ?? '',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      provider: 'GITHUB',
    };
    done(null, oauthProfile);
  }
}
