import { Injectable, Logger } from '@nestjs/common';
import { ContentAnalysisResult } from './dto/moderation.dto';

@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  // Mots-clés interdits (hate speech, violence, etc.)
  private readonly BANNED_KEYWORDS = [
    // Violence
    'tuer', 'violence', 'arme', 'bombe', 'terrorisme', 'meurtre',
    // Hate speech
    'raciste', 'nazi', 'discrimination', 'haine',
    // Contenu explicite
    'porno', 'xxx', 'sexe explicite',
    // Autres
    'drogue', 'stupéfiant', 'trafic',
  ];

  // Mots-clés de spam
  private readonly SPAM_KEYWORDS = [
    'cliquez ici', 'gratuit', 'gagnez', 'offre limitée',
    'argent facile', 'devenez riche', 'miracle',
    'viagra', 'casino', 'loterie', 'promotion',
  ];

  // Pattern de spam (liens répétés, caps lock excessif, etc.)
  private readonly SPAM_PATTERNS = [
    /https?:\/\/[^\s]+/gi, // Multiple URLs
    /[A-Z]{10,}/, // Excessive caps
    /(.)\1{5,}/, // Repeated characters
  ];

  /**
   * Analyze content for inappropriate material
   */
  async analyzeContent(title: string, description: string): Promise<ContentAnalysisResult> {
    const fullText = `${title} ${description}`.toLowerCase();

    const result: ContentAnalysisResult = {
      containsInappropriateText: false,
      containsSpam: false,
      containsHateSpeech: false,
      containsExplicitContent: false,
      flaggedKeywords: [],
      confidenceScore: 0,
      shouldAutoReject: false,
      shouldRequireReview: false,
    };

    // Check for banned keywords
    const bannedFound = this.BANNED_KEYWORDS.filter(keyword =>
      fullText.includes(keyword.toLowerCase())
    );

    if (bannedFound.length > 0) {
      result.containsInappropriateText = true;
      result.flaggedKeywords.push(...bannedFound);
      result.confidenceScore += 0.4;
    }

    // Check for spam
    const spamFound = this.SPAM_KEYWORDS.filter(keyword =>
      fullText.includes(keyword.toLowerCase())
    );

    if (spamFound.length > 0) {
      result.containsSpam = true;
      result.flaggedKeywords.push(...spamFound);
      result.confidenceScore += 0.2;
    }

    // Check spam patterns
    for (const pattern of this.SPAM_PATTERNS) {
      const matches = fullText.match(pattern);
      if (matches && matches.length > 3) {
        result.containsSpam = true;
        result.confidenceScore += 0.3;
      }
    }

    // Check for excessive profanity
    const profanityCount = this.countProfanity(fullText);
    if (profanityCount > 3) {
      result.containsInappropriateText = true;
      result.confidenceScore += 0.2;
    }

    // Determine actions
    if (result.confidenceScore >= 0.7) {
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
   * Note: This is a placeholder - in production, use a service like AWS Rekognition, Google Vision API, etc.
   */
  async analyzeImage(imageUrl: string): Promise<{
    isExplicit: boolean;
    isSuggestive: boolean;
    confidence: number;
  }> {
    // TODO: Integrate with image moderation API
    // For now, return a placeholder
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
   * Count profanity occurrences
   */
  private countProfanity(text: string): number {
    const profanityList = [
      'merde', 'putain', 'connard', 'salope', 'enculé',
      // Add more as needed
    ];

    let count = 0;
    for (const word of profanityList) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        count += matches.length;
      }
    }

    return count;
  }

  /**
   * Check if username is appropriate
   */
  async isUsernameAppropriate(username: string): Promise<boolean> {
    const lowerUsername = username.toLowerCase();

    // Check against banned keywords
    for (const keyword of this.BANNED_KEYWORDS) {
      if (lowerUsername.includes(keyword)) {
        return false;
      }
    }

    // Check against profanity
    if (this.countProfanity(lowerUsername) > 0) {
      return false;
    }

    return true;
  }

  /**
   * Get moderation statistics
   */
  async getModerationStats() {
    // This could be expanded to provide analytics
    return {
      bannedKeywordsCount: this.BANNED_KEYWORDS.length,
      spamKeywordsCount: this.SPAM_KEYWORDS.length,
    };
  }
}
