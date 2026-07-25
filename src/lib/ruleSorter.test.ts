import { describe, it, expect } from 'vitest';
import { classifyRuleUniversally, groupRulesUniversally } from './ruleSorter';
import type { RuleCard } from '../shared/types';

describe('ruleSorter', () => {
  describe('classifyRuleUniversally', () => {
    it('should classify rule with no highlighting features as general', () => {
      const rule = {
        id: '1',
        title: 'Rule 1',
        description: 'desc',
        tags: [],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('general');
    });

    it('should classify rule with commonMistake as highlight', () => {
      const rule = {
        id: '2',
        title: 'Rule 2',
        description: 'desc',
        commonMistake: 'People often do this wrong',
        tags: [],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('highlight');
    });

    it('should classify rule with 設置 tag as setup', () => {
      const rule = {
        id: '3',
        title: 'Rule 3',
        description: 'desc',
        tags: [{ id: 't1', name: '設置' }],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('setup');
    });

    it('should classify rule with 終局計分 tag as scoring', () => {
      const rule = {
        id: '4',
        title: 'Rule 4',
        description: 'desc',
        tags: [{ id: 't2', name: '終局計分' }],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('scoring');
    });

    it('should classify rule with tags as gameplay', () => {
      const rule = {
        id: '5',
        title: 'Rule 5',
        description: 'desc',
        tags: [{ id: 't3', name: '移動' }],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('gameplay');
    });

    it('should classify rule without tags as general', () => {
      const rule = {
        id: '6',
        title: 'Rule 6',
        description: 'desc',
        tags: [],
      } as unknown as RuleCard;
      expect(classifyRuleUniversally(rule)).toBe('general');
    });
  });

  describe('groupRulesUniversally', () => {
    it('should filter out empty categories and return sorted groups', () => {
      const rules = [
        {
          id: '1',
          title: 'Rule 1',
          commonMistake: 'yes',
          tags: [],
        } as unknown as RuleCard,
        {
          id: '2',
          title: 'Rule 2',
          tags: [{ id: 't1', name: '設置' }],
        } as unknown as RuleCard,
      ];

      const result = groupRulesUniversally(rules);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('highlight');
      expect(result[0].rules.length).toBe(1);
      expect(result[1].id).toBe('setup');
      expect(result[1].rules.length).toBe(1);
    });
  });
});
