package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// SetupPersistentMenu creates a persistent menu (hamburger menu) in Messenger
// This menu appears in the bottom-left corner of the chat
func SetupPersistentMenu() error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set")
	}

	// Define menu for English users (Max 3 items per Facebook's limit)
	menuEN := map[string]interface{}{
		"locale":                  "default",
		"composer_input_disabled": false,
		"call_to_actions": []map[string]interface{}{
			{
				"type":    "postback",
				"title":   "🛒 Order Now",
				"payload": "MENU_ORDER",
			},
			{
				"type":    "postback",
				"title":   "ℹ️ About & Help",
				"payload": "MENU_ABOUT",
			},
		},
	}

	// Define menu for Myanmar/Burmese users (Max 3 items per Facebook's limit)
	menuMY := map[string]interface{}{
		"locale":                  "my_MM",
		"composer_input_disabled": false,
		"call_to_actions": []map[string]interface{}{
			{
				"type":    "postback",
				"title":   "🛒 အော်ဒါမှာမယ်",
				"payload": "MENU_ORDER",
			},
			{
				"type":    "postback",
				"title":   "ℹ️ အကြောင်းနှင့်အကူအညီ",
				"payload": "MENU_ABOUT",
			},
		},
	}

	payload := map[string]interface{}{
		"persistent_menu": []map[string]interface{}{
			menuEN,
			menuMY,
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messenger_profile?access_token=%s", pageAccessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Failed to set persistent menu: %s", string(body))
		return fmt.Errorf("failed to set persistent menu: %s", string(body))
	}

	log.Println("✅ Persistent menu set successfully!")
	return nil
}

// SetupGetStartedButton sets the "Get Started" button for new conversations
func SetupGetStartedButton() error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set")
	}

	payload := map[string]interface{}{
		"get_started": map[string]string{
			"payload": "GET_STARTED",
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messenger_profile?access_token=%s", pageAccessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Failed to set Get Started button: %s", string(body))
		return fmt.Errorf("failed to set Get Started button: %s", string(body))
	}

	log.Println("✅ Get Started button set successfully!")
	return nil
}

// SetupGreetingText sets the greeting text shown before user starts conversation
func SetupGreetingText() error {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return fmt.Errorf("PAGE_ACCESS_TOKEN not set")
	}

	payload := map[string]interface{}{
		"greeting": []map[string]interface{}{
			{
				"locale": "default",
				"text":   "Hi! 👋 Welcome to BakeFlow! Click 'Get Started' to begin ordering delicious cakes and pastries! 🍰",
			},
			{
				"locale": "my_MM",
				"text":   "မင်္ဂလာပါ! 👋 BakeFlow မှ ကြိုဆိုပါတယ်! စတင်ရန် 'Get Started' ကို နှိပ်ပြီး အရသာရှိတဲ့ ကိတ်မုန့်တွေ မှာယူပါ! 🍰",
			},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messenger_profile?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		bodyStr := string(body)
		// Recent Graph/Messenger Profile API responses may reject the 'greeting' field entirely.
		// In that case, treat it as a non-fatal capability mismatch (the bot can still send a
		// welcome message after GET_STARTED).
		if strings.Contains(bodyStr, "Requires one of the params") {
			log.Printf("⚠️  Skipping greeting text setup (Graph API rejected 'greeting'): %s", bodyStr)
			return nil
		}
		log.Printf("❌ Failed to set greeting text: %s", bodyStr)
		return fmt.Errorf("failed to set greeting text: %s", bodyStr)
	}

	log.Println("✅ Greeting text set successfully!")
	return nil
}
