import { sortByUrgency } from './sla.ts';

export type TaskKind = 'viewing' | 'purchase';
export type Answer = 'Confirmed' | 'Declined';

export interface TaskItem {
  readonly name: string;
  readonly quantity: number;
  /** Purchase tasks show how much stock the seller says they have; viewing tasks show display state. */
  readonly detail:
    | { readonly kind: 'stock'; readonly qty: number; readonly sku: string }
    | { readonly kind: 'display'; readonly onDisplay: boolean };
}

/** One row of the inbox, whichever kind of confirmation it is. */
export interface InboxTask {
  readonly key: string;
  readonly kind: TaskKind;
  readonly id: string;
  readonly dueAt: string;
  readonly answer: Answer | null;
  readonly answered: boolean;
  /** Showroom name for a viewing; undefined for purchases. */
  readonly where?: string;
  /** For viewings: the request, so the visit's outcome can be recorded from the task itself. */
  readonly viewingRequestId?: string;
  readonly items: readonly TaskItem[];
}

interface ViewingTaskLike {
  readonly id: string;
  readonly viewingRequestId: string;
  readonly dueAt: string;
  readonly response: Answer | null;
  readonly locationName: string;
  readonly products: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly onDisplay: boolean;
  }[];
}
interface PurchaseTaskLike {
  readonly id: string;
  readonly dueAt: string;
  readonly responded: Answer | null;
  readonly lines: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly sellerSku: string;
    readonly stockQty: number;
  }[];
}

export const fromViewing = (t: ViewingTaskLike): InboxTask => ({
  key: `viewing:${t.id}`,
  kind: 'viewing',
  id: t.id,
  dueAt: t.dueAt,
  answer: t.response,
  answered: t.response !== null,
  where: t.locationName,
  viewingRequestId: t.viewingRequestId,
  items: t.products.map((p) => ({
    name: p.name,
    quantity: p.quantity,
    detail: { kind: 'display', onDisplay: p.onDisplay },
  })),
});

export const fromPurchase = (t: PurchaseTaskLike): InboxTask => ({
  key: `purchase:${t.id}`,
  kind: 'purchase',
  id: t.id,
  dueAt: t.dueAt,
  answer: t.responded,
  answered: t.responded !== null,
  items: t.lines.map((l) => ({
    name: l.productName,
    quantity: l.quantity,
    detail: { kind: 'stock', qty: l.stockQty, sku: l.sellerSku },
  })),
});

/** Merge both lists in inbox order: what will lapse soonest first, answered tasks last. */
export function inbox(
  viewing: readonly ViewingTaskLike[],
  purchase: readonly PurchaseTaskLike[],
  nowMs: number,
): InboxTask[] {
  return sortByUrgency([...viewing.map(fromViewing), ...purchase.map(fromPurchase)], nowMs);
}

/** A deep link names a task id without saying which kind; find it in either list. */
export const findTask = (tasks: readonly InboxTask[], id: string): InboxTask | undefined =>
  tasks.find((t) => t.id === id);

/** Every viewing item on display? Used to pre-set the "on display now" switch honestly. */
export const allOnDisplay = (t: InboxTask): boolean =>
  t.items.length > 0 && t.items.every((i) => i.detail.kind === 'display' && i.detail.onDisplay);
