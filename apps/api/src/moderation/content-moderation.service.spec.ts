import { BadRequestException } from '@nestjs/common';
import { ContentModerationService } from './content-moderation.service';
import { assertTextAllowed, checkText, reviewNote } from './content-rules';

describe('Content text rules', () => {
  const blocked = (text: string) => checkText(text).blocked;
  const review = (text: string) => checkText(text).needsReview;

  it('allows adult vocabulary between consenting adults', () => {
    for (const text of ['Vidéo porno', 'Contenu XXX', 'sexe explicite', 'Nouvelle vidéo hard en duo', 'lingerie sexy']) {
      expect(checkText(text).matches).toEqual([]);
    }
  });

  it('blocks terms suggesting minors, including obfuscated ones', () => {
    for (const text of [
      'Petite mineure',
      'teen girl',
      '#teen18',
      't33n',
      'jeune ado coquine',
      'adolescente sexy',
      'lycéenne en uniforme',
      'collégienne',
      'écolière',
      'schoolgirl roleplay',
      'loli',
      'jailbait',
      'underage',
      'pédo',
      'barely legal',
    ]) {
      expect({ text, blocked: blocked(text) }).toEqual({ text, blocked: true });
    }
  });

  it('does not hit legitimate words containing a term', () => {
    for (const text of ['Adorable soirée', 'Au violon', 'Robe violette', 'la cantine', 'canteen', 'Escorial', 'pedestrian']) {
      expect({ text, matches: checkText(text).matches }).toEqual({ text, matches: [] });
    }
  });

  it('flags ambiguous terms for review instead of blocking', () => {
    expect(blocked("Souvenirs d'adolescence")).toBe(false);
    expect(review("Souvenirs d'adolescence")).toBe(true);
    expect(review('Encore endormie ce matin')).toBe(true);
    expect(review('Maman de deux enfants')).toBe(true);
    expect(review("J'ai 17 ans")).toBe(true);
    expect(review('Il y a 15 ans')).toBe(true);
    expect(blocked('Il y a 15 ans')).toBe(false);
  });

  it('blocks non-consent, incest, bestiality and escorting', () => {
    for (const text of [
      'scénario non consenti',
      'viol',
      'rape fantasy',
      'forcée',
      'inceste',
      'incest',
      'zoophilie',
      'bestiality',
      'escort Paris',
      'rencontre réelle possible',
      'plan cul ce soir',
      'tarif nuit en MP',
    ]) {
      expect({ text, blocked: blocked(text) }).toEqual({ text, blocked: true });
    }
  });

  it('keeps the other illegal categories as review', () => {
    expect(review('trafic de drogue')).toBe(true);
    expect(review('propagande nazi')).toBe(true);
  });

  it('assertTextAllowed throws a French message listing the terms', () => {
    expect(() => assertTextAllowed('Titre', 'vidéo avec une ado')).toThrow(BadRequestException);
    try {
      assertTextAllowed('vidéo avec une ado');
    } catch (error: any) {
      expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN_TERMS', terms: ['ado'] });
      expect(error.message).toContain('mineurs');
    }
    expect(assertTextAllowed('Encore endormie').needsReview).toBe(true);
    expect(reviewNote(checkText('Encore endormie'))).toContain('endormie');
    expect(reviewNote(checkText('Bonjour'))).toBeNull();
  });
});

describe('ContentModerationService', () => {
  const service = new ContentModerationService();

  it('no longer rejects adult content', async () => {
    const result = await service.analyzeContent('Vidéo porno xxx', 'sexe explicite en duo');
    expect(result.shouldAutoReject).toBe(false);
    expect(result.shouldRequireReview).toBe(false);
    expect(result.containsExplicitContent).toBe(false);
    expect(result.flaggedKeywords).toEqual([]);
  });

  it('auto-rejects prohibited terms', async () => {
    const result = await service.analyzeContent('Nouvelle vidéo', 'avec une lycéenne', undefined);
    expect(result.shouldAutoReject).toBe(true);
    expect(result.flaggedKeywords).toContain('lyceenne');
    expect(result.ruleMatches?.[0]).toMatchObject({ category: 'MINORS', severity: 'BLOCK' });
  });

  it('requires review for ambiguous terms', async () => {
    const result = await service.analyzeContent('Réveil', 'encore endormie');
    expect(result.shouldAutoReject).toBe(false);
    expect(result.shouldRequireReview).toBe(true);
  });

  it('still detects spam', async () => {
    const result = await service.analyzeContent('Cliquez ici', 'argent facile, gagnez au casino');
    expect(result.containsSpam).toBe(true);
    expect(result.flaggedKeywords).toEqual(expect.arrayContaining(['cliquez ici', 'argent facile', 'casino']));
  });

  it('checks usernames, even with glued words', async () => {
    expect(await service.isUsernameAppropriate('marie_lingerie')).toBe(true);
    expect(await service.isUsernameAppropriate('pornstar_lea')).toBe(true);
    expect(await service.isUsernameAppropriate('hotteen99')).toBe(false);
    expect(await service.isUsernameAppropriate('escort_paris')).toBe(false);
    expect(await service.isUsernameAppropriate('l0li')).toBe(false);
  });
});
