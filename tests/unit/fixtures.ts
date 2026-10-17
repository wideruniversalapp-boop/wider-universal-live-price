import type { Product } from '../../src/types';

export const ts = (iso: string) => {
  const d = new Date(iso);
  return { toDate: () => d, toMillis: () => d.getTime() } as unknown as NonNullable<Product['offerStart']>;
};

export function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', sku: 'DH-IPC-HFW2441S-S', model: 'DH-IPC-HFW2441S-S', name: '4MP IR Bullet Camera', brand: 'Dahua',
    category: 'IP Cameras', subcategory: '', description: '', features: [], specs: [], imageUrl: null, imagePath: null,
    datasheetUrl: '', sourceUrl: '', price: 250, offerPrice: null, offerStart: null, offerEnd: null, offerText: '', previousPrice: null, priceChangedAt: null,
    stockStatus: 'in_stock', stockQty: null, status: 'published', searchText: '', sortOrder: 0,
    ...over,
  };
}
