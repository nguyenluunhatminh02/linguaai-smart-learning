import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

export interface OAuthProfile {
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  provider: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    // ConfigModule loads .env into process.env but registers no custom config
    // namespace, so these credentials must be read from their flat env keys.
    const clientID = config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientID || !clientSecret) {
      // Fail loudly at startup rather than registering a strategy that can
      // never authenticate anyone and looks operational from the outside.
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured to enable Google OAuth',
      );
    }
    super({
      clientID,
      clientSecret,
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ||
        `${config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/api/v1/auth/oauth2/callback/google`,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    // Only link/create accounts with an email Google has explicitly verified.
    // An unverified address must never become email_verified: true downstream.
    const verifiedEmail = (profile.emails ?? []).find(
      (e: any) => e.verified === true && e.value,
    )?.value;

    if (!verifiedEmail) {
      return done(
        new Error(
          'Your Google account has no verified email address. Please verify your email with Google before signing in.',
        ),
        null,
      );
    }

    const oauthProfile: OAuthProfile = {
      providerId: profile.id?.toString(),
      email: verifiedEmail,
      firstName: profile.name?.givenName ?? '',
      lastName: profile.name?.familyName ?? '',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      provider: 'GOOGLE',
    };
    done(null, oauthProfile);
  }
}
