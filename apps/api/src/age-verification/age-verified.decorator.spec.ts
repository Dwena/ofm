import { Controller, Get, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgeVerified, AgeVerifiedPipe } from './decorators/age-verified.decorator';
import { AgeVerificationService } from './age-verification.service';

const isAgeVerified = jest.fn();

@Global()
@Module({
  providers: [{ provide: AgeVerificationService, useValue: { isAgeVerified } }, AgeVerifiedPipe],
  exports: [AgeVerificationService, AgeVerifiedPipe],
})
class FakeAgeVerificationModule {}

@Controller('probe')
class ProbeController {
  @Get()
  probe(@AgeVerified() ageVerified: boolean) {
    return { ageVerified };
  }
}

// A feature module that does not import the age verification module
@Module({ controllers: [ProbeController] })
class FeatureModule {}

describe('@AgeVerified()', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeAgeVerificationModule, FeatureModule] }).compile();
    app = moduleRef.createNestApplication();
    // Same global pipe as main.ts
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(() => app.close());

  it('resolves the (async) verification of the request', async () => {
    isAgeVerified.mockImplementation(async (req: any) => req.headers['x-age-verification'] === 'ok');

    const verified = await fetch(`${baseUrl}/probe`, { headers: { 'X-Age-Verification': 'ok' } });
    expect(await verified.json()).toEqual({ ageVerified: true });
    const anonymous = await fetch(`${baseUrl}/probe`);
    expect(await anonymous.json()).toEqual({ ageVerified: false });
  });
});
