import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface WatermarkOptions {
  text?: string;
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number;
  fontSize?: number;
  color?: string;
  logoPath?: string;
}

@Injectable()
export class WatermarkService {
  private readonly logger = new Logger(WatermarkService.name);
  private readonly defaultWatermarkText: string;
  private readonly defaultLogoPath: string;

  constructor(private configService: ConfigService) {
    this.defaultWatermarkText = this.configService.get(
      'WATERMARK_TEXT',
      'OFM Premium',
    );
    this.defaultLogoPath = this.configService.get(
      'WATERMARK_LOGO_PATH',
      './assets/watermark-logo.png',
    );
  }

  /**
   * Add watermark to image using sharp
   */
  async watermarkImage(
    imageBuffer: Buffer,
    options: WatermarkOptions = {},
  ): Promise<Buffer> {
    try {
      const {
        text = this.defaultWatermarkText,
        position = 'bottom-right',
        opacity = 0.5,
        fontSize = 32,
        color = 'white',
      } = options;

      // Get image metadata
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const width = metadata.width || 1000;
      const height = metadata.height || 1000;

      // Create watermark text as SVG
      const watermarkSvg = this.createWatermarkSvg(
        text,
        fontSize,
        color,
        opacity,
      );

      // Calculate position
      const { left, top } = this.calculatePosition(
        position,
        width,
        height,
        fontSize * text.length * 0.6, // Approximate text width
        fontSize * 1.5, // Approximate text height
      );

      // Apply watermark
      const watermarkedBuffer = await image
        .composite([
          {
            input: Buffer.from(watermarkSvg),
            top: Math.floor(top),
            left: Math.floor(left),
          },
        ])
        .toBuffer();

      this.logger.log('Image watermarked successfully');
      return watermarkedBuffer;
    } catch (error) {
      this.logger.error('Failed to watermark image:', error);
      throw error;
    }
  }

