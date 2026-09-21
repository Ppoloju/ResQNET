import { describe, it, expect } from 'vitest';
import { classifyFromText, EMERGENCY_PROMPT_SUGGESTIONS } from './ai.js';
import { triageHelp } from './triage.js';

describe('local AI classifier (Phase 6)', () => {
  it('classifies a medical emergency as CRITICAL', () => {
    const r = classifyFromText({ text: 'I fell down the stairs and I am bleeding heavily, I cannot move my leg' });
    expect(r.category).toBe('MEDICAL');
    expect(r.severity).toBe('CRITICAL');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('elevates severity when immobility flag is set even with mild text', () => {
    const r = classifyFromText({ text: 'I feel a bit dizzy', saysImmobile: true });
    expect(r.severity).toBe('CRITICAL');
    expect(r.category).toBe('MEDICAL');
    expect(r.matched).toContain('immobility-flag');
  });

  it('classifies fire and personal-safety scenarios', () => {
    const fire = classifyFromText({ text: 'There is a fire in the building, smoke everywhere' });
    expect(fire.category).toBe('FIRE');
    const crime = classifyFromText({ text: 'Someone is following me with a weapon, I feel threatened' });
    expect(crime.category).toBe('PERSONAL_SAFETY');
  });

  it('keeps low severity for neutral text', () => {
    const r = classifyFromText({ text: 'hello there' });
    expect(r.category).toBe('UNKNOWN');
    expect(r.severity).not.toBe('CRITICAL');
  });

  it('SOS with no classifiable text still rates HIGH (no-text-fallback)', () => {
    const r = classifyFromText({ text: 'I need help' }); // no keyword match
    expect(r.category).toBe('UNKNOWN');
    expect(r.severity).toBe('HIGH');
  });

  it('low battery is recorded as context, never inflates category', () => {
    const r = classifyFromText({ text: 'checking in', battery: 10 });
    expect(r.category).not.toBe('CRITICAL'); // battery is context, not a category
    expect(r.engine).toBe('iqoo-rules-v1');
  });

  it('is deterministic for identical input', () => {
    const a = classifyFromText({ text: 'earthquake collapsed building trapped' });
    const b = classifyFromText({ text: 'earthquake collapsed building trapped' });
    expect(a).toEqual(b);
  });

  it('exposes prompt suggestions for voice UX', () => {
    expect(EMERGENCY_PROMPT_SUGGESTIONS.length).toBeGreaterThan(2);
  });

  it('routes lost users to maps instead of SOS', () => {
    expect(triageHelp('I am lost and need directions').action).toBe('OFFLINE_MAP');
  });

  it('routes high-risk medical help to SOS', () => {
    const result = triageHelp('I have severe bleeding and cannot move');
    expect(result.action).toBe('SOS');
    expect(result.severity).toBe('CRITICAL');
  });

  it('routes general assistance to the local chat', () => {
    expect(triageHelp('I need assistance carrying my bag').action).toBe('CHAT');
  });
});
