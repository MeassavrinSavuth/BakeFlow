package controllers

import (
"encoding/json"
"math"
"testing"
"bakeflow/models"
)

func TestCalculateBuy3Get1_Blueberry(t *testing.T) {
// Buy 3 get 1 same item for ID 3
rules := &models.PromotionRules{
BuyQty:        3,
GetQty:        1,
BuyProductIDs: []int{3},
GetProductIDs: []int{3},
DiscountType:  "FREE",
}

bogoRulesJSON, _ := json.Marshal(rules)

promos := []models.Promotion{
{ID: 6, Name: "buy 3 get 1", Type: "BUY_X_GET_Y", Rules: bogoRulesJSON, Priority: 1},
}

cartItems := []CheckoutCartItem{
{ClientLineID: "blueberry", ProductID: 3, Qty: 4, UnitPrice: 20000},
}

lineItems, discountTotal, _, _ := allocatePromotionsToLineItems(promos, cartItems)

t.Logf("Discount Total: %v", discountTotal)
if math.Abs(discountTotal-20000) > 1e-9 {
t.Fatalf("expected discount=20000, got=%v", discountTotal)
}
if lineItems[0].FreeQty != 1 {
t.Fatalf("expected free qty=1, got=%d", lineItems[0].FreeQty)
}
}
