import {
  countdown,
  formatCountdown,
  remainingMs,
  sortByUrgency,
  urgencyOf,
  CRITICAL_MS,
  SOON_MS,
} from '../src/domain/sla.ts';
import { capabilitiesForClaim, capabilitiesOf } from '../src/domain/roles.ts';
import {
  ALREADY_AFTER_MS,
  interpretScan,
  interpretScanProblem,
  normalisePass,
} from '../src/domain/scan.ts';
import {
  aedToFils,
  buildPatch,
  filsToAedText,
  interpretEditFailure,
  type OfferLike,
} from '../src/domain/stock.ts';
import { allOnDisplay, findTask, fromPurchase, fromViewing, inbox } from '../src/domain/tasks.ts';
import { routeForNotification, taskIdFromUrl } from '../src/notifications/push.ts';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const ID = '0b9f7a52-6f1c-4d0c-9a52-0b9f7a526f1c';

describe('sla', () => {
  it('classifies urgency at the boundaries', () => {
    expect(urgencyOf(0)).toBe('overdue');
    expect(urgencyOf(-1)).toBe('overdue');
    expect(urgencyOf(1)).toBe('critical');
    expect(urgencyOf(CRITICAL_MS - 1)).toBe('critical');
    expect(urgencyOf(CRITICAL_MS)).toBe('soon');
    expect(urgencyOf(SOON_MS - 1)).toBe('soon');
    expect(urgencyOf(SOON_MS)).toBe('ok');
  });
  it('rounds the last second up and formats compactly', () => {
    expect(countdown(1)).toMatchObject({ overdue: false, seconds: 1 });
    expect(formatCountdown(countdown(3_900_000))).toBe('1h 05m');
    expect(formatCountdown(countdown(750_000))).toBe('12m 30s');
    expect(formatCountdown(countdown(45_000))).toBe('45s');
    expect(countdown(-5_000)).toMatchObject({ overdue: true, seconds: 5 });
  });
  it('computes remaining time from an ISO date', () => {
    expect(remainingMs(iso(60_000), NOW)).toBe(60_000);
  });
  it('sorts soonest first, answered last, ties by id', () => {
    const t = (id: string, due: number, answered = false) => ({ id, dueAt: iso(due), answered });
    const out = sortByUrgency(
      [t('c', 5000), t('a', 5000), t('late', -1000), t('done', -9000, true), t('far', 9e6)],
      NOW,
    );
    expect(out.map((x) => x.id)).toEqual(['late', 'a', 'c', 'far', 'done']);
  });
});

describe('roles', () => {
  it('staff cannot edit price; owners and managers can', () => {
    expect(capabilitiesOf('seller_staff').editPrice).toBe(false);
    expect(capabilitiesOf('seller_manager').editPrice).toBe(true);
    expect(capabilitiesOf('seller_owner').editPrice).toBe(true);
    expect(capabilitiesOf('seller_staff').editStock).toBe(true);
  });
  it('an unknown role gets least privilege', () => {
    expect(capabilitiesForClaim('wizard').editPrice).toBe(false);
  });
});

describe('scan interpretation', () => {
  const result = {
    viewingRequestId: 'v',
    checkedInAt: iso(0),
    buyerName: 'Sara',
    scheduledAt: iso(0),
    products: [],
  };
  it('fresh scan is a check-in; an old check-in time is "already"', () => {
    expect(interpretScan(result, NOW + 500).kind).toBe('checked_in');
    expect(interpretScan(result, NOW + ALREADY_AFTER_MS + 1).kind).toBe('already');
  });
  it('maps every known error code, and falls back for unknown ones', () => {
    expect(interpretScanProblem('pass_invalid').kind).toBe('invalid');
    expect(interpretScanProblem('pass_expired').kind).toBe('expired');
    expect(interpretScanProblem('pass_not_yet_valid').kind).toBe('not_yet');
    expect(interpretScanProblem('not_found').kind).toBe('not_ours');
    expect(interpretScanProblem('viewing_not_active').kind).toBe('closed');
    expect(interpretScanProblem('boom')).toEqual({ kind: 'error', code: 'boom' });
  });
  it('strips whitespace from typed codes', () => {
    expect(normalisePass(' ab cd\nef ')).toBe('abcdef');
  });
});

