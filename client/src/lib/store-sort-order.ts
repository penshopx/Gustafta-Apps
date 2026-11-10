/**
 * Helpers for store product sort-order state management.
 *
 * Extracted from admin.tsx so they can be imported by tests — keeping the
 * test coupled to production logic so any regression (e.g. reintroducing the
 * `if (storeProducts.length > 0)` guard) is caught immediately.
 */

export interface SortableProduct {
  id: number;
  sortOrder: number;
}

export interface StoreProductForm {
  name: string;
  description: string;
  category: string;
  price: string;
  priceOverride: string;
  agentId: string;
  emoji: string;
  paymentUrl: string;
  sortOrder: string;
}

export const INITIAL_STORE_PRODUCT_FORM: StoreProductForm = {
  name: "",
  description: "",
  category: "Konstruksi",
  price: "",
  priceOverride: "",
  agentId: "",
  emoji: "🤖",
  paymentUrl: "",
  sortOrder: "0",
};

/**
 * Sort a fresh server snapshot into display order.
 *
 * Called inside useEffect whenever `storeProducts` changes.  The old version
 * had a `if (storeProducts.length > 0)` guard that prevented clearing
 * `orderedProducts` when the last product was deleted, causing stale state.
 * This version always syncs — including the empty case.
 */
export function syncOrderedProducts<T extends SortableProduct>(serverProducts: T[]): T[] {
  return [...serverProducts].sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
}

/**
 * Compute the next sort-order value for a new product.
 *
 * Returns max(existing sortOrders) + 10, or 10 when the list is empty.
 */
export function computeNextSortOrder(products: SortableProduct[]): number {
  const maxOrder = products.length > 0
    ? Math.max(...products.map((p) => p.sortOrder ?? 0))
    : 0;
  return maxOrder + 10;
}

/**
 * Compute the next `productForm.sortOrder` value when the "Tambah Produk"
 * form is toggled.
 *
 * - Opening (`willOpen === true`): auto-fill with max existing sortOrder + 10.
 * - Closing (`willOpen === false`): reset to "0" so a stale auto-filled value
 *   never survives a close-without-save. The next open always recomputes from
 *   the then-current product list.
 */
export function nextFormSortOrderOnToggle(
  willOpen: boolean,
  products: SortableProduct[],
): string {
  return willOpen ? String(computeNextSortOrder(products)) : "0";
}

/**
 * Return a clean "Tambah Produk" form whenever it is toggled.
 *
 * Opening starts from the defaults and adds the current next sort order.
 * Closing returns the defaults exactly, discarding every unsaved field.
 */
export function productFormOnToggle(
  willOpen: boolean,
  products: SortableProduct[],
): StoreProductForm {
  return {
    ...INITIAL_STORE_PRODUCT_FORM,
    sortOrder: nextFormSortOrderOnToggle(willOpen, products),
  };
}
