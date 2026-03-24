#!/usr/bin/env node
/**
 * Patches monarch-money-ts to:
 * 1. Make logoUrl and institution nullable in AccountSchema
 * 2. Make logoUrl nullable in AccountSummarySchema
 *
 * The upstream library (v0.0.7) has strict Zod schemas that don't allow null
 * for these fields, but the Monarch API returns null for some accounts.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'monarch-money-ts', 'dist', 'accounts.types.js');

if (!fs.existsSync(filePath)) {
  console.log('monarch-money-ts not installed yet, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf-8');

// Make logoUrl nullable
content = content.replace(/logoUrl: z\.string\(\),/g, 'logoUrl: z.string().nullable(),');

// Make institution nullable in AccountSchema
content = content.replace('institution: InstitutionSchema,', 'institution: InstitutionSchema.nullable(),');

fs.writeFileSync(filePath, content);
console.log('Patched monarch-money-ts: made logoUrl and institution nullable');
