import { describe, expect, it } from 'vitest';
import { detectAuthSensitiveReleaseChanges, missingRequiredSecrets } from './deploy-preflight.mjs';

describe('deployment secret preflight', () => {
  it('reports every production secret that is absent', () => {
    expect(missingRequiredSecrets([
      { name: 'ATTRIBUTE_QUESTION_SECRET', type: 'secret_text' },
    ])).toEqual(['EMAIL_HASH_SECRET']);
  });

  it('passes when all required production secrets exist', () => {
    expect(missingRequiredSecrets([
      { name: 'ATTRIBUTE_QUESTION_SECRET', type: 'secret_text' },
      { name: 'EMAIL_HASH_SECRET', type: 'secret_text' },
    ])).toEqual([]);
  });

  it('warns when a login-path change introduces a required environment secret', () => {
    expect(detectAuthSensitiveReleaseChanges({
      changedFiles: ['worker/auth.ts', 'worker/env.ts'],
      diff: [
        '+  EMAIL_HASH_SECRET?: string;',
        '+  const emailHash = await hashEmail(profile.email, c.env.EMAIL_HASH_SECRET);',
      ].join('\n'),
    })).toEqual({
      environmentBindings: ['EMAIL_HASH_SECRET'],
      warnings: [
        'Google 登入、帳號建立或 Session 必經路徑有修改',
        '正式環境綁定、Google Client ID／來源或 CSP 有修改',
        '環境綁定有增刪：EMAIL_HASH_SECRET',
      ],
    });
  });

  it('warns when authentication tables or Google browser policy change', () => {
    const result = detectAuthSensitiveReleaseChanges({
      changedFiles: ['migrations/0099_sessions.sql', 'public/_headers'],
      diff: '-Content-Security-Policy: script-src https://accounts.google.com/gsi/client\n+DROP TABLE sessions;',
    });

    expect(result.warnings).toContain('正式環境綁定、Google Client ID／來源或 CSP 有修改');
    expect(result.warnings).toContain('使用者、權限或 Session 資料庫結構有修改');
  });

  it('does not warn for an unrelated workspace presentation change', () => {
    expect(detectAuthSensitiveReleaseChanges({
      changedFiles: ['src/workspace/WorkspaceBottomNavigation.tsx', 'src/styles.css'],
      diff: '+font-size: 14px;',
    })).toEqual({ environmentBindings: [], warnings: [] });
  });
});
