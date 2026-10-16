import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { WorkspaceIcon } from './workspaceShared';

export type WorkspaceChoiceOption<T extends string> = { value: T; label: string };

const choiceBounds = () => {
  const viewport = window.visualViewport;
  return viewport ? { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
};

export const WorkspaceChoice = <T extends string>({ ariaLabel, value, options, onChange, disabled = false, className = '' }: {
  ariaLabel: string; value: T; options: readonly WorkspaceChoiceOption<T>[]; onChange(value: T): void; disabled?: boolean; className?: string;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex(option => option.value === value)));
  const [position, setPosition] = useState<CSSProperties>();
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  const close = () => setOpen(false);
  const select = (next: T) => {
    onChange(next);
    close();
    trigger.current?.focus({ preventScroll: true });
  };
  const reposition = () => {
    const element = trigger.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const bounds = choiceBounds();
    const margin = 8;
    const gap = 4;
    const width = Math.min(Math.max(rect.width, 144), Math.max(144, bounds.width - margin * 2));
    const menuHeight = Math.min(options.length * 40 + 8, Math.max(96, bounds.height - margin * 2));
    const below = bounds.top + bounds.height - rect.bottom;
    const above = rect.top - bounds.top;
    const placeBelow = below >= Math.min(menuHeight, 160) || below >= above;
    setPosition({
      position: 'fixed',
      left: Math.max(bounds.left + margin, Math.min(rect.left, bounds.left + bounds.width - width - margin)),
      top: placeBelow ? Math.min(rect.bottom + gap, bounds.top + bounds.height - margin - Math.min(menuHeight, below - gap)) : Math.max(bounds.top + margin, rect.top - gap - Math.min(menuHeight, above - gap)),
      width,
      maxHeight: Math.max(40, placeBelow ? below - gap - margin : above - gap - margin),
    });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const updatePosition = (event?: Event) => {
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return;
      reposition();
    };
    const viewport = window.visualViewport;
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const listbox = menu.current;
    const option = listbox?.children.item(activeIndex) as HTMLElement | null;
    if (!listbox || !option) return;
    if (option.offsetTop < listbox.scrollTop) listbox.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = option.offsetTop + option.offsetHeight - listbox.clientHeight;
  }, [activeIndex, open]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  const openAt = (index = selectedIndex) => {
    if (disabled) return;
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    reposition();
    setOpen(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    const lastIndex = Math.max(0, options.length - 1);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(open ? Math.min(lastIndex, activeIndex + 1) : selectedIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(open ? Math.max(0, activeIndex - 1) : selectedIndex);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      openAt(event.key === 'Home' ? 0 : lastIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) select(options[activeIndex]?.value ?? value);
      else openAt();
    }
  };

  return <div ref={root} className={`workspace-choice ${className}`.trim()}>
    <button ref={trigger} type="button" role="combobox" aria-label={ariaLabel} aria-valuetext={selected?.label} aria-expanded={open} aria-controls={open ? listboxId : undefined} aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined} aria-haspopup="listbox" disabled={disabled} onClick={() => open ? close() : openAt()} onKeyDown={onKeyDown}>
      <span>{selected?.label}</span><span className="workspace-choice-chevron" aria-hidden="true"><WorkspaceIcon name="chevron" size={17} /></span>
    </button>
    {open && <div ref={menu} id={listboxId} className="workspace-choice-menu" role="listbox" aria-label={ariaLabel} style={position}>
      {options.map((option, index) => <button id={`${listboxId}-${index}`} key={option.value} type="button" tabIndex={-1} role="option" aria-selected={option.value === value} className={index === activeIndex ? 'is-active' : ''} onPointerMove={event => { if (event.pointerType === 'mouse') setActiveIndex(index); }} onClick={() => select(option.value)}>{option.label}</button>)}
    </div>}
  </div>;
};
