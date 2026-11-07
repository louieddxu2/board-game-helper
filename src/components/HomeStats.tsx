import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export interface SiteStats { games: number; rules: number }

// Counted from the same game list the search uses, so the numbers need no query of their own.
export const siteStats = (games: Array<{ ruleCount: number; publishedRuleCount?: number }>): SiteStats => {
  const counts = games.map((game) => game.publishedRuleCount ?? game.ruleCount).filter((count) => count > 0);
  return { games: counts.length, rules: counts.reduce((sum, count) => sum + count, 0) };
};

/** The home page's totals, read only once the footer nears the screen so the page itself loads first. */
export function HomeStats() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [stats, setStats] = useState<SiteStats>();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    const load = () => {
      void api.catalogGames(false, (updated) => { if (active) setStats(siteStats(updated.games)); })
        .then((data) => { if (active) setStats(siteStats(data.games)); })
        .catch(() => undefined);
    };
    if (typeof IntersectionObserver === 'undefined') { load(); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, []);
  // Nothing is shown until real numbers arrive; a failed read leaves the line empty rather than guessing.
  return <p ref={ref} className="home-stats" aria-live="polite">
    {stats && stats.games > 0 && <>已收錄 <b>{stats.games}</b> 款遊戲・<b>{stats.rules}</b> 條玩錯的規則</>}
  </p>;
}
