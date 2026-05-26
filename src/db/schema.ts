import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Raw ACDP webhook events ingested from registries.
export const contextEvents = pgTable(
  'context_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. Defaults to 'default' for backward compat with
    // single-tenant deployments; the migration backfills existing rows.
    tenantId: varchar('tenant_id', { length: 255 }).notNull().default('default'),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    eventTs: timestamp('event_ts', { withTimezone: true, mode: 'string' }).notNull(),
    runId: varchar('run_id', { length: 255 }),
    ctxId: text('ctx_id'),
    lineageId: text('lineage_id'),
    agentId: text('agent_id').notNull(),
    contextType: varchar('context_type', { length: 128 }),
    visibility: varchar('visibility', { length: 32 }),
    version: integer('version'),
    derivedFrom: jsonb('derived_from').$type<string[]>().notNull().default([]),
    registryAuthority: varchar('registry_authority', { length: 255 }).notNull(),
    scenarioId: varchar('scenario_id', { length: 128 }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ce_tenant_idx').on(t.tenantId),
    runIdx: index('ce_run_idx').on(t.runId),
    ctxIdx: index('ce_ctx_idx').on(t.ctxId),
    tsIdx: index('ce_ts_idx').on(t.eventTs),
    agentIdx: index('ce_agent_idx').on(t.agentId),
    lineageIdx: index('ce_lineage_idx').on(t.lineageId),
    typeIdx: index('ce_type_idx').on(t.eventType),
  }),
);

// Playground run records (correlated by X-Run-Id).
export const runs = pgTable(
  'runs',
  {
    runId: varchar('run_id', { length: 255 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 255 }).notNull().default('default'),
    scenarioId: varchar('scenario_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    inputs: jsonb('inputs').$type<Record<string, unknown>>(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    contextsCount: integer('contexts_count').notNull().default(0),
    registries: jsonb('registries').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('runs_tenant_idx').on(t.tenantId),
    statusIdx: index('runs_status_idx').on(t.status),
    scenarioIdx: index('runs_scenario_idx').on(t.scenarioId),
    startedIdx: index('runs_started_idx').on(t.startedAt),
  }),
);

// Lineage adjacency: to_ctx_id DERIVES FROM from_ctx_id.
export const lineageEdges = pgTable(
  'lineage_edges',
  {
    fromCtxId: text('from_ctx_id').notNull(),
    toCtxId: text('to_ctx_id').notNull(),
    runId: varchar('run_id', { length: 255 }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromCtxId, t.toCtxId] }),
    toIdx: index('le_to_idx').on(t.toCtxId),
    fromIdx: index('le_from_idx').on(t.fromCtxId),
    runIdx: index('le_run_idx').on(t.runId),
  }),
);

// Known agent DIDs observed through events.
export const agents = pgTable('agents', {
  agentDid: text('agent_did').primaryKey(),
  tenantId: varchar('tenant_id', { length: 255 }).notNull().default('default'),
  firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  registryAuthority: varchar('registry_authority', { length: 255 }),
  contextCount: integer('context_count').notNull().default(0),
});

// Known registries observed through events.
export const registries = pgTable('registries', {
  authority: varchar('authority', { length: 255 }).primaryKey(),
  baseUrl: text('base_url'),
  firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  eventCount: integer('event_count').notNull().default(0),
});

// Outbound webhook subscriptions.
export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default([]),
  secret: varchar('secret', { length: 255 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id')
    .notNull()
    .references(() => webhooks.id, { onDelete: 'cascade' }),
  event: varchar('event', { length: 128 }).notNull(),
  runId: varchar('run_id', { length: 255 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'string' }),
  responseStatus: integer('response_status'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
});

export type ContextEvent = typeof contextEvents.$inferSelect;
export type NewContextEvent = typeof contextEvents.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type LineageEdge = typeof lineageEdges.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Registry = typeof registries.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
