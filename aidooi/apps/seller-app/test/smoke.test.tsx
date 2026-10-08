import { MoreScreen } from '../src/screens/MoreScreen.tsx';
import { renderApp, screen, waitFor } from './support.tsx';

it('boots the providers and renders a screen signed in', async () => {
  await renderApp(<MoreScreen />);
  await waitFor(() => expect(screen.getByText(/owner@showroom.test/)).toBeTruthy());
});
