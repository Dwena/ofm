import { BadRequestException } from '@nestjs/common';

/**
 * Settings of the OBS overlay widgets: defaults and validation (pure, no
 * Nest service). Stored as JSON per creator and widget (OverlayWidgetSettings).
 *
 * Colors are `#RRGGBB` or `#RRGGBBAA` (alpha), text templates are plain text
 * (escaped by React when rendered).
 */

export const OVERLAY_WIDGETS = ['ALERTS', 'GOALS', 'TIP_MENU', 'CHAT', 'REQUESTS'] as const;
export type OverlayWidget = (typeof OVERLAY_WIDGETS)[number];

/** Path segment of each widget's overlay page (/overlay/:token/<slug>) */
export const OVERLAY_WIDGET_SLUGS: Record<OverlayWidget, string> = {
  ALERTS: 'alerts',
  GOALS: 'goals',
  TIP_MENU: 'menu',
  CHAT: 'chat',
  REQUESTS: 'requests',
};

/** Recommended size of the OBS browser source of each widget */
export const OVERLAY_WIDGET_SIZES: Record<OverlayWidget, { width: number; height: number }> = {
  ALERTS: { width: 800, height: 600 },
  GOALS: { width: 800, height: 220 },
  TIP_MENU: { width: 500, height: 700 },
  CHAT: { width: 450, height: 700 },
  REQUESTS: { width: 500, height: 500 },
};

export const ALERT_SOUNDS = ['chime', 'coins', 'fanfare', 'pop'] as const;
export const ALERT_ANIMATIONS = ['slide', 'pop', 'fade'] as const;
export const MAX_TEMPLATE_LENGTH = 140;
export const MAX_TITLE_LENGTH = 60;

export interface AlertsSettings {
  /** Euros: smaller tips do not trigger an alert */
  minAmount: number;
  durationSeconds: number;
  soundEnabled: boolean;
  /** 0 to 1 */
  soundVolume: number;
  sound: (typeof ALERT_SOUNDS)[number];
  animation: (typeof ALERT_ANIMATIONS)[number];
  /** {name}, {amount}, {message} */
  textTemplate: string;
  showMessage: boolean;
  menuRequestEnabled: boolean;
  /** {name}, {amount}, {item} */
  menuRequestTemplate: string;
  goalReachedEnabled: boolean;
  /** {amount}, {label}, {total} */
  goalReachedTemplate: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  fontSize: number;
}

export interface GoalsSettings {
  layout: 'bar' | 'list';
  /** `next`: only the next milestone, `all`: every milestone */
  show: 'next' | 'all';
  showAmounts: boolean;
  title: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  fontSize: number;
}

export interface TipMenuSettings {
  columns: 1 | 2;
  maxItems: number;
  title: string;
  showDescriptions: boolean;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  fontSize: number;
}

export interface ChatSettings {
  maxMessages: number;
  /** 0 = messages never fade out */
  hideAfterSeconds: number;
  tipsOnly: boolean;
  showAvatars: boolean;
  fontSize: number;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
}

export interface RequestsSettings {
  /** Also list the requests already done or skipped */
  includeDone: boolean;
  maxItems: number;
  title: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  fontSize: number;
}

