package controllers

import (
	"fmt"
	"log"
	"strings"

	"bakeflow/models"
)

// handleMessage processes text messages from users
// handleMessage moved to `message_handler.go`.

// handlePostback processes button clicks (postback payloads)
// Full implementation moved to `postback_handler.go`.

// showHelp displays help information
// showHelp displays ordering instructions
func showHelp(userID string) {
	ShowWebviewOrderForm(userID)
}

// showOrderHistory displays recent orders (mock implementation)
// goBack handles the "Go Back" navigation
func goBack(userID string) {
	// Chat-based ordering has been removed
	// All navigation now goes through webview form
	ShowWebviewOrderForm(userID)
}

// ========== NEW FEATURES ==========

// Business logic moved to `order_service.go`.

// showOrderHistory displays user's past orders with beautiful card design
func showOrderHistory(userID string) {
	// Get all orders (in future, filter by userID)
	orders, err := models.GetAllOrders()
	if err != nil {
		log.Printf("❌ Error fetching orders: %v", err)
		SendMessage(userID, "😞 Sorry, couldn't load your order history. Please try again later.")
		return
	}

	// Check if empty
	if len(orders) == 0 {
		state := GetUserState(userID)
		emptyMsg := "🛒 **No Orders Yet!**\n\n" +
			"You haven't placed any orders with us.\n\n" +
			"Ready to try our delicious baked goods?\n\n" +
			"Type 'menu' to start ordering! 🍰"

		if state.Language == "my" {
			emptyMsg = "🛒 **မှာထားမှုမရှိသေးပါ!**\n\n" +
				"သင် ကျွန်ုပ်တို့နှင့် မှာထားမှုမလုပ်ရသေးပါ။\n\n" +
				"ကျွန်ုပ်တို့ရဲ့ အရသာရှိတဲ့ မုန့်တွေကို စမ်းကြည့်ဖို့ အဆင်သင့်လား?\n\n" +
				"'မီနူး' လို့ရိုက်ပြီး မှာယူလိုက်ပါ! 🍰"
		}

		SendMessage(userID, emptyMsg)
		return
	}

	// Show recent orders as cards (limit to 5 most recent)
	displayOrders := orders
	if len(orders) > 5 {
		displayOrders = orders[:5]
	}

	var elements []Element
	for _, order := range displayOrders {
		// Build items list
		itemsList := ""
		for i, item := range order.Items {
			if i < 3 {
				emoji := "🍰"
				if product, exists := ProductCatalog[item.Product]; exists {
					emoji = product.Emoji
				}
				itemsList += fmt.Sprintf("%d× %s %s\n", item.Quantity, emoji, item.Product)
			}
		}
		if len(order.Items) > 3 {
			itemsList += fmt.Sprintf("...and %d more items\n", len(order.Items)-3)
		}

		// Status badge
		statusEmoji := "⏳"
		statusText := "Pending"
		switch order.Status {
		case "pending":
			statusEmoji = "⏳"
			statusText = "Pending"
		case "preparing":
			statusEmoji = "👨‍🍳"
			statusText = "Preparing"
		case "ready":
			statusEmoji = "✅"
			statusText = "Ready"
		case "delivered":
			statusEmoji = "🎉"
			statusText = "Delivered"
		case "completed":
			statusEmoji = "✔️"
			statusText = "Completed"
		}

		// Delivery icon
		deliveryIcon := "🏠"
		if order.DeliveryType == "delivery" {
			deliveryIcon = "🚚"
		}

		// Format date
		dateStr := order.CreatedAt.Format("Jan 2, 3:04 PM")

		// Build subtitle
		subtitle := fmt.Sprintf("%s %s • %s %s\n%s\nTotal: Ks %.2f",
			statusEmoji, statusText,
			deliveryIcon, strings.Title(order.DeliveryType),
			dateStr,
			order.TotalAmount)

		element := Element{
			Title:    fmt.Sprintf("Order #%d - %s", order.ID, order.CustomerName),
			Subtitle: subtitle + "\n\n" + itemsList,
			Buttons: []Button{
				{
					Type:    "postback",
					Title:   "🔄 Reorder",
					Payload: fmt.Sprintf("REORDER_%d", order.ID),
				},
				{
					Type:    "postback",
					Title:   "⭐ Rate",
					Payload: fmt.Sprintf("RATE_ORDER_%d", order.ID),
				},
			},
		}

		elements = append(elements, element)
	}

	SendMessage(userID, fmt.Sprintf("📋 **Your Recent Orders** (Showing %d of %d)", len(displayOrders), len(orders)))
	SendGenericTemplate(userID, elements)
}

