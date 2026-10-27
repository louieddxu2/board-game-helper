export const SITE_TITLE = '玩錯的桌遊規則';

export interface PublicGamePreview {
  slug: string;
  displayName: string;
  englishName?: string | null;
  statement?: string | null;
}

export const gamePreview = (game: PublicGamePreview, origin: string) => {
  const summary = [game.englishName && game.englishName !== game.displayName ? game.englishName : '',
    game.statement || '開桌前快速複習容易玩錯的規則。'].filter(Boolean).join(' · ').replace(/\s+/gu, ' ').trim();
  const characters = Array.from(summary);
  return {
    title: `${game.displayName}｜${SITE_TITLE}`,
    description: characters.length > 160 ? `${characters.slice(0, 159).join('')}…` : summary,
    url: new URL(`/games/${encodeURIComponent(game.slug)}`, origin).href,
    image: new URL('/social-preview.png', origin).href,
  };
};
