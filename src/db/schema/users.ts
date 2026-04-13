// Application users. Row id matches Supabase `auth.users.id` (not a
// generated UUID — Supabase Auth owns the source of truth).
//
// Each user belongs to exactly one company. `companyId` is nullable because
// a user row is created on sign-up before they either create or join one.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    // Matches auth.users.id from Supabase Auth — no defaultRandom().
    id: uuid('id').primaryKey(),

    // Company this user belongs to. NULL until they create or join a company.
    companyId: uuid('company_id').references(() => companies.id, {
      onDelete: 'restrict',
    }),

    role: userRoleEnum('role').default('viewer'),

    // invited (pre-signup) | active | deactivated.
    status: userStatusEnum('status').notNull().default('invited'),

    fullName: text('full_name').notNull(),

    // Denormalized from auth.users for query convenience.
    email: varchar('email', { length: 320 }).notNull(),

    avatarUrl: text('avatar_url'),

    // Who invited this user (NULL if they created the company).
    invitedBy: uuid('invited_by'),

    // User preferences: notification settings, dashboard layout, etc.
    preferences: jsonb('preferences').default({}),

    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
    index('users_company_id_idx').on(table.companyId),
    // Composite index critical for RLS perf: every RLS policy evaluates
    // "company_id = (SELECT company_id FROM users WHERE id = auth.uid()
    // AND status = 'active')". (company_id, status) keeps that scan narrow.
    index('users_company_status_idx').on(table.companyId, table.status),
    index('users_company_role_idx').on(table.companyId, table.role),
  ]
);
