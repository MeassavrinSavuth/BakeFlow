package controllers

import "sync"

// CartItem represents a single item in the shopping cart
type CartItem struct {
	Product      string
	ProductEmoji string
	Quantity     int
}

// UserState tracks the conversation state for each user
type UserState struct {
	State           string     // language_selection, greeting, awaiting_product, awaiting_quantity, awaiting_name, awaiting_delivery_type, awaiting_address, confirming
	Language        string     // "en" or "my" (Myanmar/Burmese)
	CurrentProduct  string     // Temporarily stores product being added
	CurrentEmoji    string     // Temporarily stores emoji for current product
	CurrentQuantity int        // Temporarily stores quantity for current product
	Cart            []CartItem // Shopping cart with multiple items
	CustomerName    string
	DeliveryType    string // "pickup" or "delivery"
	Address         string
}

// Product represents a bakery product with image
type Product struct {
	Name        string
	Emoji       string
	Description string
	ImageURL    string
	Price       string
}

// Product catalog with images
var ProductCatalog = map[string]Product{
	"Chocolate Cake": {
		Name:        "Chocolate Cake",
		Emoji:       "🍫",
		Description: "Rich, moist chocolate cake",
		ImageURL:    "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400",
		Price:       "$25.00",
	},
	"Vanilla Cake": {
		Name:        "Vanilla Cake",
		Emoji:       "🎂",
		Description: "Classic vanilla layer cake",
		ImageURL:    "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=400",
		Price:       "$24.00",
	},
	"Red Velvet Cake": {
		Name:        "Red Velvet Cake",
		Emoji:       "❤️",
		Description: "Smooth red velvet with cream cheese",
		ImageURL:    "https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?w=400",
		Price:       "$28.00",
	},
	"Croissant": {
		Name:        "Croissant",
		Emoji:       "🥐",
		Description: "Buttery, flaky croissant",
		ImageURL:    "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400",
		Price:       "$4.50",
	},
	"Cinnamon Roll": {
		Name:        "Cinnamon Roll",
		Emoji:       "🥯",
		Description: "Sweet cinnamon roll with glaze",
		ImageURL:    "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400",
		Price:       "$5.00",
	},
	"Chocolate Cupcake": {
		Name:        "Chocolate Cupcake",
		Emoji:       "🧁",
		Description: "Chocolate cupcake with frosting",
		ImageURL:    "https://images.unsplash.com/photo-1614707267537-b85aaf00c4b7?w=400",
		Price:       "$3.50",
	},
	"Coffee": {
		Name:        "Coffee",
		Emoji:       "☕",
		Description: "Freshly brewed coffee",
		ImageURL:    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400",
		Price:       "$5.00",
	},
	"Bread": {
		Name:        "Bread",
		Emoji:       "🍞",
		Description: "Fresh artisan bread loaf",
		ImageURL:    "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400",
		Price:       "$6.00",
	},
}

// In-memory state store (use Redis or DB in production for persistence)
var (
	UserStates = make(map[string]*UserState)
	StateMutex sync.RWMutex
)

// QuickReply represents a quick reply button
type QuickReply struct {
	ContentType string `json:"content_type"`
	Title       string `json:"title"`
	Payload     string `json:"payload"`
}

// Generic Template structures for image cards
type GenericTemplate struct {
	TemplateType string    `json:"template_type"`
	Elements     []Element `json:"elements"`
}

type Element struct {
	Title    string   `json:"title"`
	ImageURL string   `json:"image_url"`
	Subtitle string   `json:"subtitle"`
	Buttons  []Button `json:"buttons"`
}

type Button struct {
	Type                string `json:"type"`
	Title               string `json:"title"`
	Payload             string `json:"payload,omitempty"`
	URL                 string `json:"url,omitempty"`
	WebviewHeightRatio  string `json:"webview_height_ratio,omitempty"`
	MessengerExtensions bool   `json:"messenger_extensions,omitempty"`
}

// Webhook payload structures
type WebhookPayload struct {
	Object string  `json:"object"`
	Entry  []Entry `json:"entry"`
}

type Entry struct {
	ID        string      `json:"id"`
	Time      int64       `json:"time"`
	Messaging []Messaging `json:"messaging"`
}

type Messaging struct {
	Sender    User     `json:"sender"`
	Recipient User     `json:"recipient"`
	Timestamp int64    `json:"timestamp"`
	Message   Message  `json:"message"`
	Postback  Postback `json:"postback"`
}

type User struct {
	ID string `json:"id"`
}

type Message struct {
	Mid        string             `json:"mid"`
	Text       string             `json:"text"`
	QuickReply *QuickReplyPayload `json:"quick_reply,omitempty"`
}

type QuickReplyPayload struct {
	Payload string `json:"payload"`
}

type Postback struct {
	Payload string `json:"payload"`
}

// Helper functions for state management
func GetUserState(userID string) *UserState {
	StateMutex.Lock()
	defer StateMutex.Unlock()

	if UserStates[userID] == nil {
		UserStates[userID] = &UserState{State: "language_selection"}
	}
	return UserStates[userID]
}

func ResetUserState(userID string) {
	StateMutex.Lock()
	defer StateMutex.Unlock()
	delete(UserStates, userID)
}
