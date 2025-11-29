# Dynamic product flow for the chatbot

Purpose
-------
Document the steps to replace the chatbot's hard-coded menus with dynamic product listings from the inventory (database). This describes which files to change, recommended function signatures, payload formats, and testing notes.

High-level steps
----------------
1. Add a model query to fetch products for the bot (active, non-deleted).
2. Add a product service in controllers to map `models.Product` to messenger elements.
3. Make `ui_helpers.getProductElements` call the product service instead of using hard-coded elements.
4. Update `postback_handler.go` and `message_handler.go` to use and parse dynamic payloads (`ORDER_<id>`, `PRODUCT_<id>`).
5. Ensure stock checks and transactional decrements when orders are confirmed.
6. Add unit tests for model/service and integration tests for the bot flow.

Files & responsibilities
------------------------
- `backend/models/product.go`
  - Add `GetActiveProducts(db *sql.DB, limit, offset int, filters ... ) ([]Product, error)`.
  - Ensure `GetProductByID` exists and returns full product details.

- `backend/controllers/product_service.go` (new)
  - Function: `FetchProductsForBot(db *sql.DB, limit, offset int, category, search string) ([]Element, error)`
  - Responsibilities: call model query, map to messenger `Element` structs (title, subtitle, image_url, buttons with payloads).

- `backend/controllers/ui_helpers.go`
  - Modify `getProductElements(userID string, page int, category string)` to call the product service and return elements.
  - Update `showProducts` and `showMainMenu` to use this dynamic generator.

- `backend/controllers/postback_handler.go`
  - Parse payload prefixes: `ORDER_<id>`, `PRODUCT_<id>`, `PRODUCTS_PAGE_<n>`, `REORDER_<orderID>`.
  - Extract numeric IDs and call existing handlers (quantity prompt, addToCart, showProductDetails).

- `backend/controllers/message_handler.go`
  - Replace hard-coded product name matches with calls to `GetActiveProducts` for fuzzy search, or prompt user to use buttons.

- `backend/controllers/order_service.go` or `backend/models` (for stock)
  - Add `ReserveStock(tx *sql.Tx, productID, qty int) error` that atomically decrements stock if available.
  - Use transactions for `CreateOrder` + stock decrement.

Payload design
--------------
- Use short, parseable payloads:
  - `PRODUCT_<id>` — show product details
  - `ORDER_<id>` — start ordering for product id
  - `ADD_<id>` — add to cart product id
  - `PRODUCTS_PAGE_<n>` — pagination
- Keep payload length small and only include IDs and prefixes.

UI & UX details
---------------
- Generic Template elements:
  - Title: product name
  - Subtitle: price + short description + stock status ("Only 2 left" / "Out of stock")
  - Image: `image_url` or fallback placeholder
  - Buttons: `Order` (payload `ORDER_<id>`), `View` (web_url if available)
- Pagination: limit results to 8–10 items; append a `See more` element with payload `PRODUCTS_PAGE_<next>`.
- Out-of-stock handling: hide/disable `Order` button or replace with `Notify me` quick reply.

Testing
-------
- Unit tests:
  - `GetActiveProducts` for filters/pagination.
  - `FetchProductsForBot` mapping (missing image, low stock, empty list).
- Integration tests:
  - Simulate postback `ORDER_<id>` and ensure the correct flow triggers and stock is reserved on confirmation.

Commands (local verification)
-----------------------------
Build backend module:
```bash
cd backend
go build ./...
```

Run unit tests (once you add them):
```bash
cd backend
go test ./... -run TestGetActiveProducts
```

Security & notes
----------------
- Avoid exposing long data in payloads. Pass only IDs.
- Ensure the bot uses the same transactional stock logic as other order flows to avoid oversells.
- Consider caching product lists briefly (30–60s) to reduce DB load during high traffic.

Next steps (implementation ideas)
--------------------------------
If you want, I can implement the model query and `product_service.go` next and run `go build` to validate. Alternatively I can start by changing `ui_helpers.go` to use a stubbed service and iterate from there.
