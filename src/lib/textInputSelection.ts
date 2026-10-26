type TextInput = HTMLInputElement | HTMLTextAreaElement;

const editableTextInput = (target: EventTarget | null): TextInput | undefined => {
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly ? target : undefined;
  if (target instanceof HTMLInputElement && !target.disabled && !target.readOnly
    && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(target.type)) return target;
  return undefined;
};

/** Select on entry while preserving caret placement and native drag/long-press selection. */
export const startTextInputSelection = () => {
  let pointer: { id: number; input?: TextInput; x: number; y: number; moved: boolean } | undefined;
  const onPointerDown = (event: PointerEvent) => {
    const input = editableTextInput(event.target);
    pointer = { id: event.pointerId, input: input !== document.activeElement ? input : undefined,
      x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) pointer.moved = true;
  };
  const onPointerCancel = () => { pointer = undefined; };
  const onFocus = (event: FocusEvent) => { editableTextInput(event.target)?.select(); };
  const onClick = (event: MouseEvent) => {
    const gesture = pointer;
    pointer = undefined;
    // A native click places its caret after focusin. Reapply only for the first
    // click into a field, never for a second click, a drag, or a long press.
    if (event.detail > 0 && gesture?.input === event.target && !gesture.moved
      && document.activeElement === gesture.input) gesture.input.select();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointercancel', onPointerCancel, true);
  document.addEventListener('contextmenu', onPointerCancel, true);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    document.removeEventListener('contextmenu', onPointerCancel, true);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('click', onClick, true);
  };
};
