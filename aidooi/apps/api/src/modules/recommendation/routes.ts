import { z } from 'zod';
import {
  AlternativesSchema,
  BudgetCardsSchema,
  CompositionParamsSchema,
  CompositionSchema,
  CreateProjectBodySchema,
  ProjectParamsSchema,
  ProjectSchema,
  RankingSchema,
  RecommendationResponseSchema,
  ReplaceBodySchema,
  SlotParamsSchema,
  UpdateProjectBodySchema,
  errorsFor,
} from '@aidooi/contracts';
import type { ModuleRoutes } from '../registry.ts';
import * as svc from './service.ts';

const tags = ['recommendation'];

export const recommendationRoutes: ModuleRoutes = async (app, ctx) => {
  app.post(
    '/v1/projects',
    {
      schema: {
        tags,
        summary:
          'Start a project. Each path collects only the inputs it needs; the size class is derived.',
        body: CreateProjectBodySchema,
        response: { 201: ProjectSchema, ...errorsFor(400, 401, 403) },
      },
    },
    async (req, reply) => reply.code(201).send(await svc.createProject(ctx, req, req.body.input)),
  );

  app.get(
    '/v1/projects',
    {
      schema: {
        tags,
        summary: 'My projects',
        response: { 200: z.object({ projects: z.array(ProjectSchema) }), ...errorsFor(401, 403) },
      },
    },
    async (req) => ({ projects: await svc.listProjects(ctx, req) }),
  );

  app.get(
    '/v1/projects/:projectId',
    {
      schema: {
        tags,
        params: ProjectParamsSchema,
        response: { 200: ProjectSchema, ...errorsFor(401, 403, 404) },
      },
    },
    async (req) => svc.getProject(ctx, req, req.params.projectId),
  );

  app.put(
    '/v1/projects/:projectId',
    {
      schema: {
        tags,
        summary: 'Revise a project’s answers (the path itself cannot change).',
        params: ProjectParamsSchema,
        body: UpdateProjectBodySchema,
        response: { 200: ProjectSchema, ...errorsFor(400, 401, 403, 404, 409) },
      },
    },
    async (req) => svc.updateProject(ctx, req, req.params.projectId, req.body.input),
  );

  app.get(
    '/v1/projects/:projectId/budget-cards',
    {
      schema: {
        tags,
        summary: 'The five budget tiers with their AED range for this project (AID-LOG-001).',
        params: ProjectParamsSchema,
        response: { 200: BudgetCardsSchema, ...errorsFor(401, 403, 404) },
      },
    },
    async (req) => svc.budgetCards(ctx, req, req.params.projectId),
  );

  app.post(
    '/v1/projects/:projectId/recommend',
    {
      schema: {
        tags,
        summary: 'Generate up to four differentiated compositions (WF-02).',
        params: ProjectParamsSchema,
        response: { 200: RecommendationResponseSchema, ...errorsFor(401, 403, 404, 409, 422) },
      },
    },
    async (req) => svc.recommend(ctx, req, req.params.projectId),
  );

  app.post(
    '/v1/projects/:projectId/rank',
    {
      schema: {
        tags,
        summary: 'Rank products for an Individual Product project (AID-SPC-009).',
        params: ProjectParamsSchema,
        response: { 200: RankingSchema, ...errorsFor(401, 403, 404, 409, 422) },
      },
    },
    async (req) => svc.rank(ctx, req, req.params.projectId),
  );

  app.get(
    '/v1/compositions/:compositionId',
    {
      schema: {
        tags,
        summary: 'A composition re-scored against live data; changed items are flagged stale.',
        params: CompositionParamsSchema,
        response: { 200: CompositionSchema, ...errorsFor(401, 403, 404) },
      },
    },
    async (req) => svc.getComposition(ctx, req, req.params.compositionId),
  );

  app.get(
    '/v1/compositions/:compositionId/items/:slotKey/alternatives',
    {
      schema: {
        tags,
        summary:
          'Eligible replacements for one item, re-scored against the live catalogue (WF-03).',
        params: SlotParamsSchema,
        response: { 200: AlternativesSchema, ...errorsFor(401, 403, 404) },
      },
    },
    async (req) => svc.alternatives(ctx, req, req.params.compositionId, req.params.slotKey),
  );

  app.put(
    '/v1/compositions/:compositionId/items/:slotKey',
    {
      schema: {
        tags,
        summary:
          'Replace an item. The new product is revalidated; the composition must stay valid.',
        params: SlotParamsSchema,
        body: ReplaceBodySchema,
        response: { 200: CompositionSchema, ...errorsFor(400, 401, 403, 404, 409, 422) },
      },
    },
    async (req) =>
      svc.replaceItem(ctx, req, req.params.compositionId, req.params.slotKey, req.body.offerId),
  );

  app.delete(
    '/v1/compositions/:compositionId/items/:slotKey',
    {
      schema: {
        tags,
        summary: 'Remove a non-essential item; the total recalculates immediately.',
        params: SlotParamsSchema,
        response: { 200: CompositionSchema, ...errorsFor(401, 403, 404, 409, 422) },
      },
    },
    async (req) => svc.removeSlot(ctx, req, req.params.compositionId, req.params.slotKey),
  );
};
