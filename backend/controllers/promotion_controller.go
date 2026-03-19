package controllers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"bakeflow/configs"
	"bakeflow/models"

	"github.com/gorilla/mux"
)

// CartItem represents an item in the checkout cart
type CheckoutCartItem struct {
	ClientLineID string  `json:"clientLineId,omitempty"`
	ProductID    int     `json:"productId"`
	Qty          int     `json:"qty"`
	UnitPrice    float64 `json:"unitPrice"`
}

// CheckoutRequest represents the checkout request
type CheckoutRequest struct {
	CartItems    []CheckoutCartItem `json:"cartItems"`
	DeliveryType string             `json:"delivery_type"`
	Address      string             `json:"address"`
}

// CheckoutResponse represents the checkout response with applied promotion
type CheckoutResponse struct {
	Subtotal          float64             `json:"subtotal"`
	Discount          float64             `json:"discount"`
	DiscountTotal     float64             `json:"discountTotal,omitempty"`
	AppliedPromotion  *AppliedPromotion   `json:"appliedPromotion,omitempty"`
	AppliedPromotions []*AppliedPromotion `json:"appliedPromotions,omitempty"`
	LineItems         []CheckoutLineItem  `json:"lineItems,omitempty"`
	DeliveryFee       float64             `json:"delivery_fee"`
	Total             float64             `json:"total"`
}

type CheckoutLineItem struct {
	ClientLineID      string                 `json:"clientLineId,omitempty"`
	ProductID         int                    `json:"productId"`
	Qty               int                    `json:"qty"`
	UnitPrice         float64                `json:"unitPrice"`
	PaidQty           int                    `json:"paidQty"`
	FreeQty           int                    `json:"freeQty"`
	Discounts         []CheckoutLineDiscount `json:"discounts,omitempty"`
	LineSubtotal      float64                `json:"lineSubtotal"`
	LineDiscountTotal float64                `json:"lineDiscountTotal"`
	LineTotal         float64                `json:"lineTotal"`
}

type CheckoutLineDiscount struct {
	Type          string  `json:"type"`
	PromoID       int     `json:"promoId"`
	PromotionName string  `json:"promotionName,omitempty"`
	DiscountType  string  `json:"discountType,omitempty"`
	Qty           int     `json:"qty,omitempty"`
	Amount        float64 `json:"amount"`

	Percent         float64 `json:"percent,omitempty"`
	DiscountPercent float64 `json:"discountPercent,omitempty"`
	FixedPrice      float64 `json:"fixedPrice,omitempty"`
}

type AppliedPromotion struct {
	ID                   int     `json:"id"`
	Name                 string  `json:"name"`
	Type                 string  `json:"type"`
	Percent              float64 `json:"percent,omitempty"`
	AppliesToAllProducts bool    `json:"appliesToAllProducts"`
	SelectedProductIds   []int   `json:"selectedProductIds,omitempty"`
	Description          string  `json:"description,omitempty"`
	Discount             float64 `json:"discount,omitempty"`

	BuyQty            int     `json:"buyQty,omitempty"`
	GetQty            int     `json:"getQty,omitempty"`
	BuyProductIDs     []int   `json:"buyProductIds,omitempty"`
	GetProductIDs     []int   `json:"getProductIds,omitempty"`
	EligibleProductID int     `json:"eligibleProductId,omitempty"`
	DiscountType      string  `json:"discountType,omitempty"`
	DiscountPercent   float64 `json:"discountPercent,omitempty"`
	FixedPrice        float64 `json:"fixedPrice,omitempty"`
}

type ActivePromotionDTO struct {
	ID                   int             `json:"id"`
	Name                 string          `json:"name"`
	Type                 string          `json:"type"`
	Rules                json.RawMessage `json:"rules"`
	Active               bool            `json:"active"`
	StartAt              time.Time       `json:"start_at"`
	EndAt                time.Time       `json:"end_at"`
	Priority             int             `json:"priority"`
	BannerTitle          string          `json:"bannerTitle,omitempty"`
	AppliesToAllProducts bool            `json:"appliesToAllProducts"`
	SelectedProductIds   []int           `json:"selectedProductIds,omitempty"`
	SelectedProductNames []string        `json:"selectedProductNames,omitempty"`
	Percent              float64         `json:"percent,omitempty"`
	BuyQty               int             `json:"buyQty,omitempty"`
	GetQty               int             `json:"getQty,omitempty"`
	BuyProductIDs        []int           `json:"buyProductIds,omitempty"`
	GetProductIDs        []int           `json:"getProductIds,omitempty"`
	EligibleProductID    int             `json:"eligibleProductId,omitempty"`
	DiscountType         string          `json:"discountType,omitempty"`
	DiscountPercent      float64         `json:"discountPercent,omitempty"`
	FixedPrice           float64         `json:"fixedPrice,omitempty"`
}

// GetActivePromotions returns active promotions for frontend display
// GET /promotions/active
func GetActivePromotions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	promotions, err := models.GetActivePromotions()
	if err != nil {
		log.Printf("Error fetching active promotions: %v", err)
		http.Error(w, `{"error": "Failed to fetch promotions"}`, http.StatusInternalServerError)
		return
	}

	if promotions == nil {
		promotions = []models.Promotion{}
	}

	var activePromotion *ActivePromotionDTO
	var bannerTitle string
	dtos := make([]*ActivePromotionDTO, 0, len(promotions))

	if len(promotions) > 0 {
		titles := make([]string, 0, len(promotions))
		for _, p := range promotions {
			dto, err := buildActivePromotionDTO(p)
			if err != nil {
				log.Printf("Error building active promotion payload: %v", err)
				continue
			}
			dtos = append(dtos, dto)
			if dto.BannerTitle != "" {
				titles = append(titles, dto.BannerTitle)
			}
		}
		if len(dtos) > 0 {
			activePromotion = dtos[0]
		}
		if len(titles) > 0 {
			bannerTitle = strings.Join(titles, " · ")
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"promotion":   activePromotion,
		"bannerTitle": bannerTitle,
		"promotions":  dtos,
	})
}

