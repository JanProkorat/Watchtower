import { describe, it, expect } from 'vitest';
import {
  detectAreaCode,
  extractEpicShortcut,
  pickProjectForKey,
} from '../../orchestrator/services/jiraRouting.js';
import type { ProjectViewPayload } from '../../shared/ipcContract.js';

function project(overrides: Partial<ProjectViewPayload>): ProjectViewPayload {
  return {
    id: 1,
    name: 'P',
    color: '#7aa7ff',
    archived: false,
    kind: 'work',
    isDefault: false,
    folderPath: null,
    jiraGlobs: [],
    description: null,
    createdAt: '2026-01-01T00:00:00Z',
    epicCount: 0,
    totalMinutes: 0,
    ...overrides,
  };
}

describe('detectAreaCode', () => {
  it('extracts area code from a summary bracket tag', () => {
    expect(detectAreaCode('[TEH] Požadavek na změnu', null)).toBe('TEH');
    expect(detectAreaCode('  [VYR]  foo bar', null)).toBe('VYR');
    expect(detectAreaCode('[INFRA] Update', null)).toBe('INFRA');
  });

  it('falls back to epic-summary prefix when no summary tag', () => {
    expect(detectAreaCode('No tag here', 'TEH-Požadavek na NC program')).toBe('TEH');
    expect(detectAreaCode('No tag', 'VYR Foo')).toBe('VYR');
  });

  it('returns null when nothing matches', () => {
    expect(detectAreaCode('No tag here', null)).toBeNull();
    expect(detectAreaCode('No tag here', 'no prefix lowercase')).toBeNull();
  });

  it('summary tag wins over epic prefix', () => {
    expect(detectAreaCode('[KP] foo', 'TEH-something')).toBe('KP');
  });
});

describe('extractEpicShortcut', () => {
  it('extracts the uppercase code before a hyphen', () => {
    expect(extractEpicShortcut('TEH - Technologický postup')).toBe('TEH');
    expect(extractEpicShortcut('VYR-Výroba')).toBe('VYR');
    expect(extractEpicShortcut('KP - Capacity Planning')).toBe('KP');
  });

  it('handles en-dash, em-dash, colon, and slash separators', () => {
    expect(extractEpicShortcut('VYR — Výroba')).toBe('VYR');
    expect(extractEpicShortcut('TEH – Tech')).toBe('TEH');
    expect(extractEpicShortcut('KK: Kvalita')).toBe('KK');
    expect(extractEpicShortcut('SZ/Servis')).toBe('SZ');
  });

  it('extracts the prefix from an epic key (TEH-456 → TEH)', () => {
    expect(extractEpicShortcut('TEH-456')).toBe('TEH');
    expect(extractEpicShortcut('FIE1933-19000')).toBe('FIE1933');
  });

  it('preserves mixed-case area names like Infrastruktura', () => {
    expect(extractEpicShortcut('Infrastruktura')).toBe('Infrastruktura');
    expect(extractEpicShortcut('Infrastruktura - Síť')).toBe('Infrastruktura');
  });

  it('returns null for empty / whitespace-only / null input', () => {
    expect(extractEpicShortcut(null)).toBeNull();
    expect(extractEpicShortcut(undefined)).toBeNull();
    expect(extractEpicShortcut('')).toBeNull();
    expect(extractEpicShortcut('   ')).toBeNull();
  });

  it('returns the whole string trimmed when no separator is present', () => {
    expect(extractEpicShortcut('  OnlyOneWord  ')).toBe('OnlyOneWord');
  });
});

describe('pickProjectForKey', () => {
  const pps = project({ id: 1, name: 'PPS', jiraGlobs: ['FIE1933-*'] });
  const wt = project({ id: 2, name: 'WT-Local', jiraGlobs: ['WT-*'] });
  const archived = project({ id: 3, name: 'Old', archived: true, jiraGlobs: ['FIE1933-*'] });

  it('picks the project whose glob matches the key', () => {
    expect(pickProjectForKey('FIE1933-19796', [pps, wt])?.id).toBe(1);
    expect(pickProjectForKey('WT-42', [pps, wt])?.id).toBe(2);
  });

  it('skips archived projects', () => {
    expect(pickProjectForKey('FIE1933-19796', [archived])).toBeNull();
  });

  it('returns null when no glob matches', () => {
    expect(pickProjectForKey('UNKNOWN-1', [pps, wt])).toBeNull();
  });

  it('returns null on projects with empty jiraGlobs', () => {
    expect(pickProjectForKey('X-1', [project({ id: 9, jiraGlobs: [] })])).toBeNull();
  });

  it('handles globs without a wildcard (exact match)', () => {
    const exact = project({ id: 4, name: 'Exact', jiraGlobs: ['ONE-1'] });
    expect(pickProjectForKey('ONE-1', [exact])?.id).toBe(4);
    expect(pickProjectForKey('ONE-2', [exact])).toBeNull();
  });
});
