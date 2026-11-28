import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStreamThrottle } from './use-stream-throttle';

describe('useStreamThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces deltas within an interval into a single render', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('Hello');
      result.current.push(' ');
      result.current.push('world');
    });

    expect(result.current.value).toBe('');
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('Hello world');
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('Hello world');
  });

  it('emits at most one batched update per interval', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 50, onFlush })
    );

    act(() => {
      result.current.push('a');
      vi.advanceTimersByTime(25);
      result.current.push('b');
      vi.advanceTimersByTime(25);
    });

    expect(result.current.value).toBe('ab');
    expect(onFlush).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.push('c');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('abc');
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('produces exact concatenated text after multiple flush windows', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    const deltas = ['The ', 'quick ', 'brown ', 'fox ', 'jumps '];

    act(() => {
      deltas.forEach((d) => result.current.push(d));
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe(deltas.join(''));

    act(() => {
      result.current.push('over ');
      result.current.push('the ');
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe(deltas.join('') + 'over the ');
  });

  it('push returns full accumulated text synchronously', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    let returned = '';
    act(() => {
      returned = result.current.push('Hello') as unknown as string;
    });
    expect(returned).toBe('Hello');

    act(() => {
      returned = result.current.push(' world') as unknown as string;
    });
    expect(returned).toBe('Hello world');

    expect(result.current.value).toBe('');
  });

  it('flushes a short tail synchronously before terminal event', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    act(() => {
      result.current.push('Hello');
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('Hello');

    act(() => {
      result.current.push(' world');
    });

    expect(result.current.value).toBe('Hello');

    let flushed = '';
    act(() => {
      flushed = result.current.flush();
    });

    expect(flushed).toBe('Hello world');
    expect(result.current.value).toBe('Hello world');
  });

  it('flush is idempotent — second flush emits nothing', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('test');
    });

    let first = '';
    act(() => {
      first = result.current.flush();
    });
    expect(first).toBe('test');
    expect(onFlush).toHaveBeenCalledTimes(1);

    let second = '';
    act(() => {
      second = result.current.flush();
    });
    expect(second).toBe('test');
    expect(onFlush).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('flush returns exact text even when called before timer fires', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    act(() => {
      result.current.push('partial');
    });

    let flushed = '';
    act(() => {
      flushed = result.current.flush();
    });

    expect(flushed).toBe('partial');
    expect(result.current.value).toBe('partial');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('partial');
  });

  it('cancels scheduled timer when flush is called', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('data');
    });

    act(() => {
      result.current.flush();
    });

    expect(onFlush).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('preserves delta order with Unicode and multi-byte characters', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 50 }));

    const deltas = ['你好', '世界', '🌍', '🎉', 'αβγ'];

    act(() => {
      deltas.forEach((d) => result.current.push(d));
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe(deltas.join(''));
  });

  it('ignores empty deltas without scheduling timer', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      expect(result.current.push('')).toBe('');
      expect(result.current.push('')).toBe('');
    });

    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      result.current.push('real');
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('real');
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('reset discards buffered text and cancels timers', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('old');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.value).toBe('');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onFlush).not.toHaveBeenCalled();
    expect(result.current.value).toBe('');
  });

  it('reset clears state for a new turn', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 50 }));

    act(() => {
      result.current.push('first');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('first');

    act(() => {
      result.current.reset();
    });

    expect(result.current.value).toBe('');

    act(() => {
      result.current.push('second');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('second');
  });

  it('does not update state after unmount', () => {
    const { result, unmount } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100 })
    );

    act(() => {
      result.current.push('data');
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('');
  });

  it('flush after unmount returns accumulated text without state update', () => {
    const onFlush = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('tail');
    });

    unmount();

    let flushed = '';
    act(() => {
      flushed = result.current.flush();
    });

    expect(flushed).toBe('tail');
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('handles rapid push-flush-push cycles correctly', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    act(() => {
      result.current.push('a');
      result.current.flush();
    });

    expect(result.current.value).toBe('a');

    act(() => {
      result.current.push('b');
      vi.advanceTimersByTime(50);
      result.current.push('c');
      result.current.flush();
    });

    expect(result.current.value).toBe('abc');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('abc');
  });

  it('flush returns empty string when nothing is buffered', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    let flushed = 'unset';
    act(() => {
      flushed = result.current.flush();
    });

    expect(flushed).toBe('');
    expect(result.current.value).toBe('');
  });

  it('maintains correct value after multiple timer cycles', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 50 }));

    act(() => {
      result.current.push('1');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('1');

    act(() => {
      result.current.push('2');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('12');

    act(() => {
      result.current.push('3');
      vi.advanceTimersByTime(50);
    });

    expect(result.current.value).toBe('123');
  });

  it('flush before terminal event preserves exact full text', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('Hello');
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('Hello');
    expect(onFlush).toHaveBeenCalledWith('Hello');

    act(() => {
      result.current.push(' world');
    });

    let finalText = '';
    act(() => {
      finalText = result.current.flush();
    });

    expect(finalText).toBe('Hello world');
    expect(result.current.value).toBe('Hello world');
    expect(onFlush).toHaveBeenCalledWith('Hello world');
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('handles concurrent push calls without race conditions', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    act(() => {
      for (let i = 0; i < 100; i++) {
        result.current.push(String(i));
      }
      vi.advanceTimersByTime(100);
    });

    const expected = Array.from({ length: 100 }, (_, i) => i).join('');
    expect(result.current.value).toBe(expected);
  });

  it('reset during pending flush prevents state update', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('data');
    });

    act(() => {
      result.current.reset();
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('');
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('flush after reset returns empty string', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    act(() => {
      result.current.push('data');
    });

    act(() => {
      result.current.reset();
    });

    let flushed = 'unset';
    act(() => {
      flushed = result.current.flush();
    });

    expect(flushed).toBe('');
    expect(result.current.value).toBe('');
  });

  it('default interval is 50ms when not specified', () => {
    const { result } = renderHook(() => useStreamThrottle());

    act(() => {
      result.current.push('test');
    });

    act(() => {
      vi.advanceTimersByTime(49);
    });

    expect(result.current.value).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.value).toBe('test');
  });

  it('handles very long text concatenation correctly', () => {
    const { result } = renderHook(() => useStreamThrottle({ intervalMs: 100 }));

    const longText = 'a'.repeat(10000);

    act(() => {
      result.current.push(longText);
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe(longText);
    expect(result.current.value.length).toBe(10000);
  });

  it('push after flush starts new batch cycle', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useStreamThrottle({ intervalMs: 100, onFlush })
    );

    act(() => {
      result.current.push('a');
      result.current.flush();
    });

    expect(onFlush).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.push('b');
      vi.advanceTimersByTime(100);
    });

    expect(result.current.value).toBe('ab');
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