// CalculateCheckout applies promotions and calculates final total
// POST /checkout
func CalculateCheckout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req CheckoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.CartItems) == 0 {
		http.Error(w, `{"error": "Cart is empty"}`, http.StatusBadRequest)
		return
	}

	// Calculate subtotal
	subtotal := 0.0
	for _, item := range req.CartItems {
		subtotal += float64(item.Qty) * item.UnitPrice
	}

	// Get active promotions
	activePromotions, err := models.GetActivePromotions()
	if err != nil {
		log.Printf("Error fetching promotions: %v", err)
		// Continue without promotions if error
		activePromotions = []models.Promotion{}
	}

	lineItems, discountTotal, appliedPromo, appliedPromos := allocatePromotionsToLineItems(activePromotions, req.CartItems)
	baseTotal := subtotal - discountTotal
	if baseTotal < 0 {
		baseTotal = 0
	}

	deliveryFee := 0.0
	if fee, ok := calculateDeliveryFeeStrict(req.DeliveryType, req.Address); ok {
		deliveryFee = fee
	}

	total := baseTotal + deliveryFee

	for i := range lineItems {
		lineItems[i].LineSubtotal = float64(lineItems[i].Qty) * lineItems[i].UnitPrice
		lineItems[i].LineDiscountTotal = 0
		for _, d := range lineItems[i].Discounts {
			lineItems[i].LineDiscountTotal += d.Amount
		}
		lineItems[i].LineTotal = lineItems[i].LineSubtotal - lineItems[i].LineDiscountTotal
		if lineItems[i].LineTotal < 0 {
			lineItems[i].LineTotal = 0
		}
	}

	response := CheckoutResponse{
		Subtotal:          subtotal,
		Discount:          discountTotal,
		DiscountTotal:     discountTotal,
		AppliedPromotion:  appliedPromo,
		AppliedPromotions: appliedPromos,
		LineItems:         lineItems,
		DeliveryFee:       deliveryFee,
		Total:             total,
	}

	json.NewEncoder(w).Encode(response)
}