  /**
   * Add watermark to image with logo
   */
  async watermarkImageWithLogo(
    imageBuffer: Buffer,
    logoPath: string = this.defaultLogoPath,
    options: WatermarkOptions = {},
  ): Promise<Buffer> {
    try {
      const { position = 'bottom-right', opacity = 0.7 } = options;

      // Get image metadata
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const width = metadata.width || 1000;
      const height = metadata.height || 1000;

      // Check if logo exists
      try {
        await fs.access(logoPath);
      } catch {
        this.logger.warn(`Logo not found at ${logoPath}, using text watermark`);
        return this.watermarkImage(imageBuffer, options);
      }

      // Resize logo (max 15% of image width)
      const logoMaxWidth = Math.floor(width * 0.15);
      const logoBuffer = await sharp(logoPath)
        .resize(logoMaxWidth, null, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();

      // Get logo dimensions
      const logoMetadata = await sharp(logoBuffer).metadata();
      const logoWidth = logoMetadata.width || 100;
      const logoHeight = logoMetadata.height || 100;

      // Calculate position
      const { left, top } = this.calculatePosition(
        position,
        width,
        height,
        logoWidth,
        logoHeight,
      );

      // Apply opacity to logo
      const transparentLogo = await sharp(logoBuffer)
        .composite([
          {
            input: Buffer.from(
              `<svg><rect x="0" y="0" width="${logoWidth}" height="${logoHeight}" fill="black" opacity="${1 - opacity}"/></svg>`,
            ),
            blend: 'dest-in',
          },
        ])
        .toBuffer();

      // Apply watermark
      const watermarkedBuffer = await image
        .composite([
          {
            input: transparentLogo,
            top: Math.floor(top),
            left: Math.floor(left),
          },
        ])
        .toBuffer();

      this.logger.log('Image watermarked with logo successfully');
      return watermarkedBuffer;
    } catch (error) {
      this.logger.error('Failed to watermark image with logo:', error);
      throw error;
    }
  }

  /**
   * Add watermark to video using ffmpeg
   */
  async watermarkVideo(
    inputPath: string,
    outputPath: string,
    options: WatermarkOptions = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const {
        text = this.defaultWatermarkText,
        position = 'bottom-right',
        opacity = 0.5,
        fontSize = 24,
        color = 'white',
      } = options;

      // Convert position to ffmpeg drawtext position
      const positionMap = {
        'top-left': 'x=10:y=10',
        'top-right': 'x=w-tw-10:y=10',
        'bottom-left': 'x=10:y=h-th-10',
        'bottom-right': 'x=w-tw-10:y=h-th-10',
        center: 'x=(w-tw)/2:y=(h-th)/2',
      };

      const drawTextPosition = positionMap[position];
      const alpha = opacity;

      // Create ffmpeg command
      ffmpeg(inputPath)
        .videoFilters([
          {
            filter: 'drawtext',
            options: {
              text,
              fontsize: fontSize,
              fontcolor: `${color}@${alpha}`,
              ...this.parsePosition(drawTextPosition),
            },
          },
        ])
        .output(outputPath)
        .on('end', () => {
          this.logger.log('Video watermarked successfully');
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          this.logger.error('Failed to watermark video:', err);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Add logo watermark to video
   */
  async watermarkVideoWithLogo(
    inputPath: string,
    outputPath: string,
    logoPath: string = this.defaultLogoPath,
    options: WatermarkOptions = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const { position = 'bottom-right', opacity = 0.7 } = options;

      // Convert position to overlay position
      const positionMap = {
        'top-left': 'x=10:y=10',
        'top-right': 'x=W-w-10:y=10',
        'bottom-left': 'x=10:y=H-h-10',
        'bottom-right': 'x=W-w-10:y=H-h-10',
        center: 'x=(W-w)/2:y=(H-h)/2',
      };

      const overlayPosition = positionMap[position];

      ffmpeg(inputPath)
        .input(logoPath)
        .complexFilter([
          // Scale logo to 15% of video width
          '[1:v]scale=iw*0.15:-1[logo]',
          // Add transparency
          `[logo]format=rgba,colorchannelmixer=aa=${opacity}[logo_transparent]`,
          // Overlay on video
          `[0:v][logo_transparent]overlay=${overlayPosition}`,
        ])
        .output(outputPath)
        .on('end', () => {
          this.logger.log('Video watermarked with logo successfully');
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          this.logger.error('Failed to watermark video with logo:', err);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Create SVG for text watermark
   */
  private createWatermarkSvg(
    text: string,
    fontSize: number,
    color: string,
    opacity: number,
  ): string {
    return `
      <svg width="${fontSize * text.length * 0.6}" height="${fontSize * 1.5}">
        <style>
          .watermark {
            font-family: Arial, sans-serif;
            font-size: ${fontSize}px;
            font-weight: bold;
            fill: ${color};
            opacity: ${opacity};
          }
        </style>
        <text x="0" y="${fontSize}" class="watermark">${this.escapeXml(text)}</text>
      </svg>
    `;
  }

  /**
   * Calculate watermark position
   */
  private calculatePosition(
    position: string,
    imageWidth: number,
    imageHeight: number,
    watermarkWidth: number,
    watermarkHeight: number,
  ): { left: number; top: number } {
    const padding = 20;

    switch (position) {
      case 'top-left':
        return { left: padding, top: padding };
      case 'top-right':
        return { left: imageWidth - watermarkWidth - padding, top: padding };
      case 'bottom-left':
        return { left: padding, top: imageHeight - watermarkHeight - padding };
      case 'bottom-right':
        return {
          left: imageWidth - watermarkWidth - padding,
          top: imageHeight - watermarkHeight - padding,
        };
      case 'center':
        return {
          left: (imageWidth - watermarkWidth) / 2,
          top: (imageHeight - watermarkHeight) / 2,
        };
      default:
        return {
          left: imageWidth - watermarkWidth - padding,
          top: imageHeight - watermarkHeight - padding,
        };
    }
  }

  /**
   * Parse ffmpeg position string
   */
  private parsePosition(positionStr: string): Record<string, string> {
    const parts = positionStr.split(':');
    const result: Record<string, string> = {};

    parts.forEach((part) => {
      const [key, value] = part.split('=');
      result[key] = value;
    });

    return result;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Check if content should be watermarked
   */
  shouldWatermark(content: {
    isPpv?: boolean;
    tier?: { name: string };
    visibility?: string;
  }): boolean {
    // Watermark PPV content
    if (content.isPpv) {
      return true;
    }

    // Watermark premium tier content
    if (content.tier && ['PREMIUM', 'VIP'].includes(content.tier.name)) {
      return true;
    }

    // Don't watermark public content
    if (content.visibility === 'PUBLIC') {
      return false;
    }

    // Watermark subscribers-only content
    return content.visibility === 'SUBSCRIBERS_ONLY';
  }
}
