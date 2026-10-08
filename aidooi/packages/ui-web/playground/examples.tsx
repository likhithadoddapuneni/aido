import { ApiProblem } from '@aidooi/api-client';
import { useState, type ReactNode } from 'react';
import {
  AppShell,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CsvDropzone,
  CursorPagination,
  DataTable,
  DateTime,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  FormErrorSummary,
  IconButton,
  Input,
  KeyValueList,
  Money,
  PageHeader,
  Radio,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Stepper,
  Switch,
  Tabs,
  Textarea,
  Timeline,
  Tooltip,
  useToast,
  type Column,
  type Sort,
} from '../src/index.ts';

export interface Example {
  id: string;
  title: string;
  /** What the gallery shows. */
  element: ReactNode;
  /** The same component in its most demanding state (an overlay already open), for tests. */
  open?: ReactNode;
}

interface Row {
  id: string;
  sku: string;
  name: string;
  status: string;
  price: number;
}
const ROWS: Row[] = [
  { id: 'a', sku: 'SOF-001', name: 'Mesa three-seater', status: 'Active', price: 349_000 },
  { id: 'b', sku: 'TBL-014', name: 'Orla coffee table', status: 'Low Stock', price: 89_500 },
  { id: 'c', sku: 'LMP-203', name: 'Pico floor lamp', status: 'Inactive', price: 21_000 },
];
const COLUMNS: Column<Row>[] = [
  { id: 'sku', header: 'SKU', cell: (r) => r.sku, sortable: true },
  { id: 'name', header: 'Product', cell: (r) => r.name, sortable: true },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => (
      <StatusPill
        status={r.status}
        map={{ Active: 'ok', 'Low Stock': 'warn', Inactive: 'neutral' }}
      />
    ),
  },
  {
    id: 'price',
    header: 'Price',
    cell: (r) => <Money fils={r.price} />,
    numeric: true,
    sortable: true,
  },
];

function TableDemo() {
  const [sort, setSort] = useState<Sort | undefined>({ columnId: 'sku', direction: 'asc' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <DataTable
      caption="Offers"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      sort={sort}
      onSortChange={setSort}
      selected={selected}
      onSelectionChange={setSelected}
      onRowActivate={() => undefined}
    />
  );
}

function FormDemo() {
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <Field label="Trade name" hint="Shown to buyers." required>
        <Input defaultValue="Marina Living" />
      </Field>
      <Field label="Contact email" error="Enter a valid email address.">
        <Input type="email" defaultValue="not-an-email" />
      </Field>
      <Field label="Emirate">
        <Select defaultValue="Dubai">
          <option>Dubai</option>
          <option>Abu Dhabi</option>
        </Select>
      </Field>
      <Field label="After-sales terms">
        <Textarea defaultValue="Returns accepted within 7 days." />
      </Field>
      <Checkbox label="Display on showroom floor" hint="Buyers can view it in store." />
      <Radio name="d" label="Standard delivery" defaultChecked />
      <Radio name="d" label="Express delivery" />
      <Switch label="Accepting orders" defaultChecked />
    </form>
  );
}

function ToastDemo() {
  const { push } = useToast();
  return <Button onClick={() => push({ message: 'Saved.', tone: 'ok' })}>Show toast</Button>;
}

