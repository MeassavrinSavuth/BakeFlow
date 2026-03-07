package main

import (
	"bakeflow/configs"
	"bakeflow/controllers"
	"bakeflow/routes"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables from .env file
	// IMPORTANT: .env must be in the same directory as main.go
	err := godotenv.Load()
	if err != nil {
		log.Println("⚠️  Warning: Error loading .env file")
		log.Println("   Make sure .env exists in the backend/ directory")
		// Don't exit - might be using system environment variables
	} else {
		log.Println("✅ .env file loaded successfully")
	}

	// Minimal startup checks: warn if critical env vars are missing
	if os.Getenv("VERIFY_TOKEN") == "" {
		log.Println("WARNING: VERIFY_TOKEN is not set")
	}
	if os.Getenv("PAGE_ACCESS_TOKEN") == "" {
		log.Println("WARNING: PAGE_ACCESS_TOKEN is not set")
	}

	// Connect to database
	configs.ConnectDB()

	// Setup HTTP routes with middleware
	router := routes.SetupRoutes()

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Run non-critical setup tasks in the background so the port opens immediately.
	// Render (and similar PaaS) require the port to be bound quickly or they
	// consider the deploy failed.
	go func() {
		// Setup Facebook Messenger Persistent Menu
		log.Println("⚙️  Setting up Facebook Messenger features...")
		controllers.SetupPersistentMenu()
		controllers.SetupGetStartedButton()
		// Note: SetupGreetingText() disabled as Facebook's newer API requires additional parameters
		// controllers.SetupGreetingText()
		log.Println("✅ Facebook Messenger setup complete")

		// Start background stock cleanup job (releases expired reservations)
		log.Println("⚙️  Starting stock reservation cleanup job...")
		controllers.StartStockCleanupJob(1 * time.Minute)
		log.Println("✅ Stock cleanup job started (runs every minute)")
	}()

	// Start the server — must happen quickly so Render detects the open port
	log.Printf("🚀 Server starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "address already in use") {
			log.Fatalf("❌ Server failed to start: %v\n\nPort %s is already in use. Either stop the process using it, or run BakeFlow on a different port by setting PORT (e.g. PORT=8081).", err, port)
		}
		log.Fatalf("❌ Server failed to start: %v", err)
	}
}
