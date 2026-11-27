import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SpeakingGateway } from './speaking.gateway';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';
// PrismaModule is registered as @Global at app root, so no explicit import needed.

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET must be defined for SpeakingGateway WS auth.');
        }
        return { secret };
      },
    }),
  ],
  controllers: [SpeakingController],
  providers: [SpeakingGateway, SpeakingService],
})
export class SpeakingModule {}
