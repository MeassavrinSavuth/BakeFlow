package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ReceiptElement represents an item in the receipt
type ReceiptElement struct {
	Title    string  `json:"title"`
	Subtitle string  `json:"subtitle,omitempty"`
	Quantity int     `json:"quantity,omitempty"`
	Price    float64 `json:"price"`
	Currency string  `json:"currency,omitempty"`
	ImageURL string  `json:"image_url,omitempty"`
}

// ReceiptAddress represents the shipping address
type ReceiptAddress struct {
	Street1    string `json:"street_1"`
	Street2    string `json:"street_2,omitempty"`
	City       string `json:"city"`
	PostalCode string `json:"postal_code,omitempty"`
	State      string `json:"state"`
	Country    string `json:"country"`
}

// ReceiptSummary represents the order summary
type ReceiptSummary struct {
	Subtotal     float64 `json:"subtotal,omitempty"`
	ShippingCost float64 `json:"shipping_cost,omitempty"`
	TotalTax     float64 `json:"total_tax,omitempty"`
	TotalCost    float64 `json:"total_cost"`
}

// ReceiptAdjustment represents discounts
type ReceiptAdjustment struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

// SendReceiptTemplate sends a beautiful receipt card to user
func SendReceiptTemplate(recipientID string, orderID int, customerName string, items []ReceiptElement, address *ReceiptAddress, summary ReceiptSummary, orderURL string, paymentMethod string) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	if strings.TrimSpace(paymentMethod) == "" {
		paymentMethod = "Paid"
	}
	receiptPayload := map[string]interface{}{
		"template_type":  "receipt",
		"recipient_name": customerName,
		"order_number":   fmt.Sprintf("BF-%d", orderID),
		"currency":       "MMK",
		"payment_method": paymentMethod,
		"timestamp":      time.Now().Unix(),
		"elements":       items,
		"summary":        summary,
		"sharable":       true,
	}

	// Add address if delivery
	if address != nil {
		receiptPayload["address"] = address
	}

	// Add order URL if provided
	if orderURL != "" {
		receiptPayload["order_url"] = orderURL
	}

	payload := map[string]interface{}{
		"recipient": map[string]string{"id": recipientID},
		"message": map[string]interface{}{
			"attachment": map[string]interface{}{
				"type":    "template",
				"payload": receiptPayload,
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending receipt template: %s", string(body))
		return fmt.Errorf("failed to send receipt template: %s", string(body))
	}

	log.Printf("✅ Receipt template sent to %s for order #%d", recipientID, orderID)
	return nil
}

// SendOrderCard sends a generic template card for order status updates
func SendOrderCard(recipientID string, orderID int, title string, subtitle string, imageURL string, buttons []Button) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	element := map[string]interface{}{
		"title":    title,
		"subtitle": subtitle,
	}

	if imageURL != "" {
		element["image_url"] = imageURL
	}

	if len(buttons) > 0 {
		element["buttons"] = buttons
	}

	payload := map[string]interface{}{
		"recipient": map[string]string{"id": recipientID},
		"message": map[string]interface{}{
			"attachment": map[string]interface{}{
				"type": "template",
				"payload": map[string]interface{}{
					"template_type": "generic",
					"elements":      []map[string]interface{}{element},
				},
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending order card: %s", string(body))
		return fmt.Errorf("failed to send order card: %s", string(body))
	}

	log.Printf("✅ Order card sent to %s", recipientID)
	return nil
}

// SendOrderCardWithTag sends a generic template card with a specific Messenger tag
// Useful for sending messages outside the 24-hour window (e.g., POST_PURCHASE_UPDATE)
func SendOrderCardWithTag(recipientID string, orderID int, title string, subtitle string, imageURL string, buttons []Button, tag string) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	element := map[string]interface{}{
		"title":    title,
		"subtitle": subtitle,
	}

	if imageURL != "" {
		element["image_url"] = imageURL
	}

	if len(buttons) > 0 {
		element["buttons"] = buttons
	}

	payload := map[string]interface{}{
		"recipient":      map[string]string{"id": recipientID},
		"messaging_type": "MESSAGE_TAG",
		"tag":            tag,
		"message": map[string]interface{}{
			"attachment": map[string]interface{}{
				"type": "template",
				"payload": map[string]interface{}{
					"template_type": "generic",
					"elements":      []map[string]interface{}{element},
				},
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending order card (tag=%s): %s", tag, string(body))
		return fmt.Errorf("failed to send order card: %s", string(body))
	}

	log.Printf("✅ Order card (tag=%s) sent to %s", tag, recipientID)
	return nil
}

// SendMessage sends a text message to a user via Messenger API
func SendMessage(recipientID, messageText string) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	// Construct the message payload
	payload := map[string]interface{}{
		"recipient": map[string]string{"id": recipientID},
		"message":   map[string]string{"text": messageText},
	}

	payloadBytes, _ := json.Marshal(payload)

	// Send to Facebook Graph API
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending message: %s", string(body))
		return fmt.Errorf("failed to send message: %s", string(body))
	}

	log.Printf("✅ Message sent to %s", recipientID)
	return nil
}

// SendMessageWithTag sends a text message with a specific Messenger tag
// e.g., tag = "POST_PURCHASE_UPDATE" for transaction-related updates outside 24h window
func SendMessageWithTag(recipientID, messageText, tag string) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	// Construct the message payload
	payload := map[string]interface{}{
		"recipient":      map[string]string{"id": recipientID},
		"messaging_type": "MESSAGE_TAG",
		"tag":            tag,
		"message":        map[string]string{"text": messageText},
	}

	payloadBytes, _ := json.Marshal(payload)

	// Send to Facebook Graph API
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending tagged message (tag=%s): %s", tag, string(body))
		return fmt.Errorf("failed to send message: %s", string(body))
	}

	log.Printf("✅ Tagged message (tag=%s) sent to %s", tag, recipientID)
	return nil
}

// SendQuickReplies sends a message with quick reply buttons
func SendQuickReplies(recipientID, messageText string, quickReplies []QuickReply) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	payload := map[string]interface{}{
		"recipient": map[string]string{"id": recipientID},
		"message": map[string]interface{}{
			"text":          messageText,
			"quick_replies": quickReplies,
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		if strings.Contains(bodyStr, "outside of allowed window") || strings.Contains(bodyStr, "2018278") {
			log.Printf("⚠️ Quick replies not sent (outside window) to %s: %s", recipientID, bodyStr)
		} else {
			log.Printf("❌ Error sending quick replies: %s", bodyStr)
		}
		return fmt.Errorf("failed to send quick replies: %s", bodyStr)
	}

	log.Printf("✅ Quick replies sent to %s", recipientID)
	return nil
}

// SendTypingIndicator shows typing indicator for better UX
func SendTypingIndicator(recipientID string, on bool) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	action := "typing_off"
	if on {
		action = "typing_on"
	}

	payload := map[string]interface{}{
		"recipient":     map[string]string{"id": recipientID},
		"sender_action": action,
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	return nil
}

// SendGenericTemplate sends image-based product cards (carousel)
func SendGenericTemplate(recipientID string, elements []Element) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set in .env")
	}

	payload := map[string]interface{}{
		"recipient": map[string]string{"id": recipientID},
		"message": map[string]interface{}{
			"attachment": map[string]interface{}{
				"type": "template",
				"payload": GenericTemplate{
					TemplateType: "generic",
					Elements:     elements,
				},
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ Error sending generic template: %s", string(body))
		return fmt.Errorf("failed to send generic template: %s", string(body))
	}

	log.Printf("✅ Generic template sent to %s", recipientID)
	return nil
}