func allocatePromotionsToLineItems(activePromotions []models.Promotion, cartItems []CheckoutCartItem) ([]CheckoutLineItem, float64, *AppliedPromotion, []*AppliedPromotion) {
	lineItems := make([]CheckoutLineItem, 0, len(cartItems))
	remaining := make([]int, 0, len(cartItems))
	productToLineIdx := map[int][]int{}

	for i, ci := range cartItems {
		qty := ci.Qty
		if qty < 0 {
			qty = 0
		}
		lineItems = append(lineItems, CheckoutLineItem{
			ClientLineID: ci.ClientLineID,
			ProductID:    ci.ProductID,
			Qty:          qty,
			UnitPrice:    ci.UnitPrice,
			PaidQty:      qty,
			FreeQty:      0,
			Discounts:    []CheckoutLineDiscount{},
		})
		remaining = append(remaining, qty)
		productToLineIdx[ci.ProductID] = append(productToLineIdx[ci.ProductID], i)
	}

	if len(activePromotions) == 0 || len(lineItems) == 0 {
		return lineItems, 0, nil, []*AppliedPromotion{}
	}

	promos := append([]models.Promotion(nil), activePromotions...)
	sort.SliceStable(promos, func(i, j int) bool {
		return promos[i].Priority > promos[j].Priority
	})

	type stagedPromo struct {
		promo models.Promotion
		rules *models.PromotionRules
	}

	freeStage := make([]stagedPromo, 0, len(promos))
	priceStage := make([]stagedPromo, 0, len(promos))

	for _, p := range promos {
		r, err := p.ParseRules()
		if err != nil || r == nil {
			continue
		}
		if p.Type == "BUY_X_GET_Y" {
			discountType := strings.ToUpper(strings.TrimSpace(r.DiscountType))
			if discountType == "" {
				discountType = "FREE"
			}
			if discountType == "FREE" {
				freeStage = append(freeStage, stagedPromo{promo: p, rules: r})
			} else {
				priceStage = append(priceStage, stagedPromo{promo: p, rules: r})
			}
			continue
		}
		if p.Type == "PERCENT_OFF" {
			priceStage = append(priceStage, stagedPromo{promo: p, rules: r})
		}
	}

	appliedPromos := make([]*AppliedPromotion, 0, 4)
	var primaryApplied *AppliedPromotion
	totalDiscount := 0.0

	applyDiscountToLine := func(lineIdx int, promo models.Promotion, discountType string, qty int, amount float64, percent float64, discountPercent float64, fixedPrice float64) {
		if lineIdx < 0 || lineIdx >= len(lineItems) {
			return
		}
		if qty <= 0 || amount <= 0 {
			return
		}
		lineItems[lineIdx].Discounts = append(lineItems[lineIdx].Discounts, CheckoutLineDiscount{
			Type:            promo.Type,
			PromoID:         promo.ID,
			PromotionName:   promo.Name,
			DiscountType:    discountType,
			Qty:             qty,
			Amount:          amount,
			Percent:         percent,
			DiscountPercent: discountPercent,
			FixedPrice:      fixedPrice,
		})
	}

	buildApplied := func(promo models.Promotion, rules *models.PromotionRules, description string, discount float64) *AppliedPromotion {
		discountType := strings.ToUpper(strings.TrimSpace(rules.DiscountType))
		if discountType == "" && promo.Type == "BUY_X_GET_Y" {
			discountType = "FREE"
		}

		buyIDs := append([]int(nil), rules.BuyProductIDs...)
		getIDs := append([]int(nil), rules.GetProductIDs...)
		if promo.Type == "BUY_X_GET_Y" && len(buyIDs) == 0 && len(getIDs) == 0 {
			buyIDs = append([]int(nil), rules.ProductIDs...)
			getIDs = append([]int(nil), rules.ProductIDs...)
		}

		selectedIDs := append([]int(nil), rules.ProductIDs...)
		if promo.Type == "BUY_X_GET_Y" && (len(buyIDs) > 0 || len(getIDs) > 0) {
			seen := map[int]struct{}{}
			selectedIDs = make([]int, 0, len(buyIDs)+len(getIDs))
			for _, id := range buyIDs {
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				selectedIDs = append(selectedIDs, id)
			}
			for _, id := range getIDs {
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				selectedIDs = append(selectedIDs, id)
			}
		}

		eligibleProductID := 0
		if promo.Type == "BUY_X_GET_Y" && len(buyIDs) > 0 && len(getIDs) > 0 {
			buySet := map[int]struct{}{}
			for _, id := range buyIDs {
				buySet[id] = struct{}{}
			}
			uniq := map[int]struct{}{}
			overlap := make([]int, 0, len(getIDs))
			for _, id := range getIDs {
				if _, ok := buySet[id]; !ok {
					continue
				}
				if _, seen := uniq[id]; seen {
					continue
				}
				uniq[id] = struct{}{}
				overlap = append(overlap, id)
			}
			if len(overlap) == 1 {
				eligibleProductID = overlap[0]
			}
		}

		return &AppliedPromotion{
			ID:                   promo.ID,
			Name:                 promo.Name,
			Type:                 promo.Type,
			Percent:              rules.Percent,
			AppliesToAllProducts: len(selectedIDs) == 0,
			SelectedProductIds:   selectedIDs,
			Description:          description,
			Discount:             discount,
			BuyQty:               rules.BuyQty,
			GetQty:               rules.GetQty,
			BuyProductIDs:        buyIDs,
			GetProductIDs:        getIDs,
			EligibleProductID:    eligibleProductID,
			DiscountType:         discountType,
			DiscountPercent:      rules.DiscountPercent,
			FixedPrice:           rules.FixedPrice,
		}
	}

	getLineSavingsPerUnit := func(idx int, discountType string, discountPercent float64, fixedPrice float64) float64 {
		if idx < 0 || idx >= len(lineItems) {
			return 0
		}
		unitPrice := lineItems[idx].UnitPrice
		switch discountType {
		case "PERCENT_OFF":
			if discountPercent <= 0 || discountPercent > 100 {
				return 0
			}
			return unitPrice * (discountPercent / 100.0)
		case "FIXED_PRICE":
			s := unitPrice - fixedPrice
			if s <= 0 {
				return 0
			}
			return s
		default:
			return unitPrice
		}
	}

	sumPaidQtyForProductIDs := func(productIDs []int) int {
		if len(productIDs) == 0 {
			return 0
		}
		set := map[int]struct{}{}
		for _, id := range productIDs {
			set[id] = struct{}{}
		}
		total := 0
		for _, li := range lineItems {
			if _, ok := set[li.ProductID]; !ok {
				continue
			}
			if li.PaidQty > 0 {
				total += li.PaidQty
			}
		}
		return total
	}

	sumRemainingForProductIDs := func(productIDs []int) int {
		if len(productIDs) == 0 {
			return 0
		}
		set := map[int]struct{}{}
		for _, id := range productIDs {
			set[id] = struct{}{}
		}
		total := 0
		for idx, li := range lineItems {
			if _, ok := set[li.ProductID]; !ok {
				continue
			}
			if remaining[idx] > 0 {
				total += remaining[idx]
			}
		}
		return total
	}

	allocateUnits := func(lineIdxs []int, units int, discountType string, promo models.Promotion, discountPercent float64, fixedPrice float64) float64 {
		if units <= 0 || len(lineIdxs) == 0 {
			return 0
		}

		sort.SliceStable(lineIdxs, func(i, j int) bool {
			a := lineIdxs[i]
			b := lineIdxs[j]
			if discountType == "FREE" || discountType == "" {
				return lineItems[a].UnitPrice > lineItems[b].UnitPrice
			}
			return getLineSavingsPerUnit(a, discountType, discountPercent, fixedPrice) > getLineSavingsPerUnit(b, discountType, discountPercent, fixedPrice)
		})

		remainingUnits := units
		discount := 0.0
		for _, idx := range lineIdxs {
			if remainingUnits <= 0 {
				break
			}
			canUse := remaining[idx]
			if canUse <= 0 {
				continue
			}
			use := canUse
			if use > remainingUnits {
				use = remainingUnits
			}
			if use <= 0 {
				continue
			}
			savingsPerUnit := getLineSavingsPerUnit(idx, discountType, discountPercent, fixedPrice)
			if savingsPerUnit <= 0 {
				continue
			}
			amount := savingsPerUnit * float64(use)
			applyDiscountToLine(idx, promo, discountType, use, amount, 0, discountPercent, fixedPrice)
			remaining[idx] -= use
			if discountType == "FREE" {
				lineItems[idx].FreeQty += use
				lineItems[idx].PaidQty -= use
				if lineItems[idx].PaidQty < 0 {
					lineItems[idx].PaidQty = 0
				}
			}
			discount += amount
			remainingUnits -= use
		}
		return discount
	}

	applyBuyXGetYSameItem := func(promo models.Promotion, rules *models.PromotionRules) float64 {
		if rules.BuyQty <= 0 || rules.GetQty <= 0 {
			return 0
		}
		groupSize := rules.BuyQty + rules.GetQty
		if groupSize <= 0 {
			return 0
		}

		// In SameItem mode, we handle the case where Buy and Get sets overlap.
		// We pool all items in (BuyProductIDs Union GetProductIDs) for the quantity calculation,
		// but we can only apply the discount to items in GetProductIDs.

		buyIDs := append([]int(nil), rules.BuyProductIDs...)
		getIDs := append([]int(nil), rules.GetProductIDs...)
		if len(buyIDs) == 0 && len(getIDs) == 0 {
			buyIDs = append([]int(nil), rules.ProductIDs...)
			getIDs = append([]int(nil), rules.ProductIDs...)
		}

		unionSet := map[int]struct{}{}
		for _, id := range buyIDs {
			unionSet[id] = struct{}{}
		}
		for _, id := range getIDs {
			unionSet[id] = struct{}{}
		}

		totalPoolQty := 0
		for pid := range unionSet {
			idxs := productToLineIdx[pid]
			for _, idx := range idxs {
				totalPoolQty += remaining[idx]
			}
		}

		// Number of free items allowed in total from this pool
		freeQtyTotal := (totalPoolQty / groupSize) * rules.GetQty
		if freeQtyTotal <= 0 {
			return 0
		}

		// We can ONLY apply the discount to items that are in the GetProductIDs list
		getLineIdxs := []int{}
		getSet := map[int]struct{}{}
		for _, id := range getIDs {
			getSet[id] = struct{}{}
			idxs := productToLineIdx[id]
			getLineIdxs = append(getLineIdxs, idxs...)
		}

		return allocateUnits(getLineIdxs, freeQtyTotal, "FREE", promo, 0, 0)
	}

	applyBuyXGetYDifferent := func(promo models.Promotion, rules *models.PromotionRules, discountType string) float64 {
		if rules.BuyQty <= 0 || rules.GetQty <= 0 {
			return 0
		}
		buyIDs := append([]int(nil), rules.BuyProductIDs...)
		getIDs := append([]int(nil), rules.GetProductIDs...)
		if len(buyIDs) == 0 && len(getIDs) == 0 {
			return 0
		}

		buySet := map[int]struct{}{}
		for _, id := range buyIDs {
			buySet[id] = struct{}{}
		}
		uniqGet := make([]int, 0, len(getIDs))
		seen := map[int]struct{}{}
		for _, id := range getIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			if _, overlaps := buySet[id]; overlaps {
				continue
			}
			uniqGet = append(uniqGet, id)
		}
		getIDs = uniqGet
		if len(getIDs) == 0 {
			return 0
		}

		buyPaid := sumPaidQtyForProductIDs(buyIDs)
		if buyPaid < rules.BuyQty {
			return 0
		}
		sets := buyPaid / rules.BuyQty
		maxDiscountQty := sets * rules.GetQty
		if maxDiscountQty <= 0 {
			return 0
		}

		availableGetUnits := sumRemainingForProductIDs(getIDs)
		if availableGetUnits <= 0 {
			return 0
		}
		discountQty := availableGetUnits
		if discountQty > maxDiscountQty {
			discountQty = maxDiscountQty
		}
		if discountQty <= 0 {
			return 0
		}

		lineIdxs := make([]int, 0, discountQty)
		for _, pid := range getIDs {
			lineIdxs = append(lineIdxs, productToLineIdx[pid]...)
		}
		if len(lineIdxs) == 0 {
			return 0
		}

		discountPercent := rules.DiscountPercent
		fixedPrice := rules.FixedPrice
		return allocateUnits(lineIdxs, discountQty, discountType, promo, discountPercent, fixedPrice)
	}

	applyPercentOff := func(promo models.Promotion, rules *models.PromotionRules) float64 {
		percent := rules.Percent
		if percent <= 0 || percent > 100 {
			return 0
		}

		eligibleAll := len(rules.ProductIDs) == 0
		eligibleSet := map[int]struct{}{}
		if !eligibleAll {
			for _, id := range rules.ProductIDs {
				eligibleSet[id] = struct{}{}
			}
		}

		discount := 0.0
		for idx, li := range lineItems {
			if remaining[idx] <= 0 || li.UnitPrice <= 0 {
				continue
			}
			if !eligibleAll {
				if _, ok := eligibleSet[li.ProductID]; !ok {
					continue
				}
			}
			use := remaining[idx]
			amount := float64(use) * li.UnitPrice * (percent / 100.0)
			if amount <= 0 {
				continue
			}
			applyDiscountToLine(idx, promo, "PERCENT_OFF", use, amount, percent, 0, 0)
			remaining[idx] = 0
			discount += amount
		}
		return discount
	}

	processPromo := func(p models.Promotion, rules *models.PromotionRules, discount float64, description string) {
		if discount <= 0 {
			return
		}
		totalDiscount += discount
		ap := buildApplied(p, rules, description, discount)
		appliedPromos = append(appliedPromos, ap)
	}

	for _, sp := range freeStage {
		discountType := strings.ToUpper(strings.TrimSpace(sp.rules.DiscountType))
		if discountType == "" {
			discountType = "FREE"
		}

		isLegacy := len(sp.rules.BuyProductIDs) == 0 && len(sp.rules.GetProductIDs) == 0
		if isLegacy {
			d := applyBuyXGetYSameItem(sp.promo, sp.rules)
			processPromo(sp.promo, sp.rules, d, formatBuyXGetYDescription(sp.rules.BuyQty, sp.rules.GetQty, "FREE", 0, 0))
			continue
		}

		buySet := map[int]struct{}{}
		for _, id := range sp.rules.BuyProductIDs {
			buySet[id] = struct{}{}
		}
		getSetRaw := map[int]struct{}{}
		for _, id := range sp.rules.GetProductIDs {
			getSetRaw[id] = struct{}{}
		}
		overlap := make([]int, 0, len(getSetRaw))
		for id := range getSetRaw {
			if _, ok := buySet[id]; ok {
				overlap = append(overlap, id)
			}
		}
		isSameItem := len(overlap) > 0 && len(overlap) == len(getSetRaw)
		if isSameItem {
			d := applyBuyXGetYSameItem(sp.promo, sp.rules)
			processPromo(sp.promo, sp.rules, d, formatBuyXGetYDescription(sp.rules.BuyQty, sp.rules.GetQty, "FREE", 0, 0))
			continue
		}

		d := applyBuyXGetYDifferent(sp.promo, sp.rules, "FREE")
		processPromo(sp.promo, sp.rules, d, formatBuyXGetYDescription(sp.rules.BuyQty, sp.rules.GetQty, "FREE", 0, 0))
	}

	for _, sp := range priceStage {
		if sp.promo.Type == "PERCENT_OFF" {
			d := applyPercentOff(sp.promo, sp.rules)
			scope := "selected products"
			if len(sp.rules.ProductIDs) == 0 {
				scope = "all products"
			}
			processPromo(sp.promo, sp.rules, d, formatPercentOffDescription(sp.rules.Percent, scope))
			continue
		}
		if sp.promo.Type == "BUY_X_GET_Y" {
			discountType := strings.ToUpper(strings.TrimSpace(sp.rules.DiscountType))
			if discountType == "" {
				discountType = "FREE"
			}
			if discountType == "FREE" {
				continue
			}
			d := applyBuyXGetYDifferent(sp.promo, sp.rules, discountType)
			processPromo(sp.promo, sp.rules, d, formatBuyXGetYDescription(sp.rules.BuyQty, sp.rules.GetQty, discountType, sp.rules.DiscountPercent, sp.rules.FixedPrice))
		}
	}

	if len(appliedPromos) > 0 {
		sort.SliceStable(appliedPromos, func(i, j int) bool {
			return appliedPromos[i].Discount > appliedPromos[j].Discount
		})
		primaryApplied = appliedPromos[0]
	}

	return lineItems, totalDiscount, primaryApplied, appliedPromos
}

