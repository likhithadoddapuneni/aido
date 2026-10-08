import { AUTH_KEY, createStaffStore, memoryKeyValue } from '../src/session/store.ts';

const staff = { id: 'u', role: 'seller_staff', partnerId: 'p', email: 'a@b.test' };
const sess = (n: number) => ({
  kind: 'user' as const,
  accessToken: `A${n}`,
  refreshToken: `R${n}`,
});

describe('staff session store', () => {
  it('starts a login atomically and reads it back', async () => {
    const s = createStaffStore(memoryKeyValue());
    await s.startLogin(sess(1), staff);
    expect(await s.read()).toEqual(sess(1));
    expect(await s.readStaff()).toEqual(staff);
  });
  it('a refresh merges into the login and keeps the profile', async () => {
    const s = createStaffStore(memoryKeyValue());
    await s.startLogin(sess(1), staff);
    await s.write(sess(2));
    expect(await s.read()).toEqual(sess(2));
    expect(await s.readStaff()).toEqual(staff);
  });
  it('a late refresh cannot resurrect a signed-out login', async () => {
    const s = createStaffStore(memoryKeyValue());
    await s.startLogin(sess(1), staff);
    await s.write(null);
    await s.write(sess(2));
    expect(await s.read()).toBeNull();
    expect(await s.readStaff()).toBeNull();
  });
  it('serialises concurrent writes: the last issued wins', async () => {
    const s = createStaffStore(memoryKeyValue());
    await s.startLogin(sess(1), staff);
    await Promise.all([s.write(sess(2)), s.write(sess(3)), s.write(sess(4))]);
    expect(await s.read()).toEqual(sess(4));
  });
  it('treats corrupt storage as no login and clears it', async () => {
    const kv = memoryKeyValue();
    await kv.setItemAsync(AUTH_KEY, '{nope');
    const s = createStaffStore(kv);
    expect(await s.read()).toBeNull();
    expect(await kv.getItemAsync(AUTH_KEY)).toBeNull();
  });
  it('treats a half-written item (no profile) as no login', async () => {
    const kv = memoryKeyValue();
    await kv.setItemAsync(AUTH_KEY, JSON.stringify({ session: sess(1) }));
    expect(await createStaffStore(kv).read()).toBeNull();
  });
});
