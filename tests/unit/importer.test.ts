import { describe, expect, it } from 'vitest';
import { parseSpecifications, planImport, productToRow } from '../../src/lib/importer';
import { product } from './fixtures';

const existing = [
  product({ id: 'a', sku: 'DH-IPC-HFW2441S-S', model: 'DH-IPC-HFW2441S-S', price: 250 }),
  product({ id: 'b', sku: 'AJAX-HUB2', model: 'Hub 2', brand: 'Ajax', price: 900, stockStatus: 'on_request' }),
];

describe('planImport', () => {
  it('matches existing products by normalized SKU and updates only provided cells', () => {
    const plan = planImport([{ sku: ' dh-ipc-hfw2441s-s ', price_sar: '275.5', name: '' }], existing);
    expect(plan.counts).toEqual({ create: 0, update: 1, skip: 0, error: 0 });
    const r = plan.rows[0];
    expect(r.id).toBe('a');
    expect(r.after!.price).toBe(275.5);
    expect(r.after!.name).toBe('4MP IR Bullet Camera'); // blank cell preserved
    expect(r.changedFields).toEqual(['price']);
  });

  it('skips rows that change nothing', () => {
    const plan = planImport([{ sku: 'AJAX-HUB2', price_sar: '900' }], existing);
    expect(plan.counts.skip).toBe(1);
  });

  it('creates new products and requires name and brand', () => {
    const plan = planImport(
      [
        { sku: 'NEW-1', name: 'New thing', brand: 'Imou', price_sar: '10', active: 'yes' },
        { sku: 'NEW-2', name: 'No brand' },
      ],
      existing,
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].after!.status).toBe('published');
    expect(plan.rows[0].after!.model).toBe('NEW-1');
    expect(plan.rows[0].id).toBe('p-new-1');
    expect(plan.rows[1].action).toBe('error');
    expect(plan.rows[1].errors.join()).toContain('brand is required');
  });

  it('rejects duplicate SKUs within the file', () => {
    const plan = planImport([{ sku: 'X-1', name: 'a', brand: 'b' }, { sku: 'x-1', name: 'a', brand: 'b' }], existing);
    expect(plan.rows[1].action).toBe('error');
    expect(plan.rows[1].errors[0]).toContain('duplicate SKU in file (first seen on row 2)');
  });

  it('rejects ambiguous matches against duplicate existing SKUs', () => {
    const dup = [...existing, product({ id: 'c', sku: 'AJAX-HUB2' })];
    const plan = planImport([{ sku: 'AJAX-HUB2', price_sar: '1' }], dup);
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].errors[0]).toContain('matches 2 existing products');
  });

  it('validates numbers, stock status, URLs and offers', () => {
    const plan = planImport(
      [
        { sku: 'DH-IPC-HFW2441S-S', price_sar: 'abc' },
        { sku: 'AJAX-HUB2', stock_status: 'maybe' },
        { sku: 'N1', name: 'n', brand: 'b', price_sar: '-5' },
        { sku: 'N2', name: 'n', brand: 'b', price_sar: '100', offer_price_sar: '120' },
        { sku: 'N3', name: 'n', brand: 'b', image_url: 'javascript:alert(1)' },
        { sku: 'N4', name: 'n', brand: 'b', stock_quantity: '2.5' },
        { sku: 'N5', name: 'n', brand: 'b', offer_price_sar: '10' },
      ],
      existing,
    );
    expect(plan.rows.map((r) => r.action)).toEqual(['error', 'error', 'error', 'error', 'error', 'error', 'error']);
    expect(plan.rows[3].errors[0]).toContain('must be lower than price_sar');
    expect(plan.rows[4].errors[0]).toContain('not a valid http(s) URL');
    expect(plan.rows[6].errors[0]).toContain('requires a price_sar');
  });

  it('accepts stock aliases, quantities, "SAR 1,250" prices and clears offers with 0', () => {
    const withOffer = [product({ id: 'a', sku: 'S1', price: 100, offerPrice: 90 })];
    const plan = planImport([{ sku: 'S1', stock_status: 'Out of stock', stock_quantity: '0', price_sar: 'SAR 1,250', offer_price_sar: '0' }], withOffer);
    const after = plan.rows[0].after!;
    expect(after.stockStatus).toBe('out_of_stock');
    expect(after.stockQty).toBe(0);
    expect(after.price).toBe(1250);
    expect(after.offerPrice).toBeNull();
  });

  it('reports unknown and missing columns and ignores blank lines', () => {
    const plan = planImport([{ SKU: 'S1', colour: 'red' }, { SKU: '', colour: '' }], existing);
    expect(plan.unknownColumns).toEqual(['colour']);
    expect(plan.rows).toHaveLength(1);
    const noSku = planImport([{ name: 'x' }], existing);
    expect(noSku.missingColumns).toEqual(['sku']);
    expect(noSku.rows[0].errors[0]).toBe('sku is required');
  });

  it('round-trips export rows back into an unchanged plan', () => {
    const rows = existing.map(productToRow);
    const plan = planImport(rows, existing);
    expect(plan.counts).toEqual({ create: 0, update: 0, skip: 2, error: 0 });
  });
});

describe('parseSpecifications', () => {
  it('parses label/value pairs separated by semicolons or new lines', () => {
    expect(parseSpecifications('Resolution: 4MP; IR range: 30 m\nIP67')).toEqual([
      { label: 'Resolution', value: '4MP', source: 'import' },
      { label: 'IR range', value: '30 m', source: 'import' },
      { label: '', value: 'IP67', source: 'import' },
    ]);
  });
});