func selectBestPromotions(activePromotions []models.Promotion, cartItems []CheckoutCartItem, subtotal float64) (float64, *AppliedPromotion, []*AppliedPromotion) {
	discount := 0.0
	var appliedPromo *AppliedPromotion
	appliedPromos := make([]*AppliedPromotion, 0, 2)

	if len(activePromotions) == 0 {
		return discount, appliedPromo, appliedPromos
	}

	buildApplied := func(promo models.Promotion, rules *models.PromotionRules, description string) *AppliedPromotion {
		discountType := strings.ToUpper(strings.TrimSpace(rules.DiscountType))
		if discountType == "" && promo.Type == "BUY_X_GET_Y" {
			discountType = "FREE"
		}

		buyIDs := append([]int(nil), rules.BuyProductIDs...)
		getIDs := append([]int(nil), rules.GetProductIDs...)
		if promo.Type == "BUY_X_GET_Y" && len(buyIDs) == 0 && len(getIDs) == 0 {
			buyIDs = append([]int(nil), rules.ProductIDs...)
			getIDs = append([]int(nil), rules.ProductIDs...)
		}

		selectedIDs := append([]int(nil), rules.ProductIDs...)
		if promo.Type == "BUY_X_GET_Y" && (len(buyIDs) > 0 || len(getIDs) > 0) {
			seen := map[int]struct{}{}
			selectedIDs = make([]int, 0, len(buyIDs)+len(getIDs))
			for _, id := range buyIDs {
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				selectedIDs = append(selectedIDs, id)
			}
			for _, id := range getIDs {
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				selectedIDs = append(selectedIDs, id)
			}
		}

		eligibleProductID := 0
		if promo.Type == "BUY_X_GET_Y" && len(buyIDs) > 0 && len(getIDs) > 0 {
			buySet := map[int]struct{}{}
			for _, id := range buyIDs {
				buySet[id] = struct{}{}
			}
			uniq := map[int]struct{}{}
			overlap := make([]int, 0, len(getIDs))
			for _, id := range getIDs {
				if _, ok := buySet[id]; !ok {
					continue
				}
				if _, seen := uniq[id]; seen {
					continue
				}
				uniq[id] = struct{}{}
				overlap = append(overlap, id)
			}
			if len(overlap) == 1 {
				eligibleProductID = overlap[0]
			}
		}

		return &AppliedPromotion{
			ID:                   promo.ID,
			Name:                 promo.Name,
			Type:                 promo.Type,
			Percent:              rules.Percent,
			AppliesToAllProducts: len(selectedIDs) == 0,
			SelectedProductIds:   selectedIDs,
			Description:          description,
			BuyQty:               rules.BuyQty,
			GetQty:               rules.GetQty,
			BuyProductIDs:        buyIDs,
			GetProductIDs:        getIDs,
			EligibleProductID:    eligibleProductID,
			DiscountType:         discountType,
			DiscountPercent:      rules.DiscountPercent,
			FixedPrice:           rules.FixedPrice,
		}
	}

	overlaps := func(a, b *AppliedPromotion) bool {
		if a == nil || b == nil {
			return false
		}
		if a.AppliesToAllProducts || b.AppliesToAllProducts {
			return true
		}
		if len(a.SelectedProductIds) == 0 || len(b.SelectedProductIds) == 0 {
			return true
		}
		set := map[int]struct{}{}
		for _, id := range a.SelectedProductIds {
			set[id] = struct{}{}
		}
		for _, id := range b.SelectedProductIds {
			if _, ok := set[id]; ok {
				return true
			}
		}
		return false
	}

	bestPercentDiscount := 0.0
	bestPercentPriority := -1
	var bestPercentApplied *AppliedPromotion

	bestBogoDiscount := 0.0
	bestBogoPriority := -1
	var bestBogoApplied *AppliedPromotion

	for _, promo := range activePromotions {
		rules, err := promo.ParseRules()
		if err != nil {
			continue
		}

		calculatedDiscount, description := calculatePromotionDiscount(promo, cartItems, subtotal)
		if calculatedDiscount <= 0 {
			continue
		}

		ap := buildApplied(promo, rules, description)

		switch promo.Type {
		case "PERCENT_OFF":
			if calculatedDiscount > bestPercentDiscount || (calculatedDiscount == bestPercentDiscount && promo.Priority > bestPercentPriority) {
				bestPercentDiscount = calculatedDiscount
				bestPercentPriority = promo.Priority
				bestPercentApplied = ap
			}
		case "BUY_X_GET_Y":
			if calculatedDiscount > bestBogoDiscount || (calculatedDiscount == bestBogoDiscount && promo.Priority > bestBogoPriority) {
				bestBogoDiscount = calculatedDiscount
				bestBogoPriority = promo.Priority
				bestBogoApplied = ap
			}
		}
	}

	if bestPercentApplied != nil && bestBogoApplied != nil && !overlaps(bestPercentApplied, bestBogoApplied) {
		appliedPromos = append(appliedPromos, bestPercentApplied, bestBogoApplied)
		discount = bestPercentDiscount + bestBogoDiscount
		if bestBogoDiscount > bestPercentDiscount || (bestBogoDiscount == bestPercentDiscount && bestBogoPriority >= bestPercentPriority) {
			appliedPromo = bestBogoApplied
		} else {
			appliedPromo = bestPercentApplied
		}
	} else if bestPercentApplied != nil && (bestBogoApplied == nil || bestPercentDiscount > bestBogoDiscount || (bestPercentDiscount == bestBogoDiscount && bestPercentPriority >= bestBogoPriority)) {
		appliedPromos = append(appliedPromos, bestPercentApplied)
		discount = bestPercentDiscount
		appliedPromo = bestPercentApplied
	} else if bestBogoApplied != nil {
		appliedPromos = append(appliedPromos, bestBogoApplied)
		discount = bestBogoDiscount
		appliedPromo = bestBogoApplied
	}

	return discount, appliedPromo, appliedPromos
}

