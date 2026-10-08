import { act, screen, within } from '@testing-library/react';
import { errorMessage } from '@aidooi/i18n';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, Dialog, Drawer, Tooltip, useToast } from '../src/index.ts';
import { LOCALES, expectNoViolations, renderIn } from './helpers.tsx';

function Trigger({ children }: { children?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Details"
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <input aria-label="inside" />
        {children?.(() => setOpen(false))}
      </Dialog>
    </>
  );
}

describe.each(LOCALES)('overlays (%s)', (locale) => {
  it('Dialog: modal semantics, focus moves in, Tab wraps, Escape closes, focus returns to the trigger', async () => {
    const { user } = renderIn(<Trigger />, locale);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab forward through close → input → Done, and it wraps instead of escaping to the page.
    const stops = [...dialog.querySelectorAll<HTMLElement>('button, input')];
    for (let i = 0; i < stops.length * 2 + 1; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Dialog closes from the close button and from a click on the backdrop, and locks page scroll while open', async () => {
    const { user } = renderIn(<Trigger />, locale);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: locale === 'ar' ? 'إغلاق' : 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const backdrop = document.querySelector('.ui-overlay') as HTMLElement;
    await user.pointer({ target: backdrop, keys: '[MouseLeft]' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Drawer is the same modal, placed at the inline end', () => {
    renderIn(
      <Drawer open onClose={() => undefined} title="Filters">
        x
      </Drawer>,
      locale,
    );
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveClass('ui-sheet--end');
  });

  it('ConfirmDialog: an irreversible action needs the exact word typed; cancel never confirms', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { user } = renderIn(
      <ConfirmDialog
        open
        title="Deactivate?"
        description="Offers leave recommendations."
        confirmLabel="Deactivate"
        danger
        requireWord="DEACTIVATE"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
      locale,
    );
    const confirm = screen.getByRole('button', { name: 'Deactivate' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Offers leave recommendations.');
    await user.type(screen.getByRole('textbox'), 'deactivate'); // wrong case
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'DEACTIVATE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ConfirmDialog without a required word confirms immediately; a failing confirm keeps the dialog open', async () => {
    const onClose = vi.fn();
    const { user } = renderIn(
      <ConfirmDialog
        open
        title="Approve run?"
        description="Four eyes."
        confirmLabel="Approve"
        onConfirm={() => Promise.reject(new Error('nope'))}
        onClose={onClose}
      />,
      locale,
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      errorMessage('internal_error', locale),
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('ConfirmDialog hosts extra content, and `disabled` gates Confirm until that content is ready', async () => {
    function Harness() {
      const [reason, setReason] = useState('');
      return (
        <ConfirmDialog
          open
          title="Reset?"
          description="Ends sessions."
          confirmLabel="Reset"
          disabled={reason.trim().length < 3}
          onConfirm={() => undefined}
          onClose={() => undefined}
        >
          <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      );
    }
    const { user } = renderIn(<Harness />, locale);
    const confirm = screen.getByRole('button', { name: 'Reset' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'o');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'kay');
    expect(confirm).toBeEnabled();
  });

  it('REGRESSION: typing in a dialog form keeps focus even though the parent re-renders with a new onClose each keystroke', async () => {
    function Form() {
      const [text, setText] = useState('');
      return (
        <Dialog open onClose={() => setText('')} title="Form">
          <input aria-label="Name" value={text} onChange={(e) => setText(e.target.value)} />
        </Dialog>
      );
    }
    const { user } = renderIn(<Form />, locale);
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.type(input, 'abcdef');
    expect(input).toHaveValue('abcdef');
    expect(input).toHaveFocus();
  });

  it('Toast announces politely, errors assertively and stay until dismissed, others expire', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    function Demo() {
      const { push } = useToast();
      return (
        <>
          <Button onClick={() => push({ message: 'Saved.', tone: 'ok' })}>ok</Button>
          <Button onClick={() => push({ message: 'Failed.', tone: 'err' })}>err</Button>
        </>
      );
    }
    const { user } = renderIn(<Demo />, locale);
    await user.click(screen.getByRole('button', { name: 'ok' }));
    await user.click(screen.getByRole('button', { name: 'err' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed.');
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Saved.')).toBeNull();
    expect(screen.getByText('Failed.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(screen.queryByText('Failed.')).toBeNull();
    vi.useRealTimers();
  });

  it('Tooltip appears on keyboard focus, describes the control, and Escape dismisses it', async () => {
    const { user } = renderIn(
      <Tooltip label="Opens the audit trail">
        <Button>Audit</Button>
      </Tooltip>,
      locale,
    );
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).not.toBeVisible();
    await user.tab();
    expect(tip).toBeVisible();
    expect(screen.getByRole('button', { name: 'Audit' })).toHaveAccessibleDescription(
      'Opens the audit trail',
    );
    await user.keyboard('{Escape}');
    expect(tip).not.toBeVisible();
  });
});

describe('overlays inside an application shell', () => {
  it('add no landmarks of their own: a dialog opened over a page with a banner is not a second banner', async () => {
    const { user } = renderIn(
      <>
        <header>
          <p>Application</p>
        </header>
        <Trigger />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('banner')).toBeNull();
    expect(within(dialog).queryByRole('contentinfo')).toBeNull();
    await expectNoViolations(document.body);
  });
});
