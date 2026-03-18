package controllers

import (
	"fmt"
	"log"

	// "os"
	"strconv"
	"strings"
	"time"

	"bakeflow/configs"
	"bakeflow/models"
)

// calculateDeliveryFee calculates delivery fee based on delivery type
func calculateDeliveryFee(deliveryType, address string) float64 {
	fee, _ := calculateDeliveryFeeStrict(deliveryType, address)
	return fee
}

var townshipDeliveryFeesMMK = map[string]float64{
	"kyimyindaing": 0,
	"ahlon":        2000,
	"sanchaung":    2000,
	"kamayut":      2500,
	"lanmadaw":     2500,
	"hlaing":       3500,
	"mayangon":     4500,
	"twante":       5000,
	"kyauktada":    5000,
	"bahan":        5500,
	"latha":        6000,
	"pabedan":      6000,
	"dagon":        7000,
}

var townshipNames = []string{
	"Kyimyindaing",
	"Ahlon",
	"Sanchaung",
	"Kamayut",
	"Lanmadaw",
	"Hlaing",
	"Mayangon",
	"Twante",
	"Kyauktada",
	"Bahan",
	"Latha",
	"Pabedan",
	"Dagon",
}

func extractTownshipFromAddress(address string) (string, bool) {
	v := strings.ToLower(strings.TrimSpace(address))
	if v == "" {
		return "", false
	}
	for _, t := range townshipNames {
		if strings.Contains(v, strings.ToLower(t)) {
			return t, true
		}
	}
	return "", false
}

func calculateDeliveryFeeStrict(deliveryType, address string) (float64, bool) {
	dt := strings.ToLower(strings.TrimSpace(deliveryType))
	if dt == "" || dt == "pickup" {
		return 0, true
	}
	if dt != "delivery" {
		return 0, true
	}
	name, ok := extractTownshipFromAddress(address)
	if !ok {
		return 0, false
	}
	fee, ok := townshipDeliveryFeesMMK[strings.ToLower(name)]
	if !ok {
		return 0, false
	}
	return fee, true
}

// calculateOrderTotals calculates subtotal, delivery fee, and total
func calculateOrderTotals(cart []CartItem, deliveryType, address string) (subtotal, deliveryFee, total float64) {
	// Calculate subtotal from cart
	for _, item := range cart {
		if product, exists := ProductCatalog[item.Product]; exists {
			priceStr := strings.ReplaceAll(product.Price, "$", "")
			if price, err := strconv.ParseFloat(priceStr, 64); err == nil {
				subtotal += price * float64(item.Quantity)
			}
		}
	}

	// Calculate delivery fee
	deliveryFee = calculateDeliveryFee(deliveryType, address)

	// Total = subtotal + delivery fee
	total = subtotal + deliveryFee

	return subtotal, deliveryFee, total
}

func checkOrderRateLimit(senderID string) (bool, time.Duration, error) {
	if senderID == "" {
		return false, 0, nil
	}
	recentOrders, err := models.GetRecentOrdersBySenderID(senderID, 10)
	if err != nil {
		return false, 0, err
	}

	now := time.Now()
	shortWindow := 10 * time.Minute
	shortLimit := 100 // Increased from 3 to effectively disable rate limiting
	shortCount := 0
	var oldestShort time.Time

	for _, order := range recentOrders {
		age := now.Sub(order.CreatedAt)
		if age <= shortWindow {
			shortCount++
			if oldestShort.IsZero() || order.CreatedAt.Before(oldestShort) {
				oldestShort = order.CreatedAt
			}
		}
	}

	if shortCount >= shortLimit {
		retryAfter := shortWindow - now.Sub(oldestShort)
		if retryAfter < time.Minute {
			retryAfter = time.Minute
		}
		return true, retryAfter, nil
	}
	return false, 0, nil
}

// isBusinessOpen checks if current time is within business hours (8 AM - 8 PM)
func isBusinessOpen() bool {
	// TEMP: Always open for testing. Original logic (8AM-8PM) commented below.
	// now := time.Now()
	// hour := now.Hour()
	// return hour >= 8 && hour < 20
	return true
}

