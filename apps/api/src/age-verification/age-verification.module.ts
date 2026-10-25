import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AgeVerificationController } from './age-verification.controller';
import { AgeVerificationService } from './age-verification.service';
import { readAgeVerificationSettings } from './age-verification.config';
import { AgeVerifiedPipe } from './decorators/age-verified.decorator';
import { AGE_VERIFICATION_PROVIDER, AgeVerificationProvider } from './providers/age-verification-provider.interface';
import { DevAgeVerificationProvider } from './providers/dev.provider';
import { OidcAgeVerificationProvider, readOidcOptions } from './providers/oidc.provider';

/**
 * AGE_VERIFICATION_PROVIDER: `dev` (simulator, default outside production,
 * refused in production) or `oidc` (certified third party, see
 * OidcAgeVerificationProvider).
 */
export function createAgeVerificationProvider(config: ConfigService): AgeVerificationProvider {
  const settings = readAgeVerificationSettings(config);
  if (settings.provider === 'dev') {
    return new DevAgeVerificationProvider(settings.webUrl, settings.isProduction);
  }
  if (settings.provider !== 'oidc') {
    new Logger('AgeVerificationModule').error(
      `Unknown AGE_VERIFICATION_PROVIDER "${settings.provider}", using "oidc"`,
    );
  }
  const provider = new OidcAgeVerificationProvider(readOidcOptions((key) => config.get<string>(key)));
  if (!provider.configured) {
    new Logger('AgeVerificationModule').error(
      'Age verification provider not configured: explicit media stay hidden until AGE_VERIFICATION_* is set',
    );
  }
  return provider;
}

/**
 * Global: any feature module can gate media with AgeVerificationService or
 * the @AgeVerified() parameter decorator without importing this module.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AgeVerificationController],
  providers: [
    AgeVerificationService,
    AgeVerifiedPipe,
    {
      provide: AGE_VERIFICATION_PROVIDER,
      inject: [ConfigService],
      useFactory: createAgeVerificationProvider,
    },
  ],
  exports: [AgeVerificationService, AgeVerifiedPipe],
})
export class AgeVerificationModule {}