function Overlays({ startOpen = false }: { startOpen?: boolean }) {
  const [dialog, setDialog] = useState(startOpen);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Button onClick={() => setDialog(true)}>Open dialog</Button>
      <Button onClick={() => setDrawer(true)}>Open drawer</Button>
      <Button variant="danger" onClick={() => setConfirm(true)}>
        Deactivate partner
      </Button>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Offer details"
        footer={<Button onClick={() => setDialog(false)}>Done</Button>}
      >
        <p>Price changes never touch open reservations or placed orders.</p>
      </Dialog>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters">
        <Field label="Status">
          <Input />
        </Field>
      </Drawer>
      <ConfirmDialog
        open={confirm}
        title="Deactivate partner?"
        description="Their offers leave recommendations immediately."
        confirmLabel="Deactivate"
        danger
        requireWord="DEACTIVATE"
        onConfirm={() => undefined}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

const SHELL_SECTIONS = [
  {
    id: 'catalogue',
    label: 'Catalogue',
    items: [
      { id: 'offers', label: 'Offers', href: '#offers', current: true },
      { id: 'imports', label: 'Imports', href: '#imports' },
    ],
  },
  { id: 'sales', label: 'Sales', items: [{ id: 'orders', label: 'Orders', href: '#orders' }] },
];

export const EXAMPLES: Example[] = [
  {
    id: 'buttons',
    title: 'Buttons',
    element: (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Edit offer" icon="✎" />
      </div>
    ),
  },
  { id: 'forms', title: 'Form controls and Field', element: <FormDemo /> },
  {
    id: 'error-summary',
    title: 'Form error summary',
    element: (
      <FormErrorSummary
        errors={[
          { path: 'email', message: 'Enter a valid email address.' },
          { path: 'price', message: 'Price must be above zero.' },
        ]}
      />
    ),
  },
  {
    id: 'values',
    title: 'Money and DateTime',
    element: (
      <p>
        <Money fils={349_000} /> · <Money fils={89_550} /> ·{' '}
        <DateTime value="2026-10-07T09:30:00Z" /> ·{' '}
        <DateTime value="2026-10-07T09:30:00Z" style="date" />
      </p>
    ),
  },
  {
    id: 'badges',
    title: 'Badges and status',
    element: (
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge>Neutral</Badge>
        <Badge tone="ok">Verified</Badge>
        <Badge tone="warn">Needs review</Badge>
        <Badge tone="err">Rejected</Badge>
        <StatusPill status="Delivered" map={{ Delivered: 'ok' }} />
      </p>
    ),
  },
  {
    id: 'card',
    title: 'Card',
    element: (
      <Card title="Settlement" actions={<Button variant="ghost">Export</Button>}>
        <KeyValueList
          items={[
            { key: 'gross', label: 'Gross', value: <Money fils={1_200_000} /> },
            { key: 'comm', label: 'Commission', value: <Money fils={168_000} /> },
          ]}
        />
      </Card>
    ),
  },
  {
    id: 'tabs',
    title: 'Tabs',
    element: (
      <Tabs
        label="Order sections"
        tabs={[
          { id: 'lines', label: 'Lines', panel: <p>Order lines.</p> },
          { id: 'history', label: 'History', panel: <p>Status history.</p> },
        ]}
      />
    ),
  },
  {
    id: 'overlays',
    title: 'Dialog, Drawer, ConfirmDialog',
    element: <Overlays />,
    open: <Overlays startOpen />,
  },
  { id: 'toast', title: 'Toast', element: <ToastDemo /> },
  {
    id: 'tooltip',
    title: 'Tooltip',
    element: (
      <Tooltip label="Opens the audit trail">
        <Button>Audit</Button>
      </Tooltip>
    ),
  },
  {
    id: 'loading',
    title: 'Spinner and Skeleton',
    element: (
      <div>
        <Spinner />
        <Skeleton width="60%" />
      </div>
    ),
  },
  {
    id: 'states',
    title: 'Empty and error states',
    element: (
      <>
        <EmptyState
          description="Import a CSV or add an offer to get started."
          action={<Button variant="primary">Add offer</Button>}
        />
        <ErrorState
          error={
            new ApiProblem({
              status: 409,
              code: 'price_approval_required',
              correlationId: 'corr-1234',
            })
          }
          onRetry={() => undefined}
        />
      </>
    ),
  },
  {
    id: 'page-header',
    title: 'Page header',
    element: (
      <PageHeader
        title="Offers"
        description="Your live prices and stock."
        actions={<Button variant="primary">Add offer</Button>}
      />
    ),
  },
  { id: 'table', title: 'Data table', element: <TableDemo /> },
  {
    id: 'pagination',
    title: 'Cursor pagination',
    element: (
      <CursorPagination
        page={2}
        hasPrevious
        nextCursor="cursor-3"
        onNext={() => undefined}
        onPrevious={() => undefined}
      />
    ),
  },
  {
    id: 'filter',
    title: 'Filter bar',
    element: (
      <FilterBar onSubmit={() => undefined} onClear={() => undefined}>
        <Field label="Search">
          <Input />
        </Field>
      </FilterBar>
    ),
  },
  {
    id: 'dropzone',
    title: 'CSV dropzone',
    element: <CsvDropzone maxBytes={2_000_000} onFile={() => undefined} />,
  },
  {
    id: 'timeline',
    title: 'Timeline',
    element: (
      <Timeline
        label="Status history"
        entries={[
          {
            id: '1',
            title: 'Delivered',
            at: <DateTime value="2026-10-07T09:30:00Z" />,
            tone: 'ok',
          },
          { id: '2', title: 'Dispatched', at: <DateTime value="2026-10-06T14:00:00Z" /> },
        ]}
      />
    ),
  },
  {
    id: 'stepper',
    title: 'Stepper',
    element: <Stepper steps={['Upload', 'Review errors', 'Commit']} current={1} />,
  },
  {
    id: 'shell',
    title: 'App shell',
    element: (
      <AppShell
        brand="AiDOOi"
        sections={SHELL_SECTIONS}
        user={{ name: 'Layla Haddad', detail: 'Marina Living' }}
        onSignOut={() => undefined}
      >
        <PageHeader title="Offers" />
      </AppShell>
    ),
  },
];
