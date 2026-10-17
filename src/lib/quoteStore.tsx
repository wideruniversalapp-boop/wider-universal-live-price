import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Product } from '../types';
import { activeOffer } from './format';
import { addItem, parseStored, removeItem, setQty, type QuoteItem } from './quote';

const KEY = 'wu-quote-list-v1';

interface QuoteState {
  items: QuoteItem[];
  add: (p: Product, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

const Ctx = createContext<QuoteState | null>(null);

function load(): QuoteItem[] {
  try {
    return parseStored(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QuoteItem[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable (private mode): the list still works for this visit */
    }
  }, [items]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setItems(parseStored(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value: QuoteState = {
    items,
    add: (p, qty = 1) =>
      setItems((l) =>
        addItem(l, { id: p.id, model: p.model, sku: p.sku, name: p.name, brand: p.brand, unitPrice: activeOffer(p) ? p.offerPrice : p.price }, qty),
      ),
    setQty: (id, qty) => setItems((l) => setQty(l, id, qty)),
    remove: (id) => setItems((l) => removeItem(l, id)),
    clear: () => setItems([]),
    has: (id) => items.some((i) => i.id === id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuote(): QuoteState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuote outside QuoteProvider');
  return v;
}