// getNextOpeningTime returns a formatted string of when the business opens next
func getNextOpeningTime() string {
	now := time.Now()
	hour := now.Hour()

	if hour < 8 {
		// Opens today at 8 AM
		return "8:00 AM today"
	} else {
		// Opens tomorrow at 8 AM
		tomorrow := now.Add(24 * time.Hour)
		return fmt.Sprintf("8:00 AM on %s", tomorrow.Format("Monday, Jan 2"))
	}
}

// confirmOrder saves the order to the database and sends confirmation
// confirmOrder has been removed - use webview-based ordering via CreateChatOrder instead

// handleReorder pre-fills cart with items from previous order
func handleReorder(userID string, orderID int) {
	// Get the order
	order, err := models.GetOrderByID(orderID)
	if err != nil {
		log.Printf("❌ Error fetching order for reorder: %v", err)
		SendMessage(userID, "😞 Sorry, couldn't load that order. Please try again.")
		return
	}

	// Reset state and pre-fill cart
	state := GetUserState(userID)
	state.Cart = []CartItem{}

	// Convert order items to cart items
	for _, item := range order.Items {
		emoji := "🍰"
		if product, exists := ProductCatalog[item.Product]; exists {
			emoji = product.Emoji
		}

		state.Cart = append(state.Cart, CartItem{
			Product:      item.Product,
			ProductEmoji: emoji,
			Quantity:     item.Quantity,
		})
	}

	// Calculate total items
	totalItems := 0
	for _, item := range state.Cart {
		totalItems += item.Quantity
	}

	// Send confirmation message
	SendMessage(userID, fmt.Sprintf("🔄 **Reordering from Order #%d**\n\n✅ Added %d items to your cart!", order.ID, totalItems))

	// Open webview form to complete reorder
	ShowWebviewOrderForm(userID)
}

// askForRating sends rating request with star buttons
func askForRating(userID string, orderID int) {
	state := GetUserState(userID)
	state.State = "awaiting_rating"
	state.CurrentProduct = strconv.Itoa(orderID) // Temporarily store orderID

	ratingMsg := "⭐ **How was your order?**\n\n" +
		"We'd love to hear your feedback!\n" +
		"Please rate your experience:"

	if state.Language == "my" {
		ratingMsg = "⭐ **အော်ဒါက ဘယ်လိုလဲ?**\n\n" +
			"သင့်ရဲ့ အကြံပြုချက်ကို ကြားလိုပါတယ်!\n" +
			"သင့်အတွေ့အကြုံကို အဆင့်သတ်မှတ်ပေးပါ:"
	}

	quickReplies := []QuickReply{
		{ContentType: "text", Title: "⭐ 1 Star - Poor", Payload: "RATING_1"},
		{ContentType: "text", Title: "⭐⭐ 2 Stars", Payload: "RATING_2"},
		{ContentType: "text", Title: "⭐⭐⭐ 3 Stars", Payload: "RATING_3"},
		{ContentType: "text", Title: "⭐⭐⭐⭐ 4 Stars", Payload: "RATING_4"},
		{ContentType: "text", Title: "⭐⭐⭐⭐⭐ 5 Stars - Excellent!", Payload: "RATING_5"},
		{ContentType: "text", Title: "Skip", Payload: "SKIP_RATING"},
	}

	SendQuickReplies(userID, ratingMsg, quickReplies)
}

