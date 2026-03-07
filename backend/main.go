package main

import (
	"bakeflow/configs"
	"bakeflow/controllers"
	"bakeflow/routes"
	"log"
	"net"
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

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// ⚡ Bind the port IMMEDIATELY so Render detects it right away.
	// Render (and similar PaaS) scan for an open port within a short timeout window.
	// We must bind the port BEFORE any slow operations (DB connect, API calls).
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "address already in use") {
			log.Fatalf("❌ Server failed to start: %v\n\nPort %s is already in use. Either stop the process using it, or run BakeFlow on a different port by setting PORT (e.g. PORT=8081).", err, port)
		}
		log.Fatalf("❌ Server failed to start: %v", err)
	}
	log.Printf("🚀 Port %s is now open and listening!", port)

	// Connect to database (may take a few seconds for Neon cold-start)
	configs.ConnectDB()

	// Setup HTTP routes with middleware
	router := routes.SetupRoutes()

	// Run non-critical setup tasks in the background.
	go func() {
		// Setup Facebook Messenger Persistent Menu
		log.Println("⚙️  Setting up Facebook Messenger features...")
		controllers.SetupPersistentMenu()
		controllers.SetupGetStartedButton()
		log.Println("✅ Facebook Messenger setup complete")

		// Start background stock cleanup job (releases expired reservations)
		log.Println("⚙️  Starting stock reservation cleanup job...")
		controllers.StartStockCleanupJob(1 * time.Minute)
		log.Println("✅ Stock cleanup job started (runs every minute)")
	}()

	// Serve HTTP on the already-open listener
	log.Printf("🚀 Server ready and serving on port %s", port)
	if err := http.Serve(listener, router); err != nil {
		log.Fatalf("❌ Server failed: %v", err)
	}
}
