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

// Per-game title, description, canonical URL and robots hint; everything is restored on leave.
export const useGamePageMeta = (game: GameDetail | undefined) => {
  const description = game ? gameDescription(game) : undefined;
  const canonical = game ? canonicalGameUrl(window.location.origin, game) : undefined;
  const indexable = game ? shouldIndexGame(game) : true;
  useEffect(() => {
    if (!game || !description || !canonical) return;
    document.title = `${game.displayName}｜${SITE_TITLE}`;
    const meta = headElement<HTMLMetaElement>('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }));
    const previousDescription = meta.element.content;
    meta.element.content = description;
    const link = headElement<HTMLLinkElement>('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }));
    link.element.href = canonical;
    const robots = indexable ? undefined : headElement<HTMLMetaElement>('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }));
    if (robots) robots.element.content = 'noindex';
    return () => {
      document.title = SITE_TITLE;
      if (meta.created) meta.element.remove(); else meta.element.content = previousDescription;
      link.element.remove();
      robots?.element.remove();
    };
  }, [game?.displayName, description, canonical, indexable]);
};
