import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Checkbox,
  Field,
  FormErrorSummary,
  IconButton,
  Input,
  Radio,
  Select,
  Switch,
  Textarea,
} from '../src/index.ts';
import { LOCALES, renderIn } from './helpers.tsx';

describe.each(LOCALES)('forms (%s)', (locale) => {
  it('Button: click, keyboard activation, loading blocks clicks and announces busy', async () => {
    const onClick = vi.fn();
    const { user, rerender } = renderIn(<Button onClick={onClick}>Save</Button>, locale);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const busy = screen.getByRole('button', { name: /Save/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('IconButton always has an accessible name', () => {
    renderIn(<IconButton label="Edit offer" icon="✎" />, locale);
    expect(screen.getByRole('button', { name: 'Edit offer' })).toBeInTheDocument();
  });

  it('Field wires label, hint and error to the control, and announces the error', async () => {
    const { rerender } = renderIn(
      <Field label="Email" hint="We never share it." required>
        <Input />
      </Field>,
      locale,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('We never share it.');

    rerender(
      <Field label="Email" hint="We never share it." error="Enter a valid email." required>
        <Input />
      </Field>,
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('We never share it. Enter a valid email.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email.');
  });

  it('Field works for every control type and the label focuses the control', async () => {
    const { user } = renderIn(
      <>
        <Field label="Area">
          <Textarea />
        </Field>
        <Field label="City">
          <Select>
            <option>Dubai</option>
          </Select>
        </Field>
      </>,
      locale,
    );
    await user.click(screen.getByText('Area'));
    expect(screen.getByLabelText('Area')).toHaveFocus();
    expect(screen.getByLabelText('City')).toHaveValue('Dubai');
  });

  it('Checkbox, Radio and Switch are operable by keyboard with the right roles', async () => {
    const { user } = renderIn(
      <>
        <Checkbox label="On display" />
        <Radio name="r" label="Standard" />
        <Radio name="r" label="Express" />
        <Switch label="Accepting orders" />
      </>,
      locale,
    );
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'On display' })).toBeChecked();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Express' }));
    expect(screen.getByRole('radio', { name: 'Standard' })).not.toBeChecked();
    const sw = screen.getByRole('switch', { name: 'Accepting orders' });
    await user.click(sw);
    expect(sw).toBeChecked();
  });

  it('FormErrorSummary takes focus, lists errors, and each link focuses its field', async () => {
    const { user } = renderIn(
      <>
        <FormErrorSummary errors={[{ path: 'email', message: 'Enter a valid email.' }]} />
        <Field label="Email" id="email">
          <Input />
        </Field>
      </>,
      locale,
    );
    expect(screen.getAllByRole('alert')[0]).toHaveFocus();
    await user.click(screen.getByRole('link', { name: 'Enter a valid email.' }));
    expect(document.getElementById('email')).toHaveFocus();
  });

  it('FormErrorSummary renders nothing when there are no errors', () => {
    const { container } = renderIn(<FormErrorSummary errors={[]} />, locale);
    expect(container).toBeEmptyDOMElement();
  });
});
