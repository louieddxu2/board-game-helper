import type { RuleCard } from '../shared/types';
import { parseSafeExternalUrl } from '../shared/externalUrl';
import { ExternalLinkGuard } from './ExternalLinkGuard';

const SourceContent = ({ value, external, ordinal }: { value: string; external?: boolean; ordinal?: number }) => <>
  <span className="rule-source-title">來源{ordinal}{external && <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 17 17 7M7 7h10v10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>}</span>{' '}
  <span className="rule-source-value" title={value}>{value}</span>
</>;

export const RuleCardSource = ({ sourceLabel, sourceLinks }: Pick<RuleCard, 'sourceLabel' | 'sourceLinks'>) => (
  <div className="rule-source" aria-label="規則來源">
    {sourceLinks?.length ? sourceLinks.map((source, index) => {
      const safeUrl = parseSafeExternalUrl(source.url);
      const value = sourceLabel && source.label && sourceLabel !== source.label
        ? `${sourceLabel}・${source.label}`
        : sourceLabel || source.label || safeUrl?.hostname || '查看依據';
      return <ExternalLinkGuard key={source.url} url={source.url} className="rule-source-entry">
        <SourceContent value={value} external={Boolean(safeUrl)} ordinal={sourceLinks.length > 1 ? index + 1 : undefined} />
      </ExternalLinkGuard>;
    }) : <span className={sourceLabel ? 'rule-source-entry' : 'rule-source-entry unverified'}>
      <SourceContent value={sourceLabel || '未附來源'} />
    </span>}
  </div>
);
