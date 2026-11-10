// Regression test: the product form must not keep stale values when
// the admin closes and reopens the "Tambah Produk" form without saving.
//
// admin.tsx toggle handler (production code) does:
//   setProductForm(productFormOnToggle(willOpen, orderedProducts));
//
// Contract:
// - Opening: sortOrder auto-fills to max existing + 10
// - Closing: every field resets to its initial value
// - Reopening starts pristine and recomputes sortOrder from the current list
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_STORE_PRODUCT_FORM,
  productFormOnToggle,
  syncOrderedProducts,
  nextFormSortOrderOnToggle,
} from "../client/src/lib/store-sort-order.js";

const products = (orders: number[]) =>
  syncOrderedProducts(orders.map((sortOrder, i) => ({ id: i + 1, sortOrder })));

test("opening the form auto-fills max+10", () => {
  assert.equal(nextFormSortOrderOnToggle(true, products([10, 20, 30])), "40");
});

test("closing the form resets sortOrder to '0'", () => {
  // Simulate: open (autofill 40), then close without saving
  let formSortOrder = nextFormSortOrderOnToggle(true, products([10, 20, 30]));
  assert.equal(formSortOrder, "40");
  formSortOrder = nextFormSortOrderOnToggle(false, products([10, 20, 30]));
  assert.equal(formSortOrder, "0", "close must reset stale value to '0'");
});

test("second open after a close recomputes fresh max+10 when a product was added in between", () => {
  let ordered = products([10, 20, 30]);
  // 1. Open → autofill 40
  let formSortOrder = nextFormSortOrderOnToggle(true, ordered);
  assert.equal(formSortOrder, "40");
  // 2. Close without saving → reset
  formSortOrder = nextFormSortOrderOnToggle(false, ordered);
  assert.equal(formSortOrder, "0");
  // 3. A product with sortOrder 40 is added elsewhere (e.g. another tab / direct API)
  ordered = products([10, 20, 30, 40]);
  // 4. Reopen → must recompute from CURRENT list, not reuse stale "40"
  formSortOrder = nextFormSortOrderOnToggle(true, ordered);
  assert.equal(formSortOrder, "50", "second open must give new max(40)+10=50");
});

test("open on empty list gives 10; close still resets to '0'", () => {
  assert.equal(nextFormSortOrderOnToggle(true, products([])), "10");
  assert.equal(nextFormSortOrderOnToggle(false, products([])), "0");
});

test("closing without saving and reopening produces a pristine product form", () => {
  let form = productFormOnToggle(true, products([10, 20, 30]));
  form = {
    ...form,
    name: "Produk setengah jadi",
    description: "Deskripsi lama",
    category: "Kategori Lama",
    price: "149000",
    agentId: "24",
    emoji: "📦",
    paymentUrl: "https://example.com/checkout",
  };

  form = productFormOnToggle(false, products([10, 20, 30]));
  assert.deepEqual(form, INITIAL_STORE_PRODUCT_FORM, "close must discard every unsaved field");

  form = productFormOnToggle(true, products([10, 20, 30]));
  assert.deepEqual(form, {
    ...INITIAL_STORE_PRODUCT_FORM,
    sortOrder: "40",
  }, "reopen must show defaults plus a freshly computed sort order");
});
