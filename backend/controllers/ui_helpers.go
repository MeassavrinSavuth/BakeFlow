package controllers

import (
	"bakeflow/configs"
	"bakeflow/models"
	"fmt"
	"strings"
)

// getProductElements returns product carousel elements from the database
func getProductElements() []Element {
	products, err := models.GetActiveProducts(configs.DB, 10, 0, "", "")
	if err != nil {
		return []Element{}
	}
	var elements []Element
	for _, p := range products {
		price := fmt.Sprintf("$%.2f", p.Price)
		img := p.ImageURL
		if img == "" {
			img = "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop"
		}
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

		// Get product rating
		avgRating, ratingCount, _ := models.GetProductAvgRating(p.ID)
		ratingText := ""
		if ratingCount > 0 {
			stars := strings.Repeat("⭐", int(avgRating))
			ratingText = fmt.Sprintf("\n%s %.1f (%d reviews)", stars, avgRating, ratingCount)
		} else {
			ratingText = "\n⭐ No ratings yet"
		}

		subtitle := fmt.Sprintf("%s • %s%s", p.Description, price, ratingText)

		// Add buttons: Order and Rate
		buttons := []Button{
			{Type: "postback", Title: "🛒 Order", Payload: fmt.Sprintf("ORDER_PRODUCT_%d", p.ID)},
			{Type: "postback", Title: "⭐ Rate", Payload: fmt.Sprintf("RATE_PRODUCT_%d", p.ID)},
		}

		elements = append(elements, Element{
			Title:    emoji + " " + p.Name,
			ImageURL: img,
			Subtitle: subtitle,
			Buttons:  buttons,
		})
	}
	return elements
}

// showAbout displays company information and help instructions in user's language
func showAbout(userID string) {
	state := GetUserState(userID)
	var aboutMsg, helpMsg string

	if state.Language == "my" {
		aboutMsg = "🏪 ကျွန်ုပ်တို့အကြောင်း\n\n" +
			"Homemade Homebake သည် လတ်ဆတ်သော မုန့်များကို နေ့စဉ် ဖုတ်လုပ်သော မုန့်ဆိုင်ဖြစ်ပါသည်။\n\n" +
			"📍 တည်နေရာ: ရန်ကုန်မြို့\n" +
			"⏰ ဖွင့်ချိန်: နံနက် 8:00 - ညနေ 8:00\n" +
			"📞 ဆက်သွယ်ရန်: +95 9 XXX XXX XXX"

		helpMsg = "\n\n❓ အသုံးပြုနည်း\n\n" +
			"🛒 အော်ဒါမှာရန် 'Order' ခလုတ်ကို တို့ခြင်းပြီး ဝက်ဗြူ ဖောင်မ အသုံးပြုပါ!"
	} else {
		aboutMsg = "🏪 About Us\n\n" +
			"Homemade Homebake is your neighborhood bakery, baking fresh daily!\n\n" +
			"📍 Location: Yangon, Myanmar\n" +
			"⏰ Hours: 8:00 AM - 8:00 PM\n" +
			"📞 Contact: +95 9 XXX XXX XXX"

		helpMsg = "\n\n❓ How to Use\n\n" +
			"🛒 To place an order, tap the 'Order' button and use the web form!"
	}

	SendMessage(userID, aboutMsg+helpMsg)
}

// showLanguageSelection shows language choice at the beginning
func showLanguageSelection(userID string) {
	state := GetUserState(userID)
	state.State = "language_selection"

	welcomeMsg := "Hi there! 👋 မင်္ဂလာပါ! 👋\n\n" +
		"I'm BakeFlow Bot, your virtual bakery assistant (Beta). " +
		"I'm still learning, so I might not have all the answers yet, but I'll try to assist you the best I can! 🍰\n\n" +
		"ကျွန်တော် BakeFlow Bot ပါ၊ သင့်ရဲ့ မုန့်ဆိုင် အကူအညီပေး စက်ရုပ်ပါ (စမ်းသပ်ဗားရှင်း)။ " +
		"ကျွန်တော် ယခုတော့ သင်ယူနေဆဲဖြစ်တဲ့အတွက် အားလုံးကို မဖြေနိုင်သေးပေမယ့် တတ်နိုင်သမျှ အကောင်းဆုံး ကူညီပေးပါမယ်နော်! 🍰\n\n" +
		"Please select your language to get started.\n" +
		"စတင်ဖို့ ဘာသာစကားကို ရွေးချယ်ပါ။"

	SendMessage(userID, welcomeMsg)

	quickReplies := []QuickReply{
		{ContentType: "text", Title: "🇬🇧 English", Payload: "LANG_EN"},
		{ContentType: "text", Title: "🇲🇲 မြန်မာ", Payload: "LANG_MY"},
	}
	SendQuickReplies(userID, "Choose your language / ဘာသာစကား ရွေးပါ:", quickReplies)
}

// NOTE: Chat-based ordering functions (startOrderingFlow, showMainMenu, showProducts, askQuantity, askName, addToCart, askAddMore, showCart, showOrderSummary, showMenu) have been REMOVED.
// Only webview-based ordering is now supported. Users should tap "Order" button to use the web form.
