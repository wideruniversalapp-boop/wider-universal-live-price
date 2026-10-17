import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitCompanyName } from '../../src/lib/siteConfig';
import {
  isValidEmail,
  isValidPhone,
  mailHref,
  normalizeDirectory,
  publicBranches,
  telHref,
  validateDirectory,
  type ContactDirectory,
} from '../../src/lib/contacts';

const initial = normalizeDirectory(JSON.parse(readFileSync('data/contacts.initial.json', 'utf8')));

describe('initial contact data', () => {
  it('contains exactly the three supplied branches and contacts, unchanged', () => {
    expect(validateDirectory(initial)).toEqual({});
    const rows = initial.branches.map((b) => [b.name, ...b.contacts.flatMap((c) => [c.name, c.phone, c.email])]);
    expect(rows).toEqual([
      ['Jeddah Branch', 'Rauf', '+966 51 121 1028', 'Salesjeddah@wideruniversal.com'],
      ['Riyadh Branch', 'Savan Abdulla', '+966 56 332 6309', 'abdulla@theuniversalgrp.com'],
      ['Al Khobar Branch', 'Sulthan', '+966 55 882 9335', 'Saleskhobar@wideruniversal.com'],
    ]);
  });

  it('builds working call and email links', () => {
    expect(initial.branches.map((b) => telHref(b.contacts[0].phone))).toEqual(['tel:+966511211028', 'tel:+966563326309', 'tel:+966558829335']);
    expect(mailHref('Salesjeddah@wideruniversal.com')).toBe('mailto:Salesjeddah@wideruniversal.com');
    expect(mailHref('a@b.com', 'Enquiry — Jeddah')).toBe('mailto:a@b.com?subject=Enquiry%20%E2%80%94%20Jeddah');
  });
});

describe('validation', () => {
  const base = (): ContactDirectory => structuredClone(initial);

  it('accepts valid and rejects invalid phone numbers and emails', () => {
    expect(isValidPhone('+966 51 121 1028')).toBe(true);
    expect(isValidPhone('(013) 000-0000')).toBe(true);
    for (const bad of ['12345', 'call me', '+966 51 121 1028 ext', 'javascript:alert(1)', '+1234567890123456']) expect(isValidPhone(bad), bad).toBe(false);
    expect(isValidEmail('Saleskhobar@wideruniversal.com')).toBe(true);
    for (const bad of ['not-an-email', 'a@b', 'a b@c.com', 'x@y.com<script>']) expect(isValidEmail(bad), bad).toBe(false);
  });

  it('reports field-level errors', () => {
    const d = base();
    d.title = '';
    d.branches[0].name = '';
    d.branches[1].contacts[0].email = 'bad';
    d.branches[2].contacts[0].phone = '12';
    d.branches.push({ id: 'x', name: 'Empty', location: '', active: true, contacts: [] });
    d.branches[0].contacts.push({ id: 'n', name: '<b>x</b>', role: '', phone: '', email: '' });
    const e = validateDirectory(d);
    expect(Object.keys(e).sort()).toEqual(
      ['title', 'branches.0.name', 'branches.1.contacts.0.email', 'branches.2.contacts.0.phone', 'branches.3.contacts', 'branches.0.contacts.1.name', 'branches.0.contacts.1.phone'].sort(),
    );
  });

  it('allows a hidden branch without contacts', () => {
    const d = base();
    d.branches.push({ id: 'h', name: 'Future branch', location: '', active: false, contacts: [] });
    expect(validateDirectory(d)).toEqual({});
  });
});

describe('public display', () => {
  it('shows active branches in order, multiple contacts, and drops invalid details', () => {
    const d = structuredClone(initial);
    d.branches[1].contacts.push({ id: 'c2', name: 'Second', role: 'Sales', phone: '+966 50 000 0000', email: 'second@wideruniversal.com' });
    d.branches[2].active = false;
    d.branches[0].contacts[0].email = 'javascript:alert(1)';
    const p = publicBranches(d);
    expect(p.map((b) => b.name)).toEqual(['Jeddah Branch', 'Riyadh Branch']);
    expect(p[1].contacts.map((c) => c.name)).toEqual(['Savan Abdulla', 'Second']);
    expect(p[0].contacts[0].email).toBe('');
    expect(p[0].contacts[0].phone).toBe('+966 51 121 1028');
  });

  it('survives damaged stored data', () => {
    const d = normalizeDirectory({ title: 5, branches: [null, 'x', { name: 'B', contacts: [{ name: 'N', phone: '+966 50 000 0000' }, 7] }] });
    expect(d.title).toBe('Contact our sales team');
    expect(publicBranches(d).map((b) => b.contacts.length)).toEqual([1]);
  });
});

describe('header wordmark', () => {
  it('splits the company name into a primary line and a descriptor line', () => {
    expect(splitCompanyName('WIDER UNIVERSAL TRADING COMPANY')).toEqual(['WIDER UNIVERSAL', 'TRADING COMPANY']);
    expect(splitCompanyName('ACME')).toEqual(['ACME', '']);
  });
});
