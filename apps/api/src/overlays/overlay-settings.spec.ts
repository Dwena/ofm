import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_OVERLAY_SETTINGS,
  normalizeWidgetSettings,
  OVERLAY_WIDGETS,
  parseOverlayWidget,
  validateWidgetSettings,
} from './overlay-settings';

const messagesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as { message: string | string[] };
    return Array.isArray(response.message) ? response.message : [response.message];
  }
  throw new Error('Expected a BadRequestException');
};

describe('overlay settings', () => {
  it('has defaults for every widget, valid against their own rules', () => {
    for (const widget of OVERLAY_WIDGETS) {
      expect(DEFAULT_OVERLAY_SETTINGS[widget]).toBeDefined();
      expect(validateWidgetSettings(widget, DEFAULT_OVERLAY_SETTINGS[widget])).toEqual(DEFAULT_OVERLAY_SETTINGS[widget]);
    }
    expect(DEFAULT_OVERLAY_SETTINGS.ALERTS.textTemplate).toBe('{name} a envoyé {amount} !');
    expect(DEFAULT_OVERLAY_SETTINGS.ALERTS.menuRequestTemplate).toBe('{name} a demandé : {item}');
    expect(DEFAULT_OVERLAY_SETTINGS.ALERTS.goalReachedTemplate).toBe('🎯 Palier atteint : {amount} — {label}');
  });

  it('merges a partial update on top of the current settings', () => {
    const current = { ...DEFAULT_OVERLAY_SETTINGS.ALERTS, minAmount: 5 };
    const result = validateWidgetSettings('ALERTS', { durationSeconds: 10, animation: 'slide', accentColor: '#ff00aa80' }, current);
    expect(result).toEqual({ ...current, durationSeconds: 10, animation: 'slide', accentColor: '#FF00AA80' });
  });

  it('keeps adult / free text as typed (only trimmed, single line)', () => {
    const result = validateWidgetSettings('ALERTS', { textTemplate: '  {name} 🍑 vient de lâcher {amount} 🔥\n' });
    expect(result.textTemplate).toBe('{name} 🍑 vient de lâcher {amount} 🔥');
  });

  it.each([
    ['ALERTS', { durationSeconds: 2 }, 'durationSeconds must be between 3 and 20'],
    ['ALERTS', { durationSeconds: 21 }, 'durationSeconds must be between 3 and 20'],
    ['ALERTS', { durationSeconds: 5.5 }, 'durationSeconds must be an integer'],
    ['ALERTS', { soundVolume: 1.5 }, 'soundVolume must be between 0 and 1'],
    ['ALERTS', { sound: 'airhorn.mp3' }, 'sound must be one of: chime, coins, fanfare, pop'],
    ['ALERTS', { animation: 'spin' }, 'animation must be one of: slide, pop, fade'],
    ['ALERTS', { minAmount: -1 }, 'minAmount must be between 0 and 10000'],
    ['ALERTS', { textTemplate: '   ' }, 'textTemplate should not be empty'],
    ['ALERTS', { textTemplate: 'x'.repeat(141) }, 'textTemplate must be at most 140 characters'],
    ['ALERTS', { textColor: 'red' }, 'textColor must be a color (#RRGGBB or #RRGGBBAA)'],
    ['ALERTS', { showMessage: 'yes' }, 'showMessage must be a boolean'],
    ['GOALS', { layout: 'circle' }, 'layout must be one of: bar, list'],
    ['GOALS', { show: 'some' }, 'show must be one of: next, all'],
    ['TIP_MENU', { columns: 3 }, 'columns must be one of: 1, 2'],
    ['TIP_MENU', { maxItems: 0 }, 'maxItems must be between 1 and 20'],
    ['CHAT', { maxMessages: 51 }, 'maxMessages must be between 1 and 50'],
    ['CHAT', { hideAfterSeconds: -5 }, 'hideAfterSeconds must be between 0 and 600'],
    ['REQUESTS', { includeDone: 1 }, 'includeDone must be a boolean'],
    ['CHAT', { fontSize: '18' }, 'fontSize must be a number'],
  ] as const)('%s rejects %j', (widget, input, message) => {
    expect(messagesOf(() => validateWidgetSettings(widget, input))).toContain(message);
  });

  it('rejects unknown keys and non-object payloads', () => {
    expect(messagesOf(() => validateWidgetSettings('CHAT', { css: 'body{}' }))).toContain('Unknown setting: css');
    // A setting of another widget is unknown here
    expect(messagesOf(() => validateWidgetSettings('CHAT', { layout: 'bar' }))).toContain('Unknown setting: layout');
    expect(messagesOf(() => validateWidgetSettings('CHAT', null))).toContain('Settings must be an object');
    expect(messagesOf(() => validateWidgetSettings('CHAT', [1]))).toContain('Settings must be an object');
  });

  it('reports every invalid field at once', () => {
    expect(messagesOf(() => validateWidgetSettings('CHAT', { maxMessages: 0, showAvatars: 'no' }))).toEqual([
      'maxMessages must be between 1 and 50',
      'showAvatars must be a boolean',
    ]);
  });

  it('reads stored settings leniently: defaults for missing / invalid values, unknown keys dropped', () => {
    expect(normalizeWidgetSettings('GOALS', null)).toEqual(DEFAULT_OVERLAY_SETTINGS.GOALS);
    expect(normalizeWidgetSettings('GOALS', { layout: 'list', fontSize: 999, legacy: true })).toEqual({
      ...DEFAULT_OVERLAY_SETTINGS.GOALS,
      layout: 'list',
    });
  });

  it('parses widget path parameters (enum value or slug)', () => {
    expect(parseOverlayWidget('ALERTS')).toBe('ALERTS');
    expect(parseOverlayWidget('alerts')).toBe('ALERTS');
    expect(parseOverlayWidget('menu')).toBe('TIP_MENU');
    expect(parseOverlayWidget('tip-menu')).toBe('TIP_MENU');
    expect(parseOverlayWidget('requests')).toBe('REQUESTS');
    expect(parseOverlayWidget('video')).toBeNull();
    expect(parseOverlayWidget(undefined)).toBeNull();
  });
});