// calculatePromotionDiscount calculates discount for a promotion
// Returns: discount amount, description
func calculatePromotionDiscount(promo models.Promotion, cartItems []CheckoutCartItem, subtotal float64) (float64, string) {
	rules, err := promo.ParseRules()
	if err != nil {
		return 0, ""
	}

	switch promo.Type {
	case "PERCENT_OFF":
		return calculatePercentOffDiscount(rules, cartItems, subtotal)
	case "BUY_X_GET_Y":
		return calculateBuyXGetYDiscount(rules, cartItems)
	default:
		return 0, ""
	}
}

// calculatePercentOffDiscount calculates percentage discount
func calculatePercentOffDiscount(rules *models.PromotionRules, cartItems []CheckoutCartItem, subtotal float64) (float64, string) {
	if rules.Percent <= 0 || rules.Percent > 100 {
		return 0, ""
	}

	// If productIds is empty, apply to all products
	if len(rules.ProductIDs) == 0 {
		discount := subtotal * (rules.Percent / 100.0)
		return discount, formatPercentOffDescription(rules.Percent, "all products")
	}

	// Apply only to specified products
	applicableSubtotal := 0.0
	for _, item := range cartItems {
		for _, productID := range rules.ProductIDs {
			if item.ProductID == productID {
				applicableSubtotal += float64(item.Qty) * item.UnitPrice
				break
			}
		}
	}

	if applicableSubtotal == 0 {
		return 0, ""
	}

	discount := applicableSubtotal * (rules.Percent / 100.0)
	return discount, formatPercentOffDescription(rules.Percent, "selected products")
}

