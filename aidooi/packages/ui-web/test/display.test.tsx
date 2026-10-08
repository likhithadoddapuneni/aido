import { ApiProblem, NetworkError } from '@aidooi/api-client';
import { errorMessage } from '@aidooi/i18n';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  DateTime,
  EmptyState,
  ErrorState,
  KeyValueList,
  Money,
  StatusPill,
  Stepper,
  Tabs,
  Timeline,
} from '../src/index.ts';
import { LOCALES, renderIn } from './helpers.tsx';

describe.each(LOCALES)('display (%s)', (locale) => {
  it('Money shows integer fils as dirhams and keeps the raw value for tests and tools', () => {
    renderIn(<Money fils={349_050} />, locale);
    const el = document.querySelector('.ui-money') as HTMLElement;
    expect(el).toHaveAttribute('data-fils', '349050');
    expect(el.textContent).toMatch(/3,490\.50/);
  });

  it('DateTime defaults to Asia/Dubai and renders a machine-readable time', () => {
    renderIn(<DateTime value="2026-10-07T22:30:00Z" style="date" />, locale);
    const t = document.querySelector('time') as HTMLTimeElement;
    expect(t).toHaveAttribute('datetime', '2026-10-07T22:30:00.000Z');
    // 22:30 UTC is already the 8th in Dubai (UTC+4).
    expect(t.textContent).toMatch(locale === 'en' ? /8 Oct 2026/ : /٨|8/);
  });

  it('DateTime tolerates an invalid value without throwing', () => {
    renderIn(<DateTime value="not a date" />, locale);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('StatusPill states the status in words and maps unknowns to neutral', () => {
    renderIn(
      <>
        <StatusPill status="Delivered" map={{ Delivered: 'ok' }} />
        <StatusPill status="Mystery" map={{}} />
        <Badge tone="err">Rejected</Badge>
      </>,
      locale,
    );
    expect(screen.getByText('Delivered').closest('span')).toHaveClass('ui-badge--ok');
    expect(screen.getByText('Mystery').closest('span')).toHaveClass('ui-badge--neutral');
  });

  it('EmptyState and ErrorState: plain words in the user’s language, never a raw code', async () => {
    const onRetry = vi.fn();
    const { user } = renderIn(
      <ErrorState
        error={
          new ApiProblem({ status: 409, code: 'price_approval_required', correlationId: 'corr-77' })
        }
        onRetry={onRetry}
      />,
      locale,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      errorMessage('price_approval_required', locale),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('corr-77');
    expect(screen.queryByText('price_approval_required')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull(); // a 409 is not fixed by retrying
    expect(onRetry).not.toHaveBeenCalled();
    void user;
  });

  it('ErrorState offers retry for outages and offline, and falls back for unknown failures', async () => {
    const onRetry = vi.fn();
    const { user, rerender } = renderIn(
      <ErrorState
        error={new ApiProblem({ status: 503, code: 'payment_provider_unavailable' })}
        onRetry={onRetry}
      />,
      locale,
    );
    await user.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorState error={new NetworkError(new Error('x'))} onRetry={onRetry} />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<ErrorState error={new Error('boom: secret stack')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(errorMessage('internal_error', locale));
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret');
  });

  it('EmptyState is a heading plus guidance', () => {
    renderIn(<EmptyState title="No offers" description="Add one to start selling." />, locale);
    expect(screen.getByRole('heading', { name: 'No offers' })).toBeInTheDocument();
  });

  it('Tabs: one tab stop, arrows move, and in RTL they are mirrored', async () => {
    const { user } = renderIn(
      <Tabs
        label="Sections"
        tabs={[
          { id: 'a', label: 'A', panel: <p>panel a</p> },
          { id: 'b', label: 'B', panel: <p>panel b</p> },
          { id: 'c', label: 'C', panel: <p>panel c</p> },
        ]}
      />,
      locale,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    const forward = locale === 'ar' ? '{ArrowLeft}' : '{ArrowRight}';
    await user.keyboard(forward);
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel b');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'C' })).toHaveFocus();
    await user.keyboard(forward); // wraps
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '-1');
  });

  it('KeyValueList, Timeline and Stepper expose semantic structure', () => {
    renderIn(
      <>
        <KeyValueList items={[{ key: 'k', label: 'Gross', value: '1,000' }]} />
        <Timeline label="History" entries={[{ id: '1', title: 'Delivered', at: '9:30' }]} />
        <Stepper steps={['One', 'Two', 'Three']} current={1} />
      </>,
      locale,
    );
    expect(screen.getByText('Gross').tagName).toBe('DT');
    expect(screen.getByRole('list', { name: 'History' })).toBeInTheDocument();
    const current = document.querySelector('[aria-current="step"]') as HTMLElement;
    expect(current).toHaveTextContent('Two');
  });
});
