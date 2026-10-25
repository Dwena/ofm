import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterDto } from './register.dto';

const base = { email: 'alice@example.com', username: 'alice', password: 'Password1!' };

async function errorsOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(RegisterDto, body));
  return errors.map((e) => e.property);
}

describe('RegisterDto (legal consents)', () => {
  it('accepts a fan with the CGU and the 18+ declaration', async () => {
    expect(await errorsOf({ ...base, acceptTerms: true, confirmAdult: true })).toEqual([]);
  });

  it('requires acceptTerms and confirmAdult to be exactly true', async () => {
    expect(await errorsOf({ ...base })).toEqual(['acceptTerms', 'confirmAdult']);
    expect(await errorsOf({ ...base, acceptTerms: 'true', confirmAdult: 1 })).toEqual(['acceptTerms', 'confirmAdult']);
  });

  it('requires the creator terms for a creator only', async () => {
    const consents = { acceptTerms: true, confirmAdult: true };
    expect(await errorsOf({ ...base, ...consents, role: 'CREATOR' })).toEqual(['acceptCreatorTerms']);
    expect(await errorsOf({ ...base, ...consents, role: 'CREATOR', acceptCreatorTerms: true })).toEqual([]);
    expect(await errorsOf({ ...base, ...consents, role: 'SUBSCRIBER' })).toEqual([]);
  });

  it('refuses self-registration as admin or moderator', async () => {
    const consents = { acceptTerms: true, confirmAdult: true };
    expect(await errorsOf({ ...base, ...consents, role: 'ADMIN' })).toEqual(['role']);
    expect(await errorsOf({ ...base, ...consents, role: 'MODERATOR' })).toEqual(['role']);
  });
});