// handleRating saves customer rating
func handleRating(userID string, stars int) {
	state := GetUserState(userID)

	// Get orderID from temporary storage
	orderID, err := strconv.Atoi(state.CurrentProduct)
	if err != nil {
		SendMessage(userID, "😞 Sorry, something went wrong. Please try again.")
		ResetUserState(userID)
		return
	}

	// Save rating to database
	rating := models.Rating{
		OrderID: orderID,
		UserID:  userID,
		Stars:   stars,
		Comment: "",
	}

	err = models.CreateRating(&rating)
	if err != nil {
		log.Printf("❌ Error saving rating: %v", err)
		SendMessage(userID, "😞 Sorry, couldn't save your rating. Please try again later.")
		return
	}

	// Send thank you message
	thankYouMsg := ""
	if stars >= 4 {
		thankYouMsg = "🎉 **Thank you so much!**\n\n" +
			"We're thrilled you loved your order! ⭐⭐⭐⭐⭐\n\n" +
			"Your feedback means the world to us. Looking forward to serving you again! 🍰"

		if state.Language == "my" {
			thankYouMsg = "🎉 **အရမ်းကျေးဇူးတင်ပါတယ်!**\n\n" +
				"သင့် အော်ဒါကို နှစ်သက်တာ သိရတာ အရမ်းဝမ်းသာပါတယ်! ⭐⭐⭐⭐⭐\n\n" +
				"သင့်ရဲ့ အကြံပြုချက်က ကျွန်ုပ်တို့အတွက် အရမ်းအရေးကြီးပါတယ်။ နောက်တစ်ခါ ထပ်ဆောင်ရွက်ပေးဖို့ မျှော်လင့်နေပါတယ်! 🍰"
		}
	} else if stars == 3 {
		thankYouMsg = "😊 **Thank you for your feedback!**\n\n" +
			"We appreciate your honesty. We're always working to improve!\n\n" +
			"Type 'menu' to order again! 🍰"

		if state.Language == "my" {
			thankYouMsg = "😊 **သင့်အကြံပြုချက်အတွက် ကျေးဇူးတင်ပါတယ်!**\n\n" +
				"သင့်ရိုးသားမှုကို တန်ဖိုးထားပါတယ်။ ကျွန်ုပ်တို့ အမြဲတမ်း တိုးတက်အောင် လုပ်ဆောင်နေပါတယ်!\n\n" +
				"'မီနူး' လို့ရိုက်ပြီး ထပ်မှာလိုက်ပါ! 🍰"
		}
	} else {
		thankYouMsg = "😔 **We're sorry you weren't satisfied.**\n\n" +
			"Your feedback is important to us. We'll do better next time!\n\n" +
			"Please give us another chance. Type 'menu' to order! 🍰"

		if state.Language == "my" {
			thankYouMsg = "😔 **သင် မကျေနပ်မှုအတွက် တောင်းပန်ပါတယ်။**\n\n" +
				"သင့်အကြံပြုချက်က ကျွန်ုပ်တို့အတွက် အရေးကြီးပါတယ်။ နောက်တစ်ခါ ပိုကောင်းအောင် လုပ်ပါမယ်!\n\n" +
				"နောက်တစ်ခါ အခွင့်အရေးပေးပါ။ 'မီနူး' လို့ရိုက်ပြီး မှာလိုက်ပါ! 🍰"
		}
	}

	SendMessage(userID, thankYouMsg)
	ResetUserState(userID)
}

// checkBusinessHours checks if ordering is allowed (business hours check)
func checkBusinessHours(userID string) bool {
	if isBusinessOpen() {
		return true
	}

	state := GetUserState(userID)
	closedMsg := "🔒 **We're Currently Closed**\n\n" +
		"Business Hours: 8:00 AM - 8:00 PM\n\n" +
		fmt.Sprintf("We'll be open again at %s.\n\n", getNextOpeningTime()) +
		"You can browse our menu, but ordering is temporarily unavailable.\n\n" +
		"See you soon! 🍰"

	if state.Language == "my" {
		closedMsg = "🔒 **ကျွန်ုပ်တို့ လောလောဆယ် ပိတ်နေပါတယ်**\n\n" +
			"စီးပွားရေး အချိန်: နံနက် 8:00 - ည 8:00\n\n" +
			fmt.Sprintf("ကျွန်ုပ်တို့ %s မှာ ပြန်ဖွင့်ပါမယ်။\n\n", getNextOpeningTime()) +
			"မီနူးကို ကြည့်နိုင်ပေမယ့် မှာယူခြင်းကို ယာယီ မရနိုင်ပါဘူး။\n\n" +
			"မကြာခင် တွေ့ရအောင်! 🍰"
	}

	SendMessage(userID, closedMsg)
	return false
}

