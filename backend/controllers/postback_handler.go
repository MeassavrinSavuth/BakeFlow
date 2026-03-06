package controllers

import (
	"bakeflow/configs"
	"bakeflow/models"
	"log"
	"strconv"
	"strings"
)

// handlePostback processes button clicks (postback payloads)
func handlePostback(userID, payload string) {
	log.Printf("[Postback] User %s clicked: %s", userID, payload)
	state := GetUserState(userID)

	switch payload {
	// Language selection
	case "LANG_EN":
		state.Language = "en"
		state.State = "greeting"
		SendMessage(userID, "✅ English selected!")
		ShowWebviewOrderForm(userID)

	case "LANG_MY":
		state.Language = "my"
		state.State = "greeting"
		SendMessage(userID, "✅ မြန်မာဘာသာ ရွေးချယ်ပြီးပါပြီ!")
		ShowWebviewOrderForm(userID)

	// Persistent Menu Actions (from ☰ menu)
	case "MENU_ORDER":
		ShowWebviewOrderForm(userID)

	case "MENU_ORDER_HISTORY":
		showOrderHistory(userID)

	case "MENU_ABOUT":
		showAbout(userID) // Shows both About and Help combined

	case "MENU_CHANGE_LANG":
		showLanguageSelection(userID)

	// Menu Help button
	case "MENU_HELP":
		showHelp(userID)

	// Track Order button - show recent order status (legacy, shows latest)
	case "TRACK_ORDER":
		showOrderTracking(userID, 0)

	// Contact Support / Need Help button
	case "CONTACT_SUPPORT":
		showHelp(userID)

	case "VERIFY_CUSTOMER_CONFIRM":
		if confirmMessengerVerification(userID) {
			return
		}

	// CHAT-BASED ORDERING REMOVED - Only webview form ordering supported
	// These cases are kept in the switch for reference but redirected to webview
	case "MENU_ORDER_PRODUCTS", "ORDER_NOW", "GET_STARTED":
		fallthrough
	case "ORDER_CHOCOLATE_CAKE", "ORDER_VANILLA_CAKE", "ORDER_RED_VELVET", "ORDER_CROISSANT", "ORDER_CINNAMON_ROLL", "ORDER_CUPCAKE", "ORDER_COFFEE", "ORDER_BREAD", "ORDER_CHOCOLATE_CUPCAKE":
		fallthrough
	case "QTY_1", "QTY_2", "QTY_3", "QTY_4", "QTY_5":
		fallthrough
	case "ADD_MORE_ITEMS", "CHECKOUT", "GO_BACK", "MAIN_MENU":
		fallthrough
	case "PICKUP", "DELIVERY", "CONFIRM_ORDER":
		// Chat-based ordering has been removed - user should use webview form
		ShowWebviewOrderForm(userID)

	case "CANCEL_ORDER":
		ResetUserState(userID)
		SendMessage(userID, "❌ Order cancelled.")
		SendMessage(userID, "━━━━━━━━━━━━━━━━━")
		SendMessage(userID, "Ready to start fresh? Type 'menu' to see our products!")

	// Mini Quick Order Form
	case "QUICK_SHOP":
		state.State = "quick_ordering"
		ShowWebviewOrderForm(userID) // Opens mini web app inside Messenger

	case "QUICK_SHOW_CART":
		showQuickCartSummary(userID)

	case "QUICK_CHECKOUT":
		handleQuickCheckout(userID)

	case "QUICK_ADD_MORE":
		state.State = "quick_ordering"
		ShowMiniOrderForm(userID)

	case "QUICK_CLEAR_CART":
		handleQuickClearCart(userID)

	// Special actions
	case "SHOW_MENU":
		ShowWebviewOrderForm(userID)

	// Rating actions (order-level)
	case "RATING_1":
		handleRating(userID, 1)
	case "RATING_2":
		handleRating(userID, 2)
	case "RATING_3":
		handleRating(userID, 3)
	case "RATING_4":
		handleRating(userID, 4)
	case "RATING_5":
		handleRating(userID, 5)
	case "SKIP_RATING":
		SendMessage(userID, "No problem! Feel free to rate us anytime.\n\nType 'menu' to order again! 🍰")
		ResetUserState(userID)

	// Product rating actions
	case "PRODUCT_RATING_1":
		handleProductRating(userID, 1)
	case "PRODUCT_RATING_2":
		handleProductRating(userID, 2)
	case "PRODUCT_RATING_3":
		handleProductRating(userID, 3)
	case "PRODUCT_RATING_4":
		handleProductRating(userID, 4)
	case "PRODUCT_RATING_5":
		handleProductRating(userID, 5)
	case "SKIP_PRODUCT_RATING":
		SendMessage(userID, "No problem! Feel free to rate products anytime.\n\nType 'menu' to see products! 🍰")
		ResetUserState(userID)

	default:
		// Dynamic product ordering by ID
		if strings.HasPrefix(payload, "ORDER_PRODUCT_") {
			idStr := strings.TrimPrefix(payload, "ORDER_PRODUCT_")
			if pid, err := strconv.Atoi(idStr); err == nil {
				if !checkBusinessHours(userID) {
					return
				}
				if p, err := models.GetProductByID(configs.DB, pid); err == nil && p != nil {
					emoji := "🍰"
					switch strings.ToLower(p.Category) {
					case "cakes":
						emoji = "🎂"
					case "cupcakes":
						emoji = "🧁"
					case "coffee":
						emoji = "☕"
					case "bread":
						emoji = "🍞"
					case "muffins":
						emoji = "🧁"
					case "tarts":
						emoji = "🥧"
					case "pastries":
						emoji = "🥐"
					}
					state.CurrentProduct = p.Name
					state.CurrentEmoji = emoji
					state.State = "awaiting_quantity"
					SendTypingIndicator(userID, true)
					SendMessage(userID, "Please use the order form to select quantity. Tap 'Order' button!")
					ShowWebviewOrderForm(userID)
					return
				}
			}
		}

		// Quick add by product ID (dynamic)
		if strings.HasPrefix(payload, "QUICK_ADD_PRODUCT_") {
			idStr := strings.TrimPrefix(payload, "QUICK_ADD_PRODUCT_")
			if pid, err := strconv.Atoi(idStr); err == nil {
				handleQuickAddProductByID(userID, pid)
				return
			}
		}

		// Quick add/view from webview
		if strings.HasPrefix(payload, "QUICK_ADD_") {
			productKey := strings.TrimPrefix(payload, "QUICK_ADD_")
			handleQuickAddProduct(userID, productKey)
			return
		}

		if strings.HasPrefix(payload, "QUICK_VIEW_") {
			productKey := strings.TrimPrefix(payload, "QUICK_VIEW_")
			handleQuickAddProduct(userID, productKey)
			return
		}

		// Check for dynamic payloads (REORDER_123, RATE_ORDER_123)
		if strings.HasPrefix(payload, "REORDER_") {
			orderIDStr := strings.TrimPrefix(payload, "REORDER_")
			if orderID, err := strconv.Atoi(orderIDStr); err == nil {
				if !checkBusinessHours(userID) {
					return
				}
				handleReorder(userID, orderID)
				return
			}
		}

		if strings.HasPrefix(payload, "RATE_ORDER_") {
			orderIDStr := strings.TrimPrefix(payload, "RATE_ORDER_")
			if orderID, err := strconv.Atoi(orderIDStr); err == nil {
				askForRating(userID, orderID)
				return
			}
		}

		// Rate a specific product (RATE_PRODUCT_123)
		if strings.HasPrefix(payload, "RATE_PRODUCT_") {
			productIDStr := strings.TrimPrefix(payload, "RATE_PRODUCT_")
			if productID, err := strconv.Atoi(productIDStr); err == nil {
				showProductRatingOptions(userID, productID)
				return
			}
		}

		// Rate product from order (RATE_PRODUCT_ORDER_123_456 = productID_orderID)
		if strings.HasPrefix(payload, "RATE_PRODUCT_ORDER_") {
			parts := strings.Split(strings.TrimPrefix(payload, "RATE_PRODUCT_ORDER_"), "_")
			if len(parts) == 2 {
				if productID, err1 := strconv.Atoi(parts[0]); err1 == nil {
					if orderID, err2 := strconv.Atoi(parts[1]); err2 == nil {
						askForProductRating(userID, productID, orderID)
						return
					}
				}
			}
		}

		// View cart for a specific order (VIEW_CART_123)
		if strings.HasPrefix(payload, "VIEW_CART_") {
			ShowWebviewOrderForm(userID)
			return
		}

		// Track specific order by ID (TRACK_ORDER_123)
		if strings.HasPrefix(payload, "TRACK_ORDER_") {
			orderIDStr := strings.TrimPrefix(payload, "TRACK_ORDER_")
			if orderID, err := strconv.Atoi(orderIDStr); err == nil {
				showOrderTracking(userID, orderID)
				return
			}
		}

		SendMessage(userID, "Sorry, I didn't understand that. Let's start over!")
		ResetUserState(userID)
	}
}
