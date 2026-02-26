package controllers

import (
	"database/sql"

	"bakeflow/models"
)

// handleMessage is kept for webhook compatibility but disabled for webview-only mode
func handleMessage(userID, messageText string) {
	// Chat-based ordering has been removed
	// Only webview form ordering is supported
	// Send intro message with webview button instead of plain text
	ShowWebviewOrderForm(userID)
}

func confirmMessengerVerification(userID string) bool {
	pending, err := models.HasPendingMessengerVerification(userID)
	if err != nil {
		SendMessage(userID, "Sorry, something went wrong. Please try again later.")
		return true
	}
	if !pending {
		return false
	}
	if err := models.MarkMessengerVerificationConfirmed(userID); err != nil {
		SendMessage(userID, "Sorry, something went wrong. Please try again later.")
		return true
	}
	if err := models.SetCustomerVerification(userID, true, "messenger_confirmed", sql.NullInt64{Valid: false}); err != nil {
		SendMessage(userID, "Sorry, something went wrong. Please try again later.")
		return true
	}
	_ = models.LogAdminAction(userID, "verify_customer_messenger_confirmed", "", map[string]interface{}{
		"channel": "messenger",
	}, sql.NullInt64{Valid: false})
	SendMessage(userID, "Thanks! Your account is verified. You can continue ordering as normal.")
	return true
}
