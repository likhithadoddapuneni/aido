import type { Clock } from '@aidooi/domain';
import type {
  AuthorizeRequest,
  AuthorizeResult,
  CaptureRequest,
  CaptureResult,
} from '../../src/payments/gateway.ts';
import { MockGateway } from '../../src/payments/mock-gateway.ts';

/**
 * A mock processor that lets a test change the world at the exact moment a real one could:
 * after an authorisation succeeded, or after money was captured. Used to prove the saga re-validates
 * before capturing and compensates when the order cannot be placed.
 */
export class HookedGateway extends MockGateway {
  afterAuthorize: (() => Promise<void>) | null = null;
  afterCapture: (() => Promise<void>) | null = null;

  constructor(deps: { clock: Clock }) {
    super(deps);
  }

  override async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    const r = await super.authorize(req);
    if (r.status === 'authorized' && this.afterAuthorize) {
      const hook = this.afterAuthorize;
      this.afterAuthorize = null;
      await hook();
    }
    return r;
  }

  override async capture(req: CaptureRequest): Promise<CaptureResult> {
    const r = await super.capture(req);
    if (r.status === 'captured' && this.afterCapture) {
      const hook = this.afterCapture;
      this.afterCapture = null;
      await hook();
    }
    return r;
  }
}
