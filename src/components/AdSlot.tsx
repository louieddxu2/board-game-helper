interface AdSlotProps {
  placement: 'home-after-game-exploration' | 'personal-home-after-favorites' | 'game-rule-list';
}

export const AdSlot = ({ placement }: AdSlotProps) => <aside
  className={`ad-slot ad-slot-${placement}`}
  aria-label="廣告預留位置"
  data-ad-placement={placement}
>
  <small>預留廣告的位置</small>
</aside>;
