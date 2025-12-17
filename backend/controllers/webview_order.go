package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

// ShowWebviewOrderForm sends a button that opens a web mini-app inside Messenger
func ShowWebviewOrderForm(userID string) {
	state := GetUserState(userID)

	// Build webview URL (this will open inside Messenger)
	// TODO: Replace with your ngrok URL for testing or production domain
	webviewURL := fmt.Sprintf("https://consuelo-subcardinal-nonfallaciously.ngrok-free.dev/order-form.html?user_id=%s", userID)

	msg := "🍰 Order from our mini shop!"
	if state.Language == "my" {
		msg = "🍰 ကျွန်ုပ်တို့၏ စတိုးအသေးမှ မှာယူပါ!"
	}

	// Create button that opens webview INSIDE Messenger
	// Using full height as per Facebook documentation
	buttons := []Button{
		{
			Type:                "web_url",
			Title:               "🛒 Open Menu",
			URL:                 webviewURL,
			MessengerExtensions: true,
			WebviewHeightRatio:  "full",
		},
	}

	// Send button template
	log.Printf("🔧 DEBUG: Button config - MessengerExtensions: %v, Height: %s", buttons[0].MessengerExtensions, buttons[0].WebviewHeightRatio)
	SendButtonTemplate(userID, msg, buttons)
}

// SendButtonTemplate sends a message with buttons
func SendButtonTemplate(userID, text string, buttons []Button) error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		log.Println("❌ PAGE_ACCESS_TOKEN not set")
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set")
	}

	payload := map[string]interface{}{
		"recipient": map[string]string{"id": userID},
		"message": map[string]interface{}{
			"attachment": map[string]interface{}{
				"type": "template",
				"payload": map[string]interface{}{
					"template_type": "button",
					"text":          text,
					"buttons":       buttons,
				},
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	log.Printf("🔍 FULL PAYLOAD: %s", string(payloadBytes))
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("❌ Error sending button template: %v", err)
		return err
	}
	defer resp.Body.Close()

	// Read response body for debugging
	bodyBytes, _ := json.Marshal(payload)
	log.Printf("📤 Sent payload: %s", string(bodyBytes))

	if resp.StatusCode != http.StatusOK {
		respBody := make([]byte, 1024)
		resp.Body.Read(respBody)
		log.Printf("❌ Facebook API error: %d - %s", resp.StatusCode, string(respBody))
		return fmt.Errorf("facebook API error: %d", resp.StatusCode)
	}

	log.Printf("✅ Button template sent to %s", userID)
	return nil
}