// calculateBuyXGetYDiscount calculates BOGO discount
func calculateBuyXGetYDiscount(rules *models.PromotionRules, cartItems []CheckoutCartItem) (float64, string) {
	if rules.BuyQty <= 0 || rules.GetQty <= 0 {
		return 0, ""
	}

	discountType := strings.ToUpper(strings.TrimSpace(rules.DiscountType))
	if discountType == "" {
		discountType = "FREE"
	}

	legacyMode := len(rules.BuyProductIDs) == 0 && len(rules.GetProductIDs) == 0
	if legacyMode {
		totalDiscount := 0.0
		totalQty := 0

		type getLine struct {
			qty            int
			savingsPerUnit float64
		}
		var lines []getLine

		eligible := map[int]struct{}{}
		if len(rules.ProductIDs) > 0 {
			for _, pid := range rules.ProductIDs {
				eligible[pid] = struct{}{}
			}
		}

		for _, item := range cartItems {
			if len(eligible) > 0 {
				if _, ok := eligible[item.ProductID]; !ok {
					continue
				}
			}
			if item.Qty <= 0 || item.UnitPrice <= 0 {
				continue
			}
			totalQty += item.Qty
			savings := calculateBuyXGetYSavingsForUnitPrice(1, item.UnitPrice, discountType, rules.DiscountPercent, rules.FixedPrice)
			if savings > 0 {
				lines = append(lines, getLine{qty: item.Qty, savingsPerUnit: savings})
			}
		}

		groupSize := rules.BuyQty + rules.GetQty
		if groupSize <= 0 {
			return 0, ""
		}

		freeQty := (totalQty / groupSize) * rules.GetQty
		if freeQty <= 0 || len(lines) == 0 {
			return 0, ""
		}

		sort.Slice(lines, func(i, j int) bool {
			return lines[i].savingsPerUnit > lines[j].savingsPerUnit
		})

		remainingQty := freeQty
		for _, l := range lines {
			use := l.qty
			if use > remainingQty {
				use = remainingQty
			}
			totalDiscount += float64(use) * l.savingsPerUnit
			remainingQty -= use
			if remainingQty <= 0 {
				break
			}
		}

		if totalDiscount == 0 {
			return 0, ""
		}

		return totalDiscount, formatBuyXGetYDescription(rules.BuyQty, rules.GetQty, discountType, rules.DiscountPercent, rules.FixedPrice)
	}

	buySet := make(map[int]struct{}, len(rules.BuyProductIDs))
	for _, id := range rules.BuyProductIDs {
		if id > 0 {
			buySet[id] = struct{}{}
		}
	}
	getSet := make(map[int]struct{}, len(rules.GetProductIDs))
	overlapSet := make(map[int]struct{})
	for _, id := range rules.GetProductIDs {
		if id <= 0 {
			continue
		}
		getSet[id] = struct{}{}
		if _, ok := buySet[id]; ok {
			overlapSet[id] = struct{}{}
		}
	}

	// Any overlap? Use group size logic on the UNION of Buy and Get sets.
	if len(overlapSet) > 0 {
		unionSet := make(map[int]struct{})
		for id := range buySet {
			unionSet[id] = struct{}{}
		}
		for id := range getSet {
			unionSet[id] = struct{}{}
		}

		totalDiscount := 0.0
		totalPoolQty := 0

		type getLine struct {
			productId      int
			qty            int
			savingsPerUnit float64
		}
		var targetLines []getLine

		for _, item := range cartItems {
			if item.Qty <= 0 || item.UnitPrice <= 0 {
				continue
			}
			if _, inPool := unionSet[item.ProductID]; inPool {
				totalPoolQty += item.Qty
			}
			if _, inGet := getSet[item.ProductID]; inGet {
				savings := calculateBuyXGetYSavingsForUnitPrice(1, item.UnitPrice, discountType, rules.DiscountPercent, rules.FixedPrice)
				if savings > 0 {
					targetLines = append(targetLines, getLine{productId: item.ProductID, qty: item.Qty, savingsPerUnit: savings})
				}
			}
		}

		groupSize := rules.BuyQty + rules.GetQty
		if groupSize <= 0 {
			return 0, ""
		}

		freeQtyTotal := (totalPoolQty / groupSize) * rules.GetQty
		if freeQtyTotal <= 0 || len(targetLines) == 0 {
			return 0, ""
		}

		sort.Slice(targetLines, func(i, j int) bool {
			return targetLines[i].savingsPerUnit > targetLines[j].savingsPerUnit
		})

		remainingFree := freeQtyTotal
		for _, l := range targetLines {
			use := l.qty
			if use > remainingFree {
				use = remainingFree
			}
			totalDiscount += float64(use) * l.savingsPerUnit
			remainingFree -= use
			if remainingFree <= 0 {
				break
			}
		}

		if totalDiscount > 0 {
			return totalDiscount, formatBuyXGetYDescription(rules.BuyQty, rules.GetQty, discountType, rules.DiscountPercent, rules.FixedPrice)
		}
		return 0, ""
	}

	getSet = make(map[int]struct{}, len(rules.GetProductIDs))
	for _, id := range rules.GetProductIDs {
		if id <= 0 {
			continue
		}
		if _, overlapsBuy := buySet[id]; overlapsBuy {
			continue
		}
		getSet[id] = struct{}{}
	}

	totalBuyQty := 0
	totalGetQty := 0
	for _, item := range cartItems {
		if item.Qty <= 0 {
			continue
		}
		if len(buySet) == 0 {
			totalBuyQty += item.Qty
		} else {
			if _, ok := buySet[item.ProductID]; ok {
				totalBuyQty += item.Qty
			}
		}

		if len(getSet) == 0 {
			totalGetQty += item.Qty
		} else {
			if _, ok := getSet[item.ProductID]; ok {
				totalGetQty += item.Qty
			}
		}
	}

	if totalBuyQty < rules.BuyQty || totalGetQty == 0 {
		return 0, ""
	}

	sets := totalBuyQty / rules.BuyQty
	if sets <= 0 {
		return 0, ""
	}

	maxDiscountQty := sets * rules.GetQty
	if maxDiscountQty <= 0 {
		return 0, ""
	}

	discountQty := totalGetQty
	if discountQty > maxDiscountQty {
		discountQty = maxDiscountQty
	}
	if discountQty <= 0 {
		return 0, ""
	}

	type getLine struct {
		qty            int
		savingsPerUnit float64
	}

	lines := make([]getLine, 0, len(cartItems))
	for _, item := range cartItems {
		if item.Qty <= 0 || item.UnitPrice <= 0 {
			continue
		}
		if len(getSet) > 0 {
			if _, ok := getSet[item.ProductID]; !ok {
				continue
			}
		}

		savingsPerUnit := calculateBuyXGetYSavingsForUnitPrice(1, item.UnitPrice, discountType, rules.DiscountPercent, rules.FixedPrice)
		if savingsPerUnit <= 0 {
			continue
		}
		lines = append(lines, getLine{
			qty:            item.Qty,
			savingsPerUnit: savingsPerUnit,
		})
	}

	if len(lines) == 0 {
		return 0, ""
	}

	sort.Slice(lines, func(i, j int) bool {
		return lines[i].savingsPerUnit > lines[j].savingsPerUnit
	})

	totalDiscount := 0.0
	remaining := discountQty
	for _, l := range lines {
		if remaining <= 0 {
			break
		}
		use := l.qty
		if use > remaining {
			use = remaining
		}
		totalDiscount += float64(use) * l.savingsPerUnit
		remaining -= use
	}

	if totalDiscount <= 0 {
		return 0, ""
	}

	return totalDiscount, formatBuyXGetYDescription(rules.BuyQty, rules.GetQty, discountType, rules.DiscountPercent, rules.FixedPrice)
}

// Helper functions for formatting descriptions
func formatPercentOffDescription(percent float64, scope string) string {
	return strconv.FormatFloat(percent, 'f', 0, 64) + "% off " + scope
}

