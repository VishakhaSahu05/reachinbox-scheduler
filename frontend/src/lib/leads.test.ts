import { describe, expect, it } from 'vitest';
import { extractEmails, mergeEmails } from './leads';

describe('extractEmails', () => {
  it('reads addresses out of a CSV with headers and other columns', () => {
    const csv = 'name,email,company\nJane Doe,Jane@Acme.io,Acme\n"Smith, John",john.smith+leads@mail.example.com,Example\n';
    expect(extractEmails(csv)).toEqual(['jane@acme.io', 'john.smith+leads@mail.example.com']);
  });

  it('handles one-per-line text, de-duplicates case-insensitively and ignores junk', () => {
    const text = 'a@x.com\nA@X.com\nnot-an-email\nb@y.org;c@z.co.uk, d@w.dev.';
    expect(extractEmails(text)).toEqual(['a@x.com', 'b@y.org', 'c@z.co.uk', 'd@w.dev']);
  });

  it('returns nothing for text without addresses', () => {
    expect(extractEmails('hello world')).toEqual([]);
  });
});

describe('mergeEmails', () => {
  it('appends only new addresses and counts duplicates', () => {
    expect(mergeEmails(['a@x.com'], ['a@x.com', 'b@x.com'])).toEqual({ emails: ['a@x.com', 'b@x.com'], added: 1, duplicates: 1 });
  });
});
