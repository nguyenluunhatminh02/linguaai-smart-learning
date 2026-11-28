import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/stores/language-store', () => {
  const t = {
    common: {
      loadingShort: 'Loading...',
      loadingDesc: 'Preparing your learning experience',
      retry: 'Try again',
      emptyTitle: 'Nothing here yet',
      errorTitle: 'Something went wrong',
      errorDescription: "We couldn't load this right now. Please try again.",
      offlineTitle: "You're offline",
      offlineDescription: "You're offline. Check your connection and try again.",
    },
  };
  return {
    useLanguageStore: () => ({ locale: 'en', t }),
  };
});

import {
  LoadingState,
  EmptyState,
  ErrorState,
  OfflineState,
  AsyncState,
  useOnlineStatus,
  isOfflineError,
} from './async-state';

function renderHookLike(component: React.ReactElement) {
  return render(component);
}

describe('LoadingState', () => {
  it('announces loading via role="status" and aria-busy', () => {
    render(<LoadingState />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('uses translated label when no label prop is provided', () => {
    render(<LoadingState />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.getByText('Preparing your learning experience')).toBeInTheDocument();
  });

  it('prefers explicit label and description props over translations', () => {
    render(<LoadingState label="Fetching deck" description="Syncing cards" />);
    expect(screen.getByText('Fetching deck')).toBeInTheDocument();
    expect(screen.getByText('Syncing cards')).toBeInTheDocument();
  });

  it('hides skeleton rows when skeletonLines is 0', () => {
    const { container } = render(<LoadingState skeletonLines={0} />);
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0);
  });

  it('renders skeleton rows with aria-hidden decoration', () => {
    const { container } = render(<LoadingState skeletonLines={4} />);
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(4);
  });

  it('hides the spinner when showSpinner is false', () => {
    const { container } = render(<LoadingState showSpinner={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('EmptyState', () => {
  it('renders title and optional description', () => {
    render(<EmptyState title="No decks yet" description="Create your first deck." />);
    expect(screen.getByText('No decks yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first deck.')).toBeInTheDocument();
  });

  it('falls back to translated emptyTitle when title is omitted', () => {
    render(<EmptyState title={undefined as unknown as string} />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('renders an action button when provided and invokes onClick', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: 'Create', onClick }} />);
    const button = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses role="status" with aria-live polite', () => {
    render(<EmptyState title="Empty" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});

describe('ErrorState', () => {
  it('uses role="alert" and shows translated defaults', () => {
    render(<ErrorState />);
    const region = screen.getByRole('alert');
    expect(region).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it('prefers explicit title and description props', () => {
    render(<ErrorState title="Deck missing" description="ID not found" />);
    expect(screen.getByText('Deck missing')).toBeInTheDocument();
    expect(screen.getByText('ID not found')).toBeInTheDocument();
  });

  it('renders retry button only when onRetry is provided', () => {
    const { rerender } = render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
    const onRetry = vi.fn();
    rerender(<ErrorState onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('honours a custom retryLabel', () => {
    render(<ErrorState onRetry={() => {}} retryLabel="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('OfflineState', () => {
  it('announces via role="status" with translated defaults', () => {
    render(<OfflineState />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText(/Check your connection/i)).toBeInTheDocument();
  });

  it('renders retry button with custom label when provided', () => {
    const onRetry = vi.fn();
    render(<OfflineState onRetry={onRetry} retryLabel="Reconnect" />);
    const button = screen.getByRole('button', { name: 'Reconnect' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AsyncState dispatcher', () => {
  it('renders LoadingState when status is loading', () => {
    render(<AsyncState status="loading" label="Fetching" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Fetching')).toBeInTheDocument();
  });

  it('renders EmptyState when status is empty', () => {
    render(<AsyncState status="empty" title="No items" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('renders ErrorState when status is error', () => {
    render(<AsyncState status="error" title="Boom" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('renders OfflineState when status is offline', () => {
    render(<AsyncState status="offline" />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });

  it('renders children when status is success', () => {
    render(
      <AsyncState status="success">
        <div data-testid="content">Loaded</div>
      </AsyncState>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});

describe('useOnlineStatus', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  function OnlineProbe() {
    const online = useOnlineStatus();
    return <span data-testid="online">{online ? 'yes' : 'no'}</span>;
  }

  it('returns true when navigator.onLine is true', () => {
    renderHookLike(<OnlineProbe />);
    expect(screen.getByTestId('online').textContent).toBe('yes');
  });

  it('reacts to the offline event', () => {
    renderHookLike(<OnlineProbe />);
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    fireEvent(window, new Event('offline'));
    expect(screen.getByTestId('online').textContent).toBe('no');
  });

  it('reacts to the online event', () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    renderHookLike(<OnlineProbe />);
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    fireEvent(window, new Event('online'));
    expect(screen.getByTestId('online').textContent).toBe('yes');
  });
});

describe('isOfflineError', () => {
  it('returns false for null/undefined/primitives', () => {
    expect(isOfflineError(null)).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
    expect(isOfflineError('oops')).toBe(false);
    expect(isOfflineError(42)).toBe(false);
  });

  it('returns true for axios ERR_NETWORK code', () => {
    expect(isOfflineError({ code: 'ERR_NETWORK' })).toBe(true);
  });

  it('returns true for fetch TypeError "Failed to fetch"', () => {
    const err = new TypeError('Failed to fetch');
    expect(isOfflineError(err)).toBe(true);
  });

  it('returns true for generic network error messages', () => {
    expect(isOfflineError({ message: 'Network Error' })).toBe(true);
    expect(isOfflineError({ message: 'socket hang up' })).toBe(true);
    expect(isOfflineError({ message: 'getaddrinfo ENOTFOUND api.example.com' })).toBe(true);
  });

  it('returns false when a numeric HTTP status is present', () => {
    expect(isOfflineError({ message: 'Network Error', status: 500 })).toBe(false);
    expect(isOfflineError({ message: 'Network Error', response: { status: 503 } })).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isOfflineError({ message: 'invalid json' })).toBe(false);
    expect(isOfflineError(new Error('validation failed'))).toBe(false);
  });
});
