// Optional real-library validation; no npm install, and production still uses pinned npm:.
// BACKEND_PHONE_CDN=1 node --test tests/backend-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeWhatsApp } from '../supabase/functions/clube-api/domain.mjs';

test('real libphonenumber-js 1.13.15 /max: BR, explicit foreign country, invalid number', { skip: process.env.BACKEND_PHONE_CDN !== '1' }, async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/libphonenumber-js@1.13.15/bundle/libphonenumber-max.js');
  assert.equal(response.status, 200);
  const context = vm.createContext({});
  vm.runInContext(await response.text(), context, { timeout: 15000 });
  // Library options must be created in its VM realm (it checks Object constructors).
  const inRealm = vm.runInContext('(value, opts) => libphonenumber.parsePhoneNumberFromString(value, JSON.parse(opts))', context);
  const parse = (value, options) => inRealm(value, JSON.stringify(options));
  assert.equal(normalizeWhatsApp('(85) 99999-9999', parse), '+5585999999999');
  assert.equal(normalizeWhatsApp('+55 (85) 99999-9999', parse), '+5585999999999');
  assert.equal(normalizeWhatsApp('+1 202-555-0123', parse), '+12025550123');
  for (const value of ['(85) 11111-1111', '+999 1234567890', '99999-9999', '5585999999999', '+55 85 99999-9999 ext 123']) assert.throws(() => normalizeWhatsApp(value, parse), undefined, value);
});
