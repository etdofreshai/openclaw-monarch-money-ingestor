#!/usr/bin/env node
/**
 * Patches monarch-money-ts Zod schemas to allow null where the API returns it.
 * - accounts.types.js: logoUrl, institution
 * - transactions.types.js: all bare z.string() fields (plaidName, dataProviderDescription, etc.)
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', 'monarch-money-ts', 'dist');

if (!fs.existsSync(distDir)) {
  console.log('monarch-money-ts not installed yet, skipping patch');
  process.exit(0);
}

// --- Patch accounts.types.js ---
const accountsPath = path.join(distDir, 'accounts.types.js');
if (fs.existsSync(accountsPath)) {
  let content = fs.readFileSync(accountsPath, 'utf-8');
  content = content.replace(/logoUrl: z\.string\(\),/g, 'logoUrl: z.string().nullable(),');
  content = content.replace('institution: InstitutionSchema,', 'institution: InstitutionSchema.nullable(),');
  fs.writeFileSync(accountsPath, content);
  console.log('Patched accounts.types.js: made logoUrl and institution nullable');
}

// --- Patch transactions.types.js ---
// Make all bare z.string() fields nullable to prevent future breakage
// when the Monarch API returns null for string fields.
const txPath = path.join(distDir, 'transactions.types.js');
if (fs.existsSync(txPath)) {
  let content = fs.readFileSync(txPath, 'utf-8');
  // Turn `z.string(),` into `z.string().nullable(),` (only bare ones without .nullable/.optional already)
  content = content.replace(/z\.string\(\),/g, 'z.string().nullable(),');
  fs.writeFileSync(txPath, content);
  console.log('Patched transactions.types.js: made all bare z.string() fields nullable');
}
# Force rebuild 20260326014249
