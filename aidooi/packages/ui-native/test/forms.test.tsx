import { fireEvent, screen } from '@testing-library/react-native';
import { Field, OtpField, PhoneField, normaliseUaeMobile, sanitiseOtp } from '../src/index.ts';
import { renderApp } from './helpers.tsx';

describe('Field', () => {
  it('the label is the accessible name; the hint is read with it', async () => {
    await renderApp(
      <Field label="Email" hint="We never share it" value="" onChangeText={() => undefined} />,
    );
    const input = screen.getByLabelText('Email');
    expect(input.props.accessibilityHint).toBe('We never share it');
    expect(screen.getByText('We never share it')).toBeTruthy();
  });

  it('an error replaces the hint, is announced as an alert in a live region, and is read with the field', async () => {
    await renderApp(
      <Field
        label="Email"
        hint="hint"
        error="Enter a valid email."
        value="x"
        onChangeText={() => undefined}
      />,
    );
    const err = screen.getByText('Enter a valid email.');
    expect(err.props.accessibilityRole).toBe('alert');
    expect(err.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.queryByText('hint')).toBeNull();
    expect(screen.getByLabelText('Email').props.accessibilityHint).toBe('Enter a valid email.');
  });

  it('forwards typing', async () => {
    const onChangeText = jest.fn();
    await renderApp(<Field label="Name" value="" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Aisha');
    expect(onChangeText).toHaveBeenCalledWith('Aisha');
  });
});

describe('UAE mobile normalisation', () => {
  it.each([
    ['050 123 4567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['00971501234567', '+971501234567'],
    ['501234567', '+971501234567'],
    ['٠٥٠ ١٢٣ ٤٥٦٧', '+971501234567'],
    ['(055) 987-6543', '+971559876543'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseUaeMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '123',
    '04 123 4567',
    '0501234',
    '05012345678',
    '+1 415 555 0100',
    '059 123 4567',
    'abc',
  ])('rejects %j', (input) => {
    expect(normaliseUaeMobile(input)).toBeNull();
  });
});

describe('PhoneField', () => {
  it('reports the raw text and its E.164 form (null until valid)', async () => {
    const onChange = jest.fn();
    await renderApp(<PhoneField value="" onChange={onChange} />);
    const input = screen.getByLabelText('Mobile number');
    await fireEvent.changeText(input, '050 123');
    await fireEvent.changeText(input, '050 123 4567');
    expect(onChange).toHaveBeenNthCalledWith(1, '050 123', null);
    expect(onChange).toHaveBeenNthCalledWith(2, '050 123 4567', '+971501234567');
  });

  it('asks the keyboard and OS for the right thing', async () => {
    await renderApp(<PhoneField value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('Mobile number');
    expect(input.props.keyboardType).toBe('phone-pad');
    expect(input.props.textContentType).toBe('telephoneNumber');
    expect(input.props.autoComplete).toBe('tel');
  });

  it('shows the invalid message only when asked, and in the user’s language', async () => {
    const { rerender } = await renderApp(<PhoneField value="123" onChange={() => undefined} />);
    expect(screen.queryByText('Enter a valid UAE mobile number.')).toBeNull();
    await renderApp(<PhoneField value="123" showError onChange={() => undefined} />);
    expect(screen.getByText('Enter a valid UAE mobile number.')).toBeTruthy();
    void rerender;
    await renderApp(<PhoneField value="123" showError onChange={() => undefined} />, {
      locale: 'ar',
    });
    expect(screen.getByText('أدخل رقم جوال إماراتيًا صحيحًا.')).toBeTruthy();
  });
});

describe('OTP sanitising', () => {
  it.each([
    ['123456', '123456'],
    ['Your code is 123 456', '123456'],
    ['١٢٣٤٥٦', '123456'],
    ['12-34-56-78', '123456'],
    ['12a', '12'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(sanitiseOtp(input, 6)).toBe(expected);
  });
});

describe('OtpField', () => {
  it('shows one box per digit and describes its progress as one sentence', async () => {
    await renderApp(<OtpField value="123" onChange={() => undefined} />);
    expect(screen.getAllByTestId(/otp-box-/)).toHaveLength(6);
    expect(screen.getByLabelText('Verification code. 3 of 6 digits entered')).toBeTruthy();
  });

  it('uses the OS one-time-code autofill hints and a numeric keypad', async () => {
    await renderApp(<OtpField value="" onChange={() => undefined} />);
    const input = screen.getByTestId('otp-input');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.autoComplete).toBe('sms-otp');
    expect(input.props.keyboardType).toBe('number-pad');
  });

  it('GATE: pasting a whole message, or autofill with Arabic digits, fills the code and completes exactly once', async () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    await renderApp(<OtpField value="" onChange={onChange} onComplete={onComplete} />);
    await fireEvent.changeText(
      screen.getByTestId('otp-input'),
      'Your code is 123 456, valid 5 min',
    );
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    await fireEvent.changeText(screen.getByTestId('otp-input'), '١٢٣٤٥٦');
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('does not re-complete when the full value is edited again', async () => {
    const onComplete = jest.fn();
    await renderApp(<OtpField value="123456" onChange={() => undefined} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('digits read left-to-right even in Arabic', async () => {
    await renderApp(<OtpField value="12" onChange={() => undefined} />, { locale: 'ar' });
    const container = screen.getByLabelText('رمز التحقق. تم إدخال 2 من 6 أرقام');
    expect((container.props.style as { direction?: string }).direction).toBe('ltr');
  });
});
