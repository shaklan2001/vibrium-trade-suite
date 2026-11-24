/**
 * Product history index for the server: every priced PO / PI / invoice line in the book
 * (src/lib/trade/productHistory.ts), built from the Copilot's cached book and kept in memory for
 * an hour. Used by GET /api/products/search and by Copilot answers about prices and vendors.
 * Server only.
 */
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { buildProductIndex, searchProducts, vendorRecords, type ProductLine, type ProductSearch } from "./productHistory";

const TTL_MS = 60 * 60 * 1000;

type Built = { builtAt: number; index: ProductLine[]; vendors: ReturnType<typeof vendorRecords> };
let cache: Built | null = null;

export async function getProductIndex(): Promise<Built> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache;
  const book = await getCopilotBook();
  cache = { builtAt: Date.now(), index: buildProductIndex(book.deals), vendors: vendorRecords(book.deals) };
  return cache;
}

export async function searchProductHistory(query: string, limit = 12): Promise<ProductSearch> {
  const built = await getProductIndex();
  return searchProducts(built.index, query, { limit, vendorRecord: built.vendors });
}
