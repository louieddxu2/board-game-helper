import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { PlayerCountInput } from './PlayerCountInput';

const Harness = () => {
  const [counts, setCounts] = useState<number[]>([]);
  return <PlayerCountInput value={counts} onChange={setCounts} />;
};

describe('PlayerCountInput', () => {
  test('toggles discrete player counts with keyboard-compatible clicks', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '2 人' }), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '4 人' }), { detail: 0 });
    expect(screen.getByText('2人、4人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 人' }), { detail: 0 });
    expect(screen.getByText('4人')).toBeInTheDocument();
  });
});
