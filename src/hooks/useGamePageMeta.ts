import { useEffect } from 'react';
import type { GameDetail } from '../shared/types';
import { canonicalGameUrl, gameDescription, shouldIndexGame, SITE_TITLE } from '../lib/gameSeo';

const headElement = <T extends HTMLElement>(selector: string, create: () => T) => {
  const existing = document.head.querySelector<T>(selector);
  if (existing) return { element: existing, created: false };
  const element = create();
  document.head.append(element);
  return { element, created: true };
};

const createMeta = (name: string) => () => Object.assign(document.createElement('meta'), { name });

// Per-game title, description and canonical URL; rule-less and missing games get noindex. Restored on leave.
export const useGamePageMeta = (game: GameDetail | undefined, notFound: boolean) => {
  const indexable = game ? shouldIndexGame(game) : !notFound;
  const description = game && indexable ? gameDescription(game) : undefined;
  const canonical = game && indexable ? canonicalGameUrl(window.location.origin, game) : undefined;
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    if (game) {
      document.title = `${game.displayName}｜${SITE_TITLE}`;
      cleanups.push(() => { document.title = SITE_TITLE; });
    }
    if (description) {
      const meta = headElement<HTMLMetaElement>('meta[name="description"]', createMeta('description'));
      const previous = meta.element.content;
      meta.element.content = description;
      cleanups.push(() => { if (meta.created) meta.element.remove(); else meta.element.content = previous; });
    }
    if (canonical) {
      const link = headElement<HTMLLinkElement>('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }));
      link.element.href = canonical;
      cleanups.push(() => link.element.remove());
    }
    if (!indexable) {
      const robots = headElement<HTMLMetaElement>('meta[name="robots"]', createMeta('robots'));
      robots.element.content = 'noindex';
      cleanups.push(() => robots.element.remove());
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [game?.displayName, description, canonical, indexable]);
};