func formatBuyXGetYDescription(buyQty, getQty int, discountType string, discountPercent, fixedPrice float64) string {
	if buyQty == 1 && getQty == 1 {
		switch discountType {
		case "PERCENT_OFF":
			return "Buy 1 Get 1 " + strconv.FormatFloat(discountPercent, 'f', 0, 64) + "% Off"
		case "FIXED_PRICE":
			return "Buy 1 Get 1 $" + strconv.FormatFloat(fixedPrice, 'f', 2, 64)
		default:
			return "Buy 1 Get 1 Free"
		}
	}
	base := "Buy " + strconv.Itoa(buyQty) + " Get " + strconv.Itoa(getQty)
	switch discountType {
	case "PERCENT_OFF":
		return base + " " + strconv.FormatFloat(discountPercent, 'f', 0, 64) + "% Off"
	case "FIXED_PRICE":
		return base + " $" + strconv.FormatFloat(fixedPrice, 'f', 2, 64)
	default:
		return base + " Free"
	}
}

func buildActivePromotionDTO(promo models.Promotion) (*ActivePromotionDTO, error) {
	rules, err := promo.ParseRules()
	if err != nil {
		return nil, err
	}

	discountType := strings.ToUpper(strings.TrimSpace(rules.DiscountType))
	if discountType == "" && promo.Type == "BUY_X_GET_Y" {
		discountType = "FREE"
	}

	buyIDs := append([]int(nil), rules.BuyProductIDs...)
	getIDs := append([]int(nil), rules.GetProductIDs...)
	if promo.Type == "BUY_X_GET_Y" && len(buyIDs) == 0 && len(getIDs) == 0 {
		buyIDs = append([]int(nil), rules.ProductIDs...)
		getIDs = append([]int(nil), rules.ProductIDs...)
	}

	selectedIDs := append([]int(nil), rules.ProductIDs...)
	if promo.Type == "BUY_X_GET_Y" && (len(buyIDs) > 0 || len(getIDs) > 0) {
		seen := map[int]struct{}{}
		selectedIDs = make([]int, 0, len(buyIDs)+len(getIDs))
		for _, id := range buyIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			selectedIDs = append(selectedIDs, id)
		}
		for _, id := range getIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			selectedIDs = append(selectedIDs, id)
		}
	}
	appliesToAll := len(selectedIDs) == 0

	selectedNames := []string{}
	if len(selectedIDs) > 0 && len(selectedIDs) <= 3 {
		for _, id := range selectedIDs {
			p, err := models.GetProductByID(configs.DB, id)
			if err != nil || p == nil || p.Name == "" {
				continue
			}
			selectedNames = append(selectedNames, p.Name)
		}
	}

	bannerTitle := ""
	switch promo.Type {
	case "PERCENT_OFF":
		if rules.Percent > 0 {
			percentText := strconv.FormatFloat(rules.Percent, 'f', -1, 64) + "% OFF"
			if appliesToAll {
				bannerTitle = percentText + " Everything"
			} else if len(selectedIDs) == 1 {
				if len(selectedNames) == 1 {
					bannerTitle = percentText + " " + selectedNames[0]
				} else {
					bannerTitle = percentText + " Selected Items"
				}
			} else if len(selectedIDs) > 1 {
				bannerTitle = percentText + " Selected Items"
			}
		}
	case "BUY_X_GET_Y":
		if rules.BuyQty > 0 && rules.GetQty > 0 {
			base := formatBuyXGetYDescription(rules.BuyQty, rules.GetQty, discountType, rules.DiscountPercent, rules.FixedPrice)
			if len(getIDs) == 1 {
				p, err := models.GetProductByID(configs.DB, getIDs[0])
				if err == nil && p != nil && p.Name != "" {
					bannerTitle = base + " " + p.Name
				} else {
					bannerTitle = base
				}
			} else if len(getIDs) > 1 {
				bannerTitle = base + " Selected Items"
			} else {
				bannerTitle = base
			}
		}
	}

	eligibleProductID := 0
	if promo.Type == "BUY_X_GET_Y" && len(buyIDs) > 0 && len(getIDs) > 0 {
		buySet := map[int]struct{}{}
		for _, id := range buyIDs {
			buySet[id] = struct{}{}
		}
		uniq := map[int]struct{}{}
		overlap := make([]int, 0, len(getIDs))
		for _, id := range getIDs {
			if _, ok := buySet[id]; !ok {
				continue
			}
			if _, seen := uniq[id]; seen {
				continue
			}
			uniq[id] = struct{}{}
			overlap = append(overlap, id)
		}
		if len(overlap) == 1 {
			eligibleProductID = overlap[0]
		}
	}

	dto := &ActivePromotionDTO{
		ID:                   promo.ID,
		Name:                 promo.Name,
		Type:                 promo.Type,
		Rules:                promo.Rules,
		Active:               promo.Active,
		StartAt:              promo.StartAt,
		EndAt:                promo.EndAt,
		Priority:             promo.Priority,
		BannerTitle:          bannerTitle,
		AppliesToAllProducts: appliesToAll,
		SelectedProductIds:   selectedIDs,
		SelectedProductNames: selectedNames,
		Percent:              rules.Percent,
		BuyQty:               rules.BuyQty,
		GetQty:               rules.GetQty,
		BuyProductIDs:        buyIDs,
		GetProductIDs:        getIDs,
		EligibleProductID:    eligibleProductID,
		DiscountType:         discountType,
		DiscountPercent:      rules.DiscountPercent,
		FixedPrice:           rules.FixedPrice,
	}

	return dto, nil
}

func calculateBuyXGetYSavingsForUnitPrice(units, unitPrice float64, discountType string, discountPercent, fixedPrice float64) float64 {
	switch discountType {
	case "PERCENT_OFF":
		if discountPercent <= 0 || discountPercent > 100 {
			return 0
		}
		return units * unitPrice * (discountPercent / 100.0)
	case "FIXED_PRICE":
		if fixedPrice < 0 {
			return 0
		}
		savingsPerUnit := unitPrice - fixedPrice
		if savingsPerUnit <= 0 {
			return 0
		}
		return units * savingsPerUnit
	default:
		if unitPrice <= 0 {
			return 0
		}
		return units * unitPrice
	}
}

// parseDateTime parses various datetime formats
func parseDateTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("unable to parse datetime: empty string")
	}

	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}

	formatsLocal := []string{
		"2006-01-02T15:04",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
	}

	for _, format := range formatsLocal {
		if t, err := time.ParseInLocation(format, s, time.Local); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse datetime: %s", s)
}

