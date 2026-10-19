const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllRows(fetchPage, pageSize = DEFAULT_PAGE_SIZE) {
  if (typeof fetchPage !== "function" || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError("A page loader and a positive integer page size are required.");
  }

  const rows = [];
  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    let result;
    try {
      result = await fetchPage(from, from + pageSize - 1);
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error("The paginated query failed."),
      };
    }
    if (!result || typeof result !== "object") {
      return { data: null, error: new TypeError("The paginated query returned an invalid result.") };
    }
    const { data, error } = result;
    if (error) return { data: null, error };
    if (!Array.isArray(data)) {
      return { data: null, error: new TypeError("The paginated query returned an invalid page.") };
    }
    rows.push(...data);
    if (data.length < pageSize) return { data: rows, error: null };
  }
}
