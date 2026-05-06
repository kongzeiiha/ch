/**
 * Fastify JSON Schema bodies for the key admin mutation routes.
 * Validated by Fastify's built-in Ajv before the handler runs —
 * missing/wrong-type fields return a 400 automatically.
 */

const nonEmptyString = { type: 'string', minLength: 1 } as const;

export const sourceCreateBody = {
  type: 'object',
  required: ['platform', 'external_id', 'name', 'url'],
  additionalProperties: true,
  properties: {
    platform:    nonEmptyString,
    external_id: nonEmptyString,
    name:        nonEmptyString,
    url:         { type: 'string', minLength: 1, maxLength: 2048 },
    config:      { type: 'object' },
  },
} as const;

export const sourcePatchBody = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name:   { type: 'string', minLength: 1 },
    url:    { type: 'string', minLength: 1, maxLength: 2048 },
    status: { type: 'string', enum: ['active', 'paused', 'blacklist', 'inactive'] },
    config: { type: 'object' },
  },
} as const;

export const credentialCreateBody = {
  type: 'object',
  required: ['platform', 'name'],
  additionalProperties: true,
  properties: {
    platform:   nonEmptyString,
    name:       nonEmptyString,
    cookie:     { type: 'string' },
    user_agent: { type: 'string' },
  },
} as const;

export const credentialPatchBody = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name:       { type: 'string', minLength: 1 },
    cookie:     { type: 'string' },
    user_agent: { type: 'string' },
    status:     { type: 'string', enum: ['active', 'expired', 'revoked'] },
  },
} as const;

export const credentialSecretBody = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: nonEmptyString,
    password: nonEmptyString,
  },
} as const;

export const batchImportBody = {
  type: 'object',
  required: ['platform', 'handles'],
  additionalProperties: true,
  properties: {
    platform:     { type: 'string', enum: ['x', 'bluesky', 'reddit'] },
    handles:      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 500 },
    sharedConfig: { type: 'object' },
    credentialId: { type: 'string' },
    triggerFetch: { type: 'boolean' },
  },
} as const;