// showProductRatingOptions shows user's delivered orders containing a specific product
func showProductRatingOptions(userID string, productID int) {
	// Get product info
	product, err := models.GetProductByID(configs.DB, productID)
	if err != nil || product == nil {
		SendMessage(userID, "😞 Sorry, couldn't find that product.")
		return
	}

	// Get user's recent orders
	orders, err := models.GetRecentOrdersBySenderID(userID, 20)
	if err != nil {
		log.Printf("Error fetching orders: %v", err)
		SendMessage(userID, "😞 Sorry, couldn't load your orders.")
		return
	}

	// Filter orders that:
	// 1. Are delivered
	// 2. Contain this product (by name match)
	// 3. User hasn't rated this product from this order yet
	var eligibleOrders []models.Order
	for _, order := range orders {
		if order.Status != "delivered" {
			continue
		}

		// Check if order contains this product
		hasProduct := false
		for _, item := range order.Items {
			if item.Product == product.Name {
				hasProduct = true
				break
			}
		}

		if !hasProduct {
			continue
		}

		// Check if already rated
		existingRating, _ := models.GetProductRating(productID, order.ID, userID)
		if existingRating != nil {
			continue // Already rated
		}

		eligibleOrders = append(eligibleOrders, order)
	}

	if len(eligibleOrders) == 0 {
		state := GetUserState(userID)
		msg := fmt.Sprintf("⭐ **%s**\n\n", product.Name)
		if state.Language == "my" {
			msg += "သင်သည် ဤထုတ်ကုန်ကို မှာယူထားသော အော်ဒါများ မရှိပါဘူး သို့မဟုတ် အားလုံးကို အဆင့်သတ်မှတ်ပြီးပါပြီ။"
		} else {
			msg += "You haven't ordered this product yet, or you've already rated all your orders containing it."
		}
		SendMessage(userID, msg)
		return
	}

	// Show orders as cards
	state := GetUserState(userID)
	var elements []Element

	for _, order := range eligibleOrders {
		orderDate := order.CreatedAt.Format("Jan 2, 2006")
		subtitle := fmt.Sprintf("Order #%d • %s • Ks %.2f", order.ID, orderDate, order.TotalAmount)

		elements = append(elements, Element{
			Title:    fmt.Sprintf("📦 Order #%d", order.ID),
			Subtitle: subtitle,
			Buttons: []Button{
				{
					Type:    "postback",
					Title:   "⭐ Rate This Product",
					Payload: fmt.Sprintf("RATE_PRODUCT_ORDER_%d_%d", productID, order.ID),
				},
			},
		})
	}

	if len(elements) > 0 {
		msg := fmt.Sprintf("⭐ **Rate: %s**\n\nSelect an order to rate this product:", product.Name)
		if state.Language == "my" {
			msg = fmt.Sprintf("⭐ **အဆင့်သတ်မှတ်ရန်: %s**\n\nဤထုတ်ကုန်ကို အဆင့်သတ်မှတ်ရန် အော်ဒါကို ရွေးပါ:", product.Name)
		}
		SendMessage(userID, msg)
		SendGenericTemplate(userID, elements)
	}
}

// askForProductRating asks user to rate a specific product from an order
func askForProductRating(userID string, productID int, orderID int) {
	// Get product and order info
	product, err := models.GetProductByID(configs.DB, productID)
	if err != nil || product == nil {
		SendMessage(userID, "😞 Sorry, couldn't find that product.")
		return
	}

	order, err := models.GetOrderByID(orderID)
	if err != nil || order == nil {
		SendMessage(userID, "😞 Sorry, couldn't find that order.")
		return
	}

	// Verify user owns this order
	if order.SenderID != userID {
		SendMessage(userID, "😞 This order doesn't belong to you.")
		return
	}

	// Verify order is delivered
	if order.Status != "delivered" {
		SendMessage(userID, "😞 You can only rate products from delivered orders.")
		return
	}

	// Check if already rated
	existingRating, _ := models.GetProductRating(productID, orderID, userID)
	if existingRating != nil {
		state := GetUserState(userID)
		msg := fmt.Sprintf("✅ You've already rated **%s** from Order #%d!\n\nRating: %d⭐", product.Name, orderID, existingRating.Stars)
		if state.Language == "my" {
			msg = fmt.Sprintf("✅ သင်သည် **%s** ကို Order #%d မှ အဆင့်သတ်မှတ်ပြီးပါပြီ!\n\nအဆင့်: %d⭐", product.Name, orderID, existingRating.Stars)
		}
		SendMessage(userID, msg)
		return
	}

	// Store product and order ID in state for rating submission
	state := GetUserState(userID)
	state.State = "awaiting_product_rating"
	state.CurrentProduct = fmt.Sprintf("%d_%d", productID, orderID) // Store as "productID_orderID"

	// Ask for rating
	msg := fmt.Sprintf("⭐ **How was %s?**\n\nFrom Order #%d\n\nPlease rate your experience:", product.Name, orderID)
	if state.Language == "my" {
		msg = fmt.Sprintf("⭐ **%s က ဘယ်လိုလဲ?**\n\nOrder #%d မှ\n\nသင့်အတွေ့အကြုံကို အဆင့်သတ်မှတ်ပေးပါ:", product.Name, orderID)
	}

	quickReplies := []QuickReply{
		{ContentType: "text", Title: "⭐ 1 Star", Payload: "PRODUCT_RATING_1"},
		{ContentType: "text", Title: "⭐⭐ 2 Stars", Payload: "PRODUCT_RATING_2"},
		{ContentType: "text", Title: "⭐⭐⭐ 3 Stars", Payload: "PRODUCT_RATING_3"},
		{ContentType: "text", Title: "⭐⭐⭐⭐ 4 Stars", Payload: "PRODUCT_RATING_4"},
		{ContentType: "text", Title: "⭐⭐⭐⭐⭐ 5 Stars", Payload: "PRODUCT_RATING_5"},
		{ContentType: "text", Title: "Skip", Payload: "SKIP_PRODUCT_RATING"},
	}

	SendQuickReplies(userID, msg, quickReplies)
}