export interface OverlaySettingsMap {
  ALERTS: AlertsSettings;
  GOALS: GoalsSettings;
  TIP_MENU: TipMenuSettings;
  CHAT: ChatSettings;
  REQUESTS: RequestsSettings;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettingsMap = {
  ALERTS: {
    minAmount: 1,
    durationSeconds: 6,
    soundEnabled: true,
    soundVolume: 0.6,
    sound: 'chime',
    animation: 'pop',
    textTemplate: '{name} a envoyé {amount} !',
    showMessage: true,
    menuRequestEnabled: true,
    menuRequestTemplate: '{name} a demandé : {item}',
    goalReachedEnabled: true,
    goalReachedTemplate: '🎯 Palier atteint : {amount} — {label}',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827D9',
    fontSize: 34,
  },
  GOALS: {
    layout: 'bar',
    show: 'all',
    showAmounts: true,
    title: 'Objectifs de dons',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
  TIP_MENU: {
    columns: 1,
    maxItems: 8,
    title: 'Menu des pourboires',
    showDescriptions: false,
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
  CHAT: {
    maxMessages: 10,
    hideAfterSeconds: 0,
    tipsOnly: false,
    showAvatars: true,
    fontSize: 18,
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#11182799',
  },
  REQUESTS: {
    includeDone: false,
    maxItems: 5,
    title: 'Demandes du menu',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
};

// ---- Field rules -----------------------------------------------------------

type Rule =
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly (string | number)[] }
  | { kind: 'text'; max: number; allowEmpty?: boolean }
  | { kind: 'color' };

const num = (min: number, max: number, integer = false): Rule => ({ kind: 'number', min, max, integer });
const bool: Rule = { kind: 'boolean' };
const oneOf = (values: readonly (string | number)[]): Rule => ({ kind: 'enum', values });
const text = (max: number, allowEmpty = false): Rule => ({ kind: 'text', max, allowEmpty });
const color: Rule = { kind: 'color' };

const COLORS = { textColor: color, accentColor: color, backgroundColor: color };

const RULES: { [W in OverlayWidget]: Record<keyof OverlaySettingsMap[W], Rule> } = {
  ALERTS: {
    minAmount: num(0, 10000),
    durationSeconds: num(3, 20, true),
    soundEnabled: bool,
    soundVolume: num(0, 1),
    sound: oneOf(ALERT_SOUNDS),
    animation: oneOf(ALERT_ANIMATIONS),
    textTemplate: text(MAX_TEMPLATE_LENGTH),
    showMessage: bool,
    menuRequestEnabled: bool,
    menuRequestTemplate: text(MAX_TEMPLATE_LENGTH),
    goalReachedEnabled: bool,
    goalReachedTemplate: text(MAX_TEMPLATE_LENGTH),
    ...COLORS,
    fontSize: num(16, 72, true),
  },
  GOALS: {
    layout: oneOf(['bar', 'list']),
    show: oneOf(['next', 'all']),
    showAmounts: bool,
    title: text(MAX_TITLE_LENGTH, true),
    ...COLORS,
    fontSize: num(12, 48, true),
  },
  TIP_MENU: {
    columns: oneOf([1, 2]),
    maxItems: num(1, 20, true),
    title: text(MAX_TITLE_LENGTH, true),
    showDescriptions: bool,
    ...COLORS,
    fontSize: num(12, 48, true),
  },
  CHAT: {
    maxMessages: num(1, 50, true),
    hideAfterSeconds: num(0, 600, true),
    tipsOnly: bool,
    showAvatars: bool,
    fontSize: num(12, 48, true),
    ...COLORS,
  },
  REQUESTS: {
    includeDone: bool,
    maxItems: num(1, 20, true),
    title: text(MAX_TITLE_LENGTH, true),
    ...COLORS,
    fontSize: num(12, 48, true),
  },
};

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export const isOverlayWidget = (value: unknown): value is OverlayWidget =>
  typeof value === 'string' && (OVERLAY_WIDGETS as readonly string[]).includes(value);

/** Widget of a path parameter: `ALERTS`, `alerts`, `menu`, `tip_menu`... */
export function parseOverlayWidget(value: unknown): OverlayWidget | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase().replace(/-/g, '_');
  if (isOverlayWidget(upper)) return upper;
  const bySlug = OVERLAY_WIDGETS.find((widget) => OVERLAY_WIDGET_SLUGS[widget] === value.trim().toLowerCase());
  return bySlug ?? null;
}

/** Value checked against its rule; returns the cleaned value or an error message */
function checkValue(key: string, rule: Rule, value: unknown): { value: unknown } | { error: string } {
  switch (rule.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${key} must be a number` };
      if (rule.integer && !Number.isInteger(value)) return { error: `${key} must be an integer` };
      if (value < rule.min || value > rule.max) {
        return { error: `${key} must be between ${rule.min} and ${rule.max}` };
      }
      return { value: rule.integer ? value : Math.round(value * 100) / 100 };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { value } : { error: `${key} must be a boolean` };
    case 'enum':
      return rule.values.includes(value as string | number)
        ? { value }
        : { error: `${key} must be one of: ${rule.values.join(', ')}` };
    case 'text': {
      if (typeof value !== 'string') return { error: `${key} must be a string` };
      // Single line: control characters (newlines...) are dropped
      // eslint-disable-next-line no-control-regex
      const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (!cleaned && !rule.allowEmpty) return { error: `${key} should not be empty` };
      if (cleaned.length > rule.max) return { error: `${key} must be at most ${rule.max} characters` };
      return { value: cleaned };
    }
    case 'color':
      return typeof value === 'string' && COLOR_PATTERN.test(value)
        ? { value: value.toUpperCase() }
        : { error: `${key} must be a color (#RRGGBB or #RRGGBBAA)` };
  }
}

/**
 * Settings sent by the creator (PUT), validated strictly: every key must be
 * known and valid (400 otherwise). Missing keys keep their `current` value,
 * so a partial update is fine.
 */
export function validateWidgetSettings<W extends OverlayWidget>(
  widget: W,
  input: unknown,
  current: OverlaySettingsMap[W] = DEFAULT_OVERLAY_SETTINGS[widget],
): OverlaySettingsMap[W] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Settings must be an object');
  }
  const rules = RULES[widget] as Record<string, Rule>;
  const result: Record<string, unknown> = { ...current };
  const errors: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const rule = rules[key];
    if (!rule) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }
    const checked = checkValue(key, rule, value);
    if ('error' in checked) {
      errors.push(checked.error);
    } else {
      result[key] = checked.value;
    }
  }
  if (errors.length > 0) {
    throw new BadRequestException(errors);
  }
  return result as unknown as OverlaySettingsMap[W];
}

/**
 * Stored settings, read leniently: unknown keys are dropped and invalid or
 * missing values fall back to the defaults (settings saved by an older or
 * newer version never break an overlay)
 */
export function normalizeWidgetSettings<W extends OverlayWidget>(widget: W, stored: unknown): OverlaySettingsMap[W] {
  const defaults = DEFAULT_OVERLAY_SETTINGS[widget] as unknown as Record<string, unknown>;
  const rules = RULES[widget] as Record<string, Rule>;
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in source)) continue;
    const checked = checkValue(key, rule, source[key]);
    if ('value' in checked) result[key] = checked.value;
  }
  return result as unknown as OverlaySettingsMap[W];
}
