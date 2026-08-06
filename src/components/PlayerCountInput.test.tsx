import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PlayerCountInput } from './PlayerCountInput';

const Harness = () => {
  const [counts, setCounts] = useState<number[]>([]);
  return <PlayerCountInput value={counts} onChange={setCounts} />;
};

const setPointerCoordinates = (event: Event, pointerId: number, clientX: number, clientY: number) => {
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
  });
  return event;
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlayerCountInput', () => {
  test('toggles discrete player counts with keyboard-compatible clicks', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '2 人' }), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '4 人' }), { detail: 0 });
    expect(screen.getByText('2人、4人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 人' }), { detail: 0 });
    expect(screen.getByText('4人')).toBeInTheDocument();
  });

  test('keeps a touch tap as a single toggle', () => {
    const view = render(<Harness />);
    const button = screen.getByRole('button', { name: /^2/ });
    const pointerDown = setPointerCoordinates(createEvent.pointerDown(button, { bubbles: true }), 3, 40, 100);
    fireEvent(button, pointerDown);
    fireEvent(button, setPointerCoordinates(createEvent.pointerUp(button, { bubbles: true }), 3, 40, 100));
    fireEvent.click(button, { detail: 1 });

    expect(button).toHaveClass('selected');
  });

  test('does not claim a vertical drag as a player-count gesture', () => {
    const view = render(<Harness />);
    const button = screen.getByRole('button', { name: /^2/ });
    const track = view.container.querySelector('.player-count-track');
    expect(track).not.toBeNull();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => button),
    });

    const pointerDown = setPointerCoordinates(createEvent.pointerDown(button, { bubbles: true }), 1, 40, 100);
    fireEvent(button, pointerDown);
    fireEvent(track!, setPointerCoordinates(createEvent.pointerMove(track!, { bubbles: true }), 1, 42, 150));
    fireEvent(track!, setPointerCoordinates(createEvent.pointerUp(track!, { bubbles: true }), 1, 42, 150));

    expect(pointerDown.defaultPrevented).toBe(false);
    expect(button).not.toHaveClass('selected');
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
  });

  test('starts painting only after a horizontal drag intent is clear', () => {
    const view = render(<Harness />);
    const button2 = screen.getByRole('button', { name: /^2/ });
    const button3 = screen.getByRole('button', { name: /^3/ });
    const track = view.container.querySelector('.player-count-track');
    expect(track).not.toBeNull();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn((clientX: number) => clientX < 80 ? button2 : button3),
    });

    const pointerDown = setPointerCoordinates(createEvent.pointerDown(button2, { bubbles: true }), 2, 40, 100);
    fireEvent(button2, pointerDown);
    const pointerMove = setPointerCoordinates(createEvent.pointerMove(track!, { bubbles: true }), 2, 100, 103);
    fireEvent(track!, pointerMove);

    expect(pointerDown.defaultPrevented).toBe(false);
    expect(pointerMove.defaultPrevented).toBe(true);
    expect(button2).toHaveClass('selected');
    expect(button3).toHaveClass('selected');
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(2);
  });

  test('does not swallow a keyboard click after a cancelled pointer gesture', () => {
    const view = render(<Harness />);
    const button = screen.getByRole('button', { name: /^2/ });
    const track = view.container.querySelector('.player-count-track');
    expect(track).not.toBeNull();

    fireEvent(button, setPointerCoordinates(createEvent.pointerDown(button, { bubbles: true }), 4, 40, 100));
    fireEvent(track!, setPointerCoordinates(createEvent.pointerMove(track!, { bubbles: true }), 4, 42, 150));
    fireEvent.click(button, { detail: 0 });

    expect(button).toHaveClass('selected');
  });
});