func normalizeBuyXGetYProductIDs(rules *models.PromotionRules) []int {
	if rules == nil {
		return []int{}
	}
	ids := []int{}
	if len(rules.BuyProductIDs) > 0 || len(rules.GetProductIDs) > 0 {
		ids = append(ids, rules.BuyProductIDs...)
		ids = append(ids, rules.GetProductIDs...)
	} else {
		ids = append(ids, rules.ProductIDs...)
	}
	seen := map[int]struct{}{}
	unique := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

func hasActiveBuyXGetYConflicts(targetIDs []int, excludePromotionID int) (bool, error) {
	if len(targetIDs) == 0 {
		return false, nil
	}
	activePromos, err := models.GetActivePromotions()
	if err != nil {
		return false, err
	}
	targetSet := map[int]struct{}{}
	for _, id := range targetIDs {
		if id <= 0 {
			continue
		}
		targetSet[id] = struct{}{}
	}
	if len(targetSet) == 0 {
		return false, nil
	}
	for _, promo := range activePromos {
		if promo.Type != "BUY_X_GET_Y" {
			continue
		}
		if excludePromotionID > 0 && promo.ID == excludePromotionID {
			continue
		}
		rules, err := promo.ParseRules()
		if err != nil || rules == nil {
			continue
		}
		ids := normalizeBuyXGetYProductIDs(rules)
		for _, id := range ids {
			if _, ok := targetSet[id]; ok {
				return true, nil
			}
		}
	}
	return false, nil
}

// AdminGetAllPromotions returns all promotions for admin dashboard
// GET /api/admin/promotions
func AdminGetAllPromotions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	promotions, err := models.GetAllPromotions()
	if err != nil {
		log.Printf("Error fetching promotions: %v", err)
		http.Error(w, `{"error": "Failed to fetch promotions"}`, http.StatusInternalServerError)
		return
	}

	if promotions == nil {
		promotions = []models.Promotion{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"promotions": promotions,
	})
}

// AdminCreatePromotion creates a new promotion
// POST /api/admin/promotions
func AdminCreatePromotion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req struct {
		Name     string          `json:"name"`
		Type     string          `json:"type"`
		Rules    json.RawMessage `json:"rules"`
		Active   bool            `json:"active"`
		StartAt  string          `json:"start_at"`
		EndAt    string          `json:"end_at"`
		Priority int             `json:"priority"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Parse dates
	startAt, err := parseDateTime(req.StartAt)
	if err != nil {
		http.Error(w, `{"error": "Invalid start_at format: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	endAt, err := parseDateTime(req.EndAt)
	if err != nil {
		http.Error(w, `{"error": "Invalid end_at format: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	promo := models.Promotion{
		Name:     req.Name,
		Type:     req.Type,
		Rules:    req.Rules,
		Active:   req.Active,
		StartAt:  startAt,
		EndAt:    endAt,
		Priority: req.Priority,
	}

	if promo.Type == "BUY_X_GET_Y" {
		var rules models.PromotionRules
		if err := json.Unmarshal(req.Rules, &rules); err != nil {
			http.Error(w, `{"error": "Invalid promotion rules"}`, http.StatusBadRequest)
			return
		}
		targetIDs := normalizeBuyXGetYProductIDs(&rules)
		conflict, err := hasActiveBuyXGetYConflicts(targetIDs, 0)
		if err != nil {
			http.Error(w, `{"error": "Failed to validate promotion"}`, http.StatusInternalServerError)
			return
		}
		if conflict {
			http.Error(w, `{"error": "This product is already used in another promotion."}`, http.StatusBadRequest)
			return
		}
	}

	if err := models.CreatePromotion(&promo); err != nil {
		log.Printf("Error creating promotion: %v", err)
		http.Error(w, `{"error": "Failed to create promotion"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"promotion": promo,
	})
}

// AdminUpdatePromotion updates an existing promotion
// PUT /api/admin/promotions/{id}
func AdminUpdatePromotion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, `{"error": "Invalid promotion ID"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Name     string          `json:"name"`
		Type     string          `json:"type"`
		Rules    json.RawMessage `json:"rules"`
		Active   bool            `json:"active"`
		StartAt  string          `json:"start_at"`
		EndAt    string          `json:"end_at"`
		Priority int             `json:"priority"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Parse dates
	startAt, err := parseDateTime(req.StartAt)
	if err != nil {
		http.Error(w, `{"error": "Invalid start_at format: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	endAt, err := parseDateTime(req.EndAt)
	if err != nil {
		http.Error(w, `{"error": "Invalid end_at format: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	promo := models.Promotion{
		ID:       id,
		Name:     req.Name,
		Type:     req.Type,
		Rules:    req.Rules,
		Active:   req.Active,
		StartAt:  startAt,
		EndAt:    endAt,
		Priority: req.Priority,
	}

	if promo.Type == "BUY_X_GET_Y" {
		var rules models.PromotionRules
		if err := json.Unmarshal(req.Rules, &rules); err != nil {
			http.Error(w, `{"error": "Invalid promotion rules"}`, http.StatusBadRequest)
			return
		}
		targetIDs := normalizeBuyXGetYProductIDs(&rules)
		conflict, err := hasActiveBuyXGetYConflicts(targetIDs, promo.ID)
		if err != nil {
			http.Error(w, `{"error": "Failed to validate promotion"}`, http.StatusInternalServerError)
			return
		}
		if conflict {
			http.Error(w, `{"error": "This product is already used in another promotion."}`, http.StatusBadRequest)
			return
		}
	}

	if err := models.UpdatePromotion(&promo); err != nil {
		log.Printf("Error updating promotion: %v", err)
		http.Error(w, `{"error": "Failed to update promotion"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"promotion": promo,
	})
}

// AdminTogglePromotion toggles promotion active status
// PATCH /api/admin/promotions/{id}/toggle
func AdminTogglePromotion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, `{"error": "Invalid promotion ID"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Active bool `json:"active"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Get existing promotion
	promo, err := models.GetPromotionByID(id)
	if err != nil || promo == nil {
		http.Error(w, `{"error": "Promotion not found"}`, http.StatusNotFound)
		return
	}

	// Update active status
	promo.Active = req.Active
	if err := models.UpdatePromotion(promo); err != nil {
		log.Printf("Error updating promotion: %v", err)
		http.Error(w, `{"error": "Failed to update promotion"}`, http.StatusInternalServerError)
		return
	}

	status := "activated"
	if !req.Active {
		status = "deactivated"
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Promotion " + status,
		"active":  req.Active,
	})
}

// AdminDeletePromotion deletes a promotion
// DELETE /api/admin/promotions/{id}
func AdminDeletePromotion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, `{"error": "Invalid promotion ID"}`, http.StatusBadRequest)
		return
	}

	if err := models.DeletePromotion(id); err != nil {
		log.Printf("Error deleting promotion: %v", err)
		http.Error(w, `{"error": "Failed to delete promotion"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Promotion deleted",
	})
}
