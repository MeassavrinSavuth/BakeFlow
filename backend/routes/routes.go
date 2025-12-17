package routes

import (
	"bakeflow/configs"
	"bakeflow/controllers"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

// LoggingMiddleware logs all incoming requests (useful for debugging webhook issues)
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		log.Printf("➡️  %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
		
		// Call the next handler
		next.ServeHTTP(w, r)
		
		log.Printf("⬅️  Completed in %v", time.Since(start))
	})
}

// CORSMiddleware adds CORS headers to allow cross-origin requests
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

func SetupRoutes() http.Handler {
	// Use gorilla/mux for better routing with path parameters
	router := mux.NewRouter()

	// Health check endpoint (useful for monitoring)
	router.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("BakeFlow Bot is running! ✅"))
	}).Methods("GET")

	// Serve static HTML for webview order form
	router.HandleFunc("/order-form.html", func(w http.ResponseWriter, r *http.Request) {
		// Path is relative to where you run 'go run main.go' (backend directory)
		http.ServeFile(w, r, "../frontend/public/order-form.html")
	}).Methods("GET")

	// Messenger webhook endpoint
	// GET: Facebook verification
	// POST: Receive messages from users
	router.HandleFunc("/webhook", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			controllers.VerifyWebhook(w, r)
		} else if r.Method == "POST" {
			controllers.ReceiveWebhook(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Orders API
	router.HandleFunc("/orders", controllers.GetOrders).Methods("GET")
	
	// Chat Order API (from webview)
	router.HandleFunc("/api/chat/orders", controllers.CreateChatOrder).Methods("POST", "OPTIONS")
	
	// Admin API Routes - Orders
	router.HandleFunc("/api/admin/orders", controllers.AdminGetOrders).Methods("GET")
	router.HandleFunc("/api/admin/orders/{id}/status", controllers.AdminUpdateOrderStatus).Methods("PUT", "OPTIONS")

	// Admin API Routes - Products
	productController := &controllers.ProductController{DB: configs.DB}
	
	// Product CRUD
	router.HandleFunc("/api/products", productController.GetProducts).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/products", productController.CreateProduct).Methods("POST", "OPTIONS")

	// Dev helper: Seed sample products if DB is empty (place BEFORE {id} routes to avoid conflicts)
	router.HandleFunc("/api/products/seed", productController.SeedProducts).Methods("GET", "OPTIONS")

	// Debug info for diagnosing product visibility
	router.HandleFunc("/api/products/debug", productController.DebugProducts).Methods("GET", "OPTIONS")

	// Use regex to ensure {id} is numeric, preventing collisions with static paths like /seed
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.GetProduct).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.UpdateProduct).Methods("PUT", "OPTIONS")
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.DeleteProduct).Methods("DELETE", "OPTIONS")
	
	// Product Status (numeric id)
	router.HandleFunc("/api/products/{id:[0-9]+}/status", productController.UpdateProductStatus).Methods("PATCH", "OPTIONS")
	
	// Product Logs
	router.HandleFunc("/api/products/{id}/logs", productController.GetProductLogs).Methods("GET", "OPTIONS")
	
	// Product Alerts
	router.HandleFunc("/api/products/low-stock", productController.GetLowStockProducts).Methods("GET", "OPTIONS")

	// (Moved above to avoid route conflicts)

	// Wrap with middleware
	handler := LoggingMiddleware(router)
	handler = CORSMiddleware(handler)

	return handler
}
