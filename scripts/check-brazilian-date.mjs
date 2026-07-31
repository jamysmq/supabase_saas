import assert from 'node:assert/strict'
import {
  brazilianDateToIso,
  formatBrazilianDateInput,
  isValidIsoDateNotFuture,
} from '../src/lib/brazilian-date.ts'

assert.equal(formatBrazilianDateInput('1'), '1')
assert.equal(formatBrazilianDateInput('1010'), '10/10')
assert.equal(formatBrazilianDateInput('10101990'), '10/10/1990')
assert.equal(formatBrazilianDateInput('10/10/1990'), '10/10/1990')
assert.equal(formatBrazilianDateInput('1010199000'), '10/10/1990')

assert.equal(brazilianDateToIso('10/10/1990'), '1990-10-10')
assert.equal(brazilianDateToIso('29/02/2024'), '2024-02-29')
assert.equal(brazilianDateToIso('29/02/2023'), null)
assert.equal(brazilianDateToIso('31/04/2020'), null)
assert.equal(brazilianDateToIso('10/10/19'), null)
assert.equal(brazilianDateToIso('01/01/0019'), null)

assert.equal(isValidIsoDateNotFuture('1990-10-10'), true)
assert.equal(isValidIsoDateNotFuture('2023-02-29'), false)
assert.equal(isValidIsoDateNotFuture('0019-01-01'), false)
assert.equal(isValidIsoDateNotFuture('2999-01-01'), false)

console.log('Brazilian date input checks passed.')
