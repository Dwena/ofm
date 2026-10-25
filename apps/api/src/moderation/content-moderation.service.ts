import { Injectable, Logger } from '@nestjs/common';
import { ContentAnalysisResult } from './dto/moderation.dto';
import { CONTENT_RULES, checkText, normalizeText } from './content-rules';

/**
 * Automatic text checks. Adult vocabulary is allowed on FanVIP (sexual
 * content between consenting adults); the rules (content-rules.ts) target
 * minors, non-consent, incest, bestiality, prostitution / escorting and other
 * illegal content.
 */
@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  // Mots-clés de spam
  private readonly SPAM_KEYWORDS = [
    'cliquez ici', 'gratuit', 'gagnez', 'offre limitée',
    'argent facile', 'devenez riche', 'miracle',
    'viagra', 'casino', 'loterie', 'promotion',
  ];

  // Pattern de spam (liens répétés, caps lock excessif, etc.)
  private readonly SPAM_PATTERNS = [
    /https?:\/\/[^\s]+/g, // Multiple URLs
    /[A-Z]{10,}/g, // Excessive caps
    /(.)\1{5,}/g, // Repeated characters
  ];

  /**
   * Unambiguous terms also refused inside usernames, where words are glued
   * together (e.g. "hotteen99", "escort_paris")
   */
  private readonly USERNAME_BLOCKED_FRAGMENTS = [
    'teen', 'loli', 'pedo', 'jailbait', 'underage', 'mineure', 'preteen',
    'schoolgirl', 'incest', 'zoophil', 'bestiality', 'escort', 'rape', 'barelylegal',
  ];

  /**
   * Analyze content for inappropriate material
   */
  async analyzeContent(title: string, description: string, caption?: string): Promise<ContentAnalysisResult> {
    const rawText = [title, description, caption].filter(Boolean).join(' ');
    const fullText = rawText.toLowerCase();

    const result: ContentAnalysisResult = {
      containsInappropriateText: false,
      containsSpam: false,
      containsHateSpeech: false,
      // Explicit adult content is allowed on the platform: never flagged as such
      containsExplicitContent: false,
      flaggedKeywords: [],
      confidenceScore: 0,
      shouldAutoReject: false,
      shouldRequireReview: false,
      ruleMatches: [],
    };

    // Prohibited content (minors, non-consent, incest, bestiality, prostitution, illegal)
    const rules = checkText(title, description, caption);
    if (rules.matches.length > 0) {
      result.containsInappropriateText = true;
      result.ruleMatches = rules.matches;
      result.flaggedKeywords.push(...rules.matches.map((match) => match.term));
      result.containsHateSpeech = rules.matches.some((match) => match.category === 'HATE');
      // BLOCK terms reject on their own; REVIEW terms send to a moderator
      result.confidenceScore += rules.blocked ? 1 : 0.4;
    }

    // Check for spam
    const spamFound = this.SPAM_KEYWORDS.filter((keyword) =>
      new RegExp(`(?<![\\p{L}])${keyword}(?![\\p{L}])`, 'iu').test(fullText),
    );

    if (spamFound.length > 0) {
      result.containsSpam = true;
      result.flaggedKeywords.push(...spamFound);
      result.confidenceScore += 0.2;
    }

    // Check spam patterns (on the original case for the caps pattern)
    for (const pattern of this.SPAM_PATTERNS) {
      const matches = rawText.match(pattern);
      if (matches && matches.length > 3) {
        result.containsSpam = true;
        result.confidenceScore += 0.3;
      }
    }

    // Determine actions
    if (rules.blocked || result.confidenceScore >= 0.7) {
      result.shouldAutoReject = true;
    } else if (result.confidenceScore >= 0.4) {
      result.shouldRequireReview = true;
    }

    this.logger.debug(`Content analysis result:`, {
      score: result.confidenceScore,
      shouldReject: result.shouldAutoReject,
      shouldReview: result.shouldRequireReview,
      keywords: result.flaggedKeywords,
    });

    return result;
  }

  /**
   * Analyze image for inappropriate content
   * Note: This is a placeholder. Known illegal media are matched by hash in
   * MediaScanService (media/media-scan); every content is also reviewed by a
   * moderator before publication.
   */
  async analyzeImage(imageUrl: string): Promise<{
    isExplicit: boolean;
    isSuggestive: boolean;
    confidence: number;
  }> {
    // TODO: Integrate with image moderation API
    this.logger.warn('Image moderation not implemented - requires external API');

    return {
      isExplicit: false,
      isSuggestive: false,
      confidence: 0,
    };
  }

  /**
   * Analyze video for inappropriate content
   * Note: This is a placeholder - in production, use a service like AWS Rekognition Video
   */
  async analyzeVideo(videoUrl: string): Promise<{
    isExplicit: boolean;
    isSuggestive: boolean;
    hasViolence: boolean;
    confidence: number;
  }> {
    // TODO: Integrate with video moderation API
    this.logger.warn('Video moderation not implemented - requires external API');

    return {
      isExplicit: false,
      isSuggestive: false,
      hasViolence: false,
      confidence: 0,
    };
  }

  /**
   * Check if username is appropriate: no prohibited term, even glued to other
   * words. Adult words are allowed.
   */
  async isUsernameAppropriate(username: string): Promise<boolean> {
    if (checkText(username).blocked) {
      return false;
    }

    const compact = normalizeText(username)
      .replace(/[^a-z0-9]/g, '')
      .replace(/[013457]/g, (char) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' })[char] ?? char);
    return !this.USERNAME_BLOCKED_FRAGMENTS.some((fragment) => compact.includes(fragment));
  }

  /**
   * Get moderation statistics
   */
  async getModerationStats() {
    const count = (severity: 'BLOCK' | 'REVIEW') =>
      CONTENT_RULES.filter((rule) => rule.severity === severity).reduce((sum, rule) => sum + rule.terms.length, 0);

    return {
      bannedKeywordsCount: count('BLOCK'),
      reviewKeywordsCount: count('REVIEW'),
      spamKeywordsCount: this.SPAM_KEYWORDS.length,
    };
  }
}
