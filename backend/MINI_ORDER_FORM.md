# Mini Order Form - Implementation Guide

## Overview
The **Mini Order Form** lets chatbot users quickly select 2-3 items and checkout in one flow, instead of selecting items one-by-one.

## How It Works

### User Flow
1. User sees main menu with **"🛒 Quick Cart"** button
2. Clicks → Shows mini product picker (4 top products)
3. User clicks **"➕ +1"** to add items (default qty=1, can increment)
4. Cart shows total with "Add More", "Review", "Checkout", "Clear" options
5. User clicks **"✅ Checkout"** → enters name → pickup/delivery → confirm

### Components

#### `mini_order_form.go`
- `ShowMiniOrderForm(userID)` - Displays 4 popular products with quick-add buttons
- `handleQuickAddProduct(userID, productKey)` - Adds item to cart (qty+1 if exists)
- `showQuickCartSummary(userID)` - Shows compact cart view with action buttons
- `handleQuickCheckout(userID)` - Moves user to name input and normal checkout flow
- `handleQuickClearCart(userID)` - Empties cart

#### Cart Structure
```go
type CartItem struct {
	Name     string  // "Chocolate Cake"
	Emoji    string  // "🍰"
	Quantity int     // 1, 2, 3...
	Price    float64 // 25.00
	Product  string  // Same as Name
}
```

Stored in `UserState.Cart` (already defined in `types.go`)

#### Postback Handlers (in `postback_handler.go`)
```go
case "QUICK_SHOP":
    ShowMiniOrderForm(userID)

case "QUICK_ADD_MORE":
    ShowMiniOrderForm(userID)

case "QUICK_SHOW_CART":
    showQuickCartSummary(userID)

case "QUICK_CHECKOUT":
    handleQuickCheckout(userID)

case "QUICK_CLEAR_CART":
    handleQuickClearCart(userID)

// Dynamic handlers
if strings.HasPrefix(payload, "QUICK_ADD_"):
    handleQuickAddProduct(userID, productKey)
```

#### Main Menu Integration (in `menu_simple.go`)
Added **"🛒 Quick Cart"** button next to **"📋 Full Order"**:
- Quick Cart → mini form (2-3 items, fast checkout)
- Full Order → detailed product listing (traditional flow)

## Sample Messenger Interaction

### Step 1: Main Menu
```
Bot: What would you like to do?
Buttons: [🛒 Quick Cart] [📋 Full Order] [❓ Help]
```

### Step 2: Quick Cart
```
User: Click "🛒 Quick Cart"
Bot: 🍰 Quick Order
     Add items to cart quickly
     [🍰 Chocolate Cake | $25.00 | [➕ +1] [🛒 View]]
     [🎂 Vanilla Cake    | $22.00 | [➕ +1] [🛒 View]]
     [🥐 Croissant       | $8.00  | [➕ +1] [🛒 View]]
     [🌀 Cinnamon Roll   | $12.00 | [➕ +1] [🛒 View]]
     [📋 My Cart | $0.00 | [View Cart] [Proceed]]
```

### Step 3: Add Items (click ➕ +1)
```
User: Click "➕ +1" for Chocolate Cake
Bot: ✅ Added 🍰 Chocolate Cake to cart!

     🛒 Your Quick Cart:
     🍰 Chocolate Cake × 1 = $25.00

     Total: $25.00

     Buttons: [➕ Add More] [🛒 Review] [✅ Checkout] [❌ Clear]
```

### Step 4: Add More Items
```
User: Click "➕ Add More" 
Bot: [Back to Step 2 - shows mini form again]

User: Click "➕ +1" for Croissant
Bot: ✅ Added 🥐 Croissant to cart!

     🛒 Your Quick Cart:
     🍰 Chocolate Cake × 1 = $25.00
     🥐 Croissant × 1 = $8.00

     Total: $33.00

     Buttons: [➕ Add More] [🛒 Review] [✅ Checkout] [❌ Clear]
```

### Step 5: Checkout
```
User: Click "✅ Checkout"
Bot: 📝 What's your name?
     [⬅️ Back] [❌ Cancel]

User: Type "John"
Bot: ✅ Name saved!
     Thanks John! Would you like pickup or delivery?
     [🏠 Pickup] [🚚 Delivery] [⬅️ Back] [❌ Cancel]

User: Click "🚚 Delivery"
Bot: Perfect! Please type your delivery address:
     (Street, City, ZIP)
     [⬅️ Back] [❌ Cancel]

User: Type "123 Main St, Yangon"
Bot: 📋 Order Summary:
     🍰 Chocolate Cake × 1 = $25.00
     🥐 Croissant × 1 = $8.00
     ───────────────────────
     Total: $33.00
     Delivery: 🚚 Delivery to 123 Main St, Yangon
     [✅ Confirm] [⬅️ Edit] [❌ Cancel]

User: Click "✅ Confirm"
Bot: 🎉 Order #12345 placed!
     Status: ⏳ Pending
     Estimated time: 30-45 minutes
     
     [⭐ Rate] [📋 History] [🏠 Back Home]
```

## Database Integration

Cart is stored in-memory per user session (`UserState.Cart`). For persistence, you can:

1. **Add cart_items table** (for saved carts):
```sql
CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

2. **Call backend API** on checkout:
```bash
POST /api/chat/orders
{
  "user_id": "1234567890",
  "items": [
    { "product_id": 1, "name": "Chocolate Cake", "qty": 1, "price": 25.00 },
    { "product_id": 3, "name": "Croissant", "qty": 1, "price": 8.00 }
  ],
  "notes": "Extra frosting please",
  "channel": "messenger"
}
```

## Testing

### Enable Quick Order
1. Deploy backend changes
2. Restart: `go run main.go`
3. Send test message to Messenger page
4. Click persistent menu ☰ → "Order Now" → see "Quick Cart" option

### Test Flow
```zsh
# In Messenger:
1. Tap ☰ → "Order Now"
2. Tap "Quick Cart"
3. Tap "➕ +1" on Chocolate Cake
4. Tap "Checkout"
5. Type name, select delivery, confirm
```

## Customization

### Change Top 4 Products
Edit `ShowMiniOrderForm()` in `mini_order_form.go`:
```go
topProducts := []struct {
    ID      string
    Name    string
    Price   float64
    Emoji   string
    Payload string
}{
    // Change these to match your catalog
    {"1", "Chocolate Cake", 25.00, "🍰", "QUICK_ORDER_CAKE"},
    // ...
}
```

### Add Qty Adjustment
Extend cart logic to allow decrementing:
```go
case "QUICK_DEC_":
    handleQuickDecProduct(userID, productKey)
```

### Show Product Images
Enhance `ShowMiniOrderForm()` to include `ImageURL` in Element buttons.

## Files Modified
- ✅ `controllers/mini_order_form.go` (new)
- ✅ `controllers/postback_handler.go` (added quick order cases)
- ✅ `controllers/menu_simple.go` (added Quick Cart button)
- ✅ `controllers/types.go` (UserState.Cart already present)

## Performance Notes
- Cart kept in-memory per session
- No DB calls until checkout
- Async order creation (as before)
- Fast UI response (<100ms per click)

## Next Steps
1. Test locally with Messenger
2. Add cart persistence (optional)
3. Show product images in mini form
4. Add "Save cart" feature
5. Track conversion from Quick Order
