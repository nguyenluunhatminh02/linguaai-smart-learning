import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActivityDuration } from './use-activity-duration';

describe('useActivityDuration', () => {
  afterEach(() => vi.useRealTimers());

  it('counts whole seconds for the selected activity', () => {
    vi.useFakeTimers();
    const { result } = renderHook(({ id }) => useActivityDuration(id), {
      initialProps: { id: 'lesson-1' },
    });
    expect(result.current()).toBe(0);
    vi.advanceTimersByTime(65_000);
    expect(result.current()).toBe(65);
  });

  it('returns zero while no activity is selected', () => {
    const { result } = renderHook(() => useActivityDuration());
    expect(result.current()).toBe(0);
  });
});
