import {
  bigint,
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

// Append-only audit ledger of token-issuance attempts. Decisions are
// recorded for both `mint` (successful JWT) and `reject_*` (each
// validation failure point) so operators can answer compliance
// questions like "how many tokens were issued for sub=X today" or
// "show me all unauthorized attempts from agent Y last hour".
//
// `prev_hash` / `entry_hash` build a SHA-256 hash chain across rows
// in `id` order so post-hoc tampering with a row becomes detectable
// at audit time (the read path can recompute the chain). This is
// not Merkle-tree-grade tamper evidence — it does not protect
// against an attacker who can replay-rewrite the entire tail — but
// it's enough to detect surgical edits at audit time, and is a
// foundation for stronger commitments later.
export const issuanceLedger = pgTable(
  'issuance_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jti: varchar('jti', { length: 64 }),
    sub: text('sub'),
    iss: text('iss'),
    iat: bigint('iat', { mode: 'number' }),
    exp: bigint('exp', { mode: 'number' }),
    signerIp: varchar('signer_ip', { length: 64 }),
    decision: varchar('decision', { length: 32 }).notNull(),
    decisionDetail: text('decision_detail'),
    // Hex SHA-256 of the prior row's `entryHash` (or 64 zeros for the
    // first row). NULL for legacy backfills.
    prevHash: varchar('prev_hash', { length: 64 }),
    // Hex SHA-256 of (prevHash || canonical(this row)).
    entryHash: varchar('entry_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subIdx: index('issuance_ledger_sub_idx').on(t.sub),
    jtiIdx: index('issuance_ledger_jti_idx').on(t.jti),
    decisionIdx: index('issuance_ledger_decision_idx').on(t.decision),
    createdIdx: index('issuance_ledger_created_idx').on(t.createdAt),
  }),
);

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
export type IssuanceLedgerEntry = typeof issuanceLedger.$inferSelect;
export type NewIssuanceLedgerEntry = typeof issuanceLedger.$inferInsert;