// showOrderTracking displays the status of a specific order or the most recent one
// If orderID is 0, shows the most recent order
func showOrderTracking(userID string, orderID int) {
	var order *models.Order
	var err error

	if orderID > 0 {
		// Get specific order by ID
		order, err = models.GetOrderByID(orderID)
		if err != nil || order == nil {
			SendMessage(userID, "📦 Order not found.\n\nTap the button below to place an order!")
			SendQuickReplies(userID, "Would you like to order?", []QuickReply{
				{ContentType: "text", Title: "🛒 Order Now", Payload: "ORDER_NOW"},
			})
			return
		}
	} else {
		// Get the user's most recent order
		orders, err := models.GetRecentOrdersBySenderID(userID, 1)
		if err != nil || len(orders) == 0 {
			SendMessage(userID, "📦 No recent orders found.\n\nTap the button below to place an order!")
			SendQuickReplies(userID, "Would you like to order?", []QuickReply{
				{ContentType: "text", Title: "🛒 Order Now", Payload: "ORDER_NOW"},
			})
			return
		}
		order = &orders[0]
	}

	statusKey := strings.ToLower(strings.TrimSpace(order.Status))
	if statusKey == "" {
		statusKey = "pending"
	}

	itemSummary := "No items"
	if len(order.Items) > 0 {
		first := order.Items[0]
		itemSummary = fmt.Sprintf("%s × %d", first.Product, first.Quantity)
		if len(order.Items) > 1 {
			itemSummary = fmt.Sprintf("%s + %d more", itemSummary, len(order.Items)-1)
		}
	}

	progressLabels := map[string]string{
		"pending":    "Pending",
		"scheduled":  "Scheduled",
		"confirmed":  "Confirmed",
		"preparing":  "Preparing",
		"ready":      "Ready",
		"delivering": "Out for delivery",
		"delivered":  "Delivered",
		"completed":  "Delivered",
	}

	stepStatus := "pending"
	switch statusKey {
	case "pending", "confirmed", "scheduled":
		stepStatus = "pending"
	case "preparing":
		stepStatus = "preparing"
	case "ready", "delivering":
		if order.DeliveryType == "delivery" {
			stepStatus = "delivering"
		} else {
			stepStatus = "ready"
		}
	case "delivered":
		stepStatus = "delivered"
	}

	statusLabel := progressLabels[statusKey]
	if statusLabel == "" {
		statusLabel = progressLabels[stepStatus]
	}
	typeLabel := strings.Title(strings.TrimSpace(order.DeliveryType))
	if typeLabel == "" {
		typeLabel = "Pickup"
	}
	title := fmt.Sprintf("Order #BF-%d", order.ID)
	subtitle := fmt.Sprintf("%s • %s\n%s\nTotal: Ks %.2f\nProgress: %s", strings.Title(statusKey), typeLabel, itemSummary, order.TotalAmount, statusLabel)

	productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
	if len(order.Items) > 0 && strings.TrimSpace(order.Items[0].ImageURL) != "" {
		imgURL := strings.TrimSpace(order.Items[0].ImageURL)
		if strings.HasPrefix(imgURL, "https://") {
			productImage = imgURL
		}
	}

	var buttons []Button
	baseURL := resolveFrontendBaseURL()
	if baseURL != "" {
		detailsURL := fmt.Sprintf("%s/order-details.html?order_id=%d", baseURL, order.ID)
		buttons = append(buttons, Button{
			Type:                "web_url",
			Title:               "View Details",
			URL:                 detailsURL,
			WebviewHeightRatio:  "tall",
			MessengerExtensions: true,
		})
	}
	buttons = append(buttons, Button{Type: "postback", Title: "Need Help?", Payload: "CONTACT_SUPPORT"})

	if err := SendOrderCard(userID, order.ID, title, subtitle, productImage, buttons); err != nil {
		fallback := fmt.Sprintf("Order #BF-%d\n%s • %s\n%s\nTotal: Ks %.2f\nProgress: %s", order.ID, strings.Title(statusKey), typeLabel, itemSummary, order.TotalAmount, statusLabel)
		SendMessage(userID, fallback)
	}
}

// Rating handling moved to `order_service.go`.

// Business-hour checks moved to `order_service.go`.
