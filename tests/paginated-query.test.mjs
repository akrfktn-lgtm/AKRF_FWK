import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows } from "../src/lib/paginated-query.mjs";

test("fetchAllRows collects every page and stops at a short page", async () => {
  const source = [1, 2, 3, 4, 5];
  const pages = [];
  const result = await fetchAllRows(async (from, to) => {
    pages.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  }, 2);

  assert.deepEqual(result, { data: source, error: null });
  assert.deepEqual(pages, [[0, 1], [2, 3], [4, 5]]);
});

test("fetchAllRows returns query errors without hiding them", async () => {
  const failure = new Error("database unavailable");
  const result = await fetchAllRows(async () => ({ data: null, error: failure }), 10);
  assert.equal(result.data, null);
  assert.equal(result.error, failure);
});

test("fetchAllRows rejects invalid page parameters and results", async () => {
  await assert.rejects(fetchAllRows(async () => ({ data: [], error: null }), 0), TypeError);
  const result = await fetchAllRows(async () => ({ data: null, error: null }), 2);
  assert.equal(result.data, null);
  assert.match(result.error.message, /invalid page/i);
});