describe('stock', () => {
  const offer: OfferLike = {
    id: 'o',
    version: 4,
    stockQty: 10,
    reservedQty: 3,
    sellingPrice: 12_500,
    viewingStatus: 'Viewable on Request',
  };
  const staff = capabilitiesOf('seller_staff');
  const manager = capabilitiesOf('seller_manager');
  it('sends nothing when nothing changed', () => {
    expect(
      buildPatch(offer, { stockQty: 10, viewingStatus: 'Viewable on Request' }, manager),
    ).toBeNull();
  });
  it('sends only changed fields with the version seen', () => {
    expect(buildPatch(offer, { stockQty: 8, viewingStatus: 'Viewable on Request' }, staff)).toEqual(
      { expectedVersion: 4, stockQty: 8 },
    );
  });
  it('confirms display when set On Display', () => {
    expect(buildPatch(offer, { stockQty: 10, viewingStatus: 'On Display' }, staff)).toEqual({
      expectedVersion: 4,
      viewingStatus: 'On Display',
      displayConfirmed: true,
    });
  });
  it('never sends price for staff, does for managers', () => {
    const draft = { stockQty: 10, viewingStatus: offer.viewingStatus, sellingPrice: 99_900 };
    expect(buildPatch(offer, draft, staff)).toBeNull();
    expect(buildPatch(offer, draft, manager)).toEqual({ expectedVersion: 4, sellingPrice: 99_900 });
  });
  it('explains refusals', () => {
    expect(interpretEditFailure('stock_below_reserved', '5 unit(s) are held', offer)).toEqual({
      kind: 'held',
      held: 5,
    });
    expect(interpretEditFailure('stock_below_reserved', undefined, offer)).toEqual({
      kind: 'held',
      held: 3,
    });
    expect(interpretEditFailure('offer_version_conflict', undefined, offer)).toEqual({
      kind: 'conflict',
    });
    expect(interpretEditFailure('x', undefined, offer)).toEqual({ kind: 'other', code: 'x' });
  });
  it('parses AED text to integer fils without floats', () => {
    expect(aedToFils('1,234.50')).toBe(123_450);
    expect(aedToFils('1234.5')).toBe(123_450);
    expect(aedToFils('٣٣٫٠٥')).toBe(3_305);
    expect(aedToFils('0.1')).toBe(10);
    expect(aedToFils('19.99')).toBe(1_999);
    for (const bad of ['', 'abc', '0', '1.234', '-5', '1e3']) expect(aedToFils(bad)).toBeNull();
    expect(filsToAedText(123_405)).toBe('1234.05');
  });
});

describe('tasks', () => {
  const viewing = {
    id: 'v1',
    viewingRequestId: 'vr1',
    dueAt: iso(3_600_000),
    response: null,
    locationName: 'Showroom',
    products: [{ name: 'Sofa', quantity: 1, onDisplay: true }],
  };
  const purchase = {
    id: 'p1',
    dueAt: iso(600_000),
    responded: null,
    lines: [{ productName: 'Lamp', quantity: 2, sellerSku: 'L-1', stockQty: 9 }],
  };
  it('adapts both kinds', () => {
    expect(fromViewing(viewing)).toMatchObject({
      key: 'viewing:v1',
      where: 'Showroom',
      viewingRequestId: 'vr1',
      answered: false,
    });
    expect(fromPurchase({ ...purchase, responded: 'Confirmed' })).toMatchObject({
      key: 'purchase:p1',
      answer: 'Confirmed',
      answered: true,
    });
  });
  it('merges in urgency order and finds by id', () => {
    const list = inbox([viewing], [purchase], NOW);
    expect(list.map((t) => t.id)).toEqual(['p1', 'v1']);
    expect(findTask(list, 'v1')?.kind).toBe('viewing');
    expect(findTask(list, 'zzz')).toBeUndefined();
  });
  it('allOnDisplay needs every item on display', () => {
    expect(allOnDisplay(fromViewing(viewing))).toBe(true);
    expect(
      allOnDisplay(
        fromViewing({
          ...viewing,
          products: [...viewing.products, { name: 'Rug', quantity: 1, onDisplay: false }],
        }),
      ),
    ).toBe(false);
    expect(allOnDisplay(fromViewing({ ...viewing, products: [] }))).toBe(false);
    expect(allOnDisplay(fromPurchase(purchase))).toBe(false);
  });
});

describe('push routing', () => {
  it('extracts task ids only from our own link shapes', () => {
    expect(taskIdFromUrl(`aidooiseller://task/${ID}`)).toBe(ID);
    expect(taskIdFromUrl(`/task/${ID}/`)).toBe(ID);
    expect(taskIdFromUrl(`https://evil.test/task/${ID}`)).toBeNull();
    expect(taskIdFromUrl('aidooiseller://task/../../etc')).toBeNull();
    expect(taskIdFromUrl(null)).toBeNull();
  });
  it('routes a notification payload, rejecting junk', () => {
    expect(routeForNotification({ url: `aidooiseller://task/${ID}` })).toBe(`/task/${ID}`);
    expect(routeForNotification({ taskId: ID })).toBe(`/task/${ID}`);
    expect(routeForNotification({ taskId: '../x' })).toBeNull();
    expect(routeForNotification('x')).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });
});