// handleProductRating saves a product rating
func handleProductRating(userID string, stars int) {
	state := GetUserState(userID)

	if state.State != "awaiting_product_rating" {
		SendMessage(userID, "⚠️ Please select a product to rate first.")
		return
	}

	// Parse productID and orderID from state
	parts := strings.Split(state.CurrentProduct, "_")
	if len(parts) != 2 {
		SendMessage(userID, "😞 Sorry, something went wrong. Please try again.")
		ResetUserState(userID)
		return
	}

	productID, err1 := strconv.Atoi(parts[0])
	orderID, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		SendMessage(userID, "😞 Sorry, something went wrong. Please try again.")
		ResetUserState(userID)
		return
	}

	// Get product name for confirmation
	product, err := models.GetProductByID(configs.DB, productID)
	if err != nil || product == nil {
		SendMessage(userID, "😞 Sorry, couldn't find that product.")
		ResetUserState(userID)
		return
	}

	// Create rating
	rating := &models.ProductRating{
		ProductID: productID,
		OrderID:   orderID,
		UserID:    userID,
		Stars:     stars,
		Comment:   "", // Can be extended to ask for comments
	}

	if err := models.CreateProductRating(rating); err != nil {
		log.Printf("❌ Error saving product rating: %v", err)
		SendMessage(userID, "😞 Sorry, couldn't save your rating. Please try again later.")
		ResetUserState(userID)
		return
	}

	// Send thank you message
	thankYouMsg := ""
	if stars >= 4 {
		thankYouMsg = fmt.Sprintf("🎉 **Thank you!**\n\nYour %d⭐ rating for **%s** has been saved!\n\nWe're thrilled you loved it! 🍰", stars, product.Name)
		if state.Language == "my" {
			thankYouMsg = fmt.Sprintf("🎉 **ကျေးဇူးတင်ပါတယ်!**\n\n**%s** အတွက် %d⭐ အဆင့်သတ်မှတ်မှု သိမ်းဆည်းပြီးပါပြီ!\n\nသင်နှစ်သက်တာ ဝမ်းသာပါတယ်! 🍰", product.Name, stars)
		}
	} else {
		thankYouMsg = fmt.Sprintf("😊 **Thank you for your feedback!**\n\nYour %d⭐ rating for **%s** has been saved.\n\nWe appreciate your honesty and will keep improving! 🍰", stars, product.Name)
		if state.Language == "my" {
			thankYouMsg = fmt.Sprintf("😊 **သင့်အကြံပြုချက်အတွက် ကျေးဇူးတင်ပါတယ်!**\n\n**%s** အတွက် %d⭐ အဆင့်သတ်မှတ်မှု သိမ်းဆည်းပြီးပါပြီ။\n\nသင့်ရိုးသားမှုကို တန်ဖိုးထားပါတယ်! 🍰", product.Name, stars)
		}
	}

	SendMessage(userID, thankYouMsg)
	ResetUserState(userID)
}
