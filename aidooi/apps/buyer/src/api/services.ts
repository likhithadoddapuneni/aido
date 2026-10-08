import { unwrap, type Api } from '@aidooi/api-client';
import type { Composition, ProductCard, Project, ProjectInput } from '@aidooi/contracts';
import type { z } from 'zod';
import type {
  AlternativesSchema,
  BudgetCardsSchema,
  BuyerSessionSchema,
  GuestSessionResponseSchema,
  RankingSchema,
  RecommendationResponseSchema,
} from '@aidooi/contracts';

export type Recommendation = z.infer<typeof RecommendationResponseSchema>;
export type BudgetCards = z.infer<typeof BudgetCardsSchema>;
export type Alternatives = z.infer<typeof AlternativesSchema>;
export type Ranking = z.infer<typeof RankingSchema>;
export type BuyerSession = z.infer<typeof BuyerSessionSchema>;
export type GuestSession = z.infer<typeof GuestSessionResponseSchema>;

/**
 * Every call the discovery screens make, typed against the contracts. Responses are not re-validated
 * at runtime on a phone (cost, and the server is the authority); the smoke script validates every one
 * of them against the contract schemas on a real API, which is what keeps the two in agreement.
 */
export function discoveryServices(api: Api) {
  const http = api.http;
  // The generated path types are exact; request bodies here come from already-validated inputs.
  const json = <T>(p: Promise<{ data?: unknown; error?: unknown; response: Response }>) =>
    unwrap(p as never) as Promise<T>;
  return {
    createGuest: () => json<GuestSession>(http.POST('/v1/auth/guest' as never, {} as never)),
    requestOtp: (phone: string) =>
      json<{ status: 'sent' }>(
        http.POST('/v1/auth/otp/request' as never, { body: { phone } } as never),
      ),
    verifyOtp: (body: {
      phone: string;
      code: string;
      guestToken?: string;
      policyVersion?: string;
    }) => json<BuyerSession>(http.POST('/v1/auth/otp/verify' as never, { body } as never)),
    logout: (refreshToken: string) =>
      http.POST('/v1/auth/logout' as never, { body: { refreshToken } } as never),

    createProject: (input: ProjectInput) =>
      json<Project>(http.POST('/v1/projects' as never, { body: { input } } as never)),
    updateProject: (id: string, input: ProjectInput) =>
      json<Project>(
        http.PUT(
          '/v1/projects/{projectId}' as never,
          { params: { path: { projectId: id } }, body: { input } } as never,
        ),
      ),
    getProject: (id: string) =>
      json<Project>(
        http.GET(
          '/v1/projects/{projectId}' as never,
          { params: { path: { projectId: id } } } as never,
        ),
      ),
    listProjects: () =>
      json<{ projects: Project[] }>(http.GET('/v1/projects' as never, {} as never)).then(
        (r) => r.projects,
      ),
    budgetCards: (id: string) =>
      json<BudgetCards>(
        http.GET(
          '/v1/projects/{projectId}/budget-cards' as never,
          { params: { path: { projectId: id } } } as never,
        ),
      ),
    recommend: (id: string) =>
      json<Recommendation>(
        http.POST(
          '/v1/projects/{projectId}/recommend' as never,
          { params: { path: { projectId: id } } } as never,
        ),
      ),
    rank: (id: string) =>
      json<Ranking>(
        http.POST(
          '/v1/projects/{projectId}/rank' as never,
          { params: { path: { projectId: id } } } as never,
        ),
      ),

    getComposition: (id: string) =>
      json<Composition>(
        http.GET(
          '/v1/compositions/{compositionId}' as never,
          { params: { path: { compositionId: id } } } as never,
        ),
      ),
    alternatives: (id: string, slotKey: string) =>
      json<Alternatives>(
        http.GET(
          '/v1/compositions/{compositionId}/items/{slotKey}/alternatives' as never,
          {
            params: { path: { compositionId: id, slotKey } },
          } as never,
        ),
      ),
    replaceItem: (id: string, slotKey: string, offerId: string) =>
      json<Composition>(
        http.PUT(
          '/v1/compositions/{compositionId}/items/{slotKey}' as never,
          {
            params: { path: { compositionId: id, slotKey } },
            body: { offerId },
          } as never,
        ),
      ),
    removeItem: (id: string, slotKey: string) =>
      json<Composition>(
        http.DELETE(
          '/v1/compositions/{compositionId}/items/{slotKey}' as never,
          {
            params: { path: { compositionId: id, slotKey } },
          } as never,
        ),
      ),
    productCard: (productId: string) =>
      json<ProductCard>(
        http.GET('/v1/products/{id}' as never, { params: { path: { id: productId } } } as never),
      ),
  };
}

export type DiscoveryServices = ReturnType<typeof discoveryServices>;
