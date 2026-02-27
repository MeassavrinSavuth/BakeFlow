package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// ShowWebviewOrderForm sends a button that opens a web mini-app inside Messenger
func ShowWebviewOrderForm(userID string) {
	state := GetUserState(userID)

	// Build webview URL (opens inside Messenger)
	baseURL := resolveFrontendBaseURL()

	// Signed token binds this webview session to the Messenger PSID.
	// NOTE: Requires WEBVIEW_TOKEN_SECRET to be set.
	// Keep TTL short to reduce replay risk if the URL is shared.
	// Override via WEBVIEW_TOKEN_TTL_HOURS (default 24h).
	ttl := 24 * time.Hour
	if s := strings.TrimSpace(os.Getenv("WEBVIEW_TOKEN_TTL_HOURS")); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			if n > 0 && n <= 720 { // cap at 30 days
				ttl = time.Duration(n) * time.Hour
			}
		}
	}

	tok, err := GenerateWebviewToken(userID, ttl)
	if err != nil {
		log.Printf("⚠️  WEBVIEW_TOKEN_SECRET not configured; falling back to user_id in URL: %v", err)
	}
	webviewURL := fmt.Sprintf("%s/order-form.html?user_id=%s&v=6", baseURL, userID)
	if tok != "" {
		webviewURL = fmt.Sprintf("%s&t=%s", webviewURL, tok)
	}

	msg := "🍰 Welcome to Homemade Homebake!\n\nDon't hesitate to contact us if you have any questions.\n📞 +95 9123456789"
	if state.Language == "my" {
		msg = "🍰 Homemade Homebake သို့ ကြိုဆိုပါသည်!\n\nမည်သည့် မေးခွန်းများ ရှိလျှင် ကျပ်တွင် ဆက်သွယ်နိုင်ပါသည်။\n📞 +95 9123456789"
	}

	useExtensions := true
	if s := strings.TrimSpace(os.Getenv("WEBVIEW_MESSENGER_EXTENSIONS")); s != "" {
		switch strings.ToLower(s) {
		case "0", "false", "no":
			useExtensions = false
		}
	}
	if u, err := url.Parse(baseURL); err != nil || u.Scheme != "https" || u.Host == "" {
		useExtensions = false
	}

	// Create button that opens webview INSIDE Messenger
	// Using full height as per Facebook documentation
	buttons := []Button{
		{
			Type:                "web_url",
			Title:               "🛒 Open Menu",
			URL:                 webviewURL,
			MessengerExtensions: useExtensions,
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
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages?access_token=%s", pageAccessToken)

	resp, err := http.Post(url, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("❌ Error sending button template: %v", err)
		return err
	}
	defer resp.Body.Close()

	// Avoid logging full payload because it may contain sensitive webview URLs/tokens.

	if resp.StatusCode != http.StatusOK {
		respBody := make([]byte, 1024)
		resp.Body.Read(respBody)
		log.Printf("❌ Facebook API error: %d - %s", resp.StatusCode, string(respBody))
		return fmt.Errorf("facebook API error: %d", resp.StatusCode)
	}

	log.Printf("✅ Button template sent to %s", userID)
	return nil
}
