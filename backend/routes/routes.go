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

	// Serve static CSS files
	router.PathPrefix("/css/").Handler(http.StripPrefix("/css/", http.FileServer(http.Dir("../frontend/public/css"))))

	// Serve static JS files
	router.PathPrefix("/js/").Handler(http.StripPrefix("/js/", http.FileServer(http.Dir("../frontend/public/js"))))

	// Serve static images
	router.PathPrefix("/images/").Handler(http.StripPrefix("/images/", http.FileServer(http.Dir("../frontend/public/images"))))

	// Serve static HTML for webview order form (original)
	router.HandleFunc("/order-form.html", func(w http.ResponseWriter, r *http.Request) {
		// Path is relative to where you run 'go run main.go' (backend directory)
		http.ServeFile(w, r, "../frontend/public/order-form.html")
	}).Methods("GET")

	// Serve new modular order form (v2)
	router.HandleFunc("/order-form-v2.html", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../frontend/public/order-form-v2.html")
	}).Methods("GET")

	// Serve saved orders page
	router.HandleFunc("/saved-orders.html", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../frontend/public/saved-orders.html")
	}).Methods("GET")

	// Serve order details page
	router.HandleFunc("/order-details.html", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../frontend/public/order-details.html")
	}).Methods("GET")

	// Serve rate order page
	router.HandleFunc("/rate-order.html", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../frontend/public/rate-order.html")
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
	router.HandleFunc("/api/orders/{id:[0-9]+}", controllers.GetOrderByID).Methods("GET", "OPTIONS")

	// Chat Order API (from webview)
	router.HandleFunc("/api/chat/orders", controllers.CreateChatOrder).Methods("POST", "OPTIONS")

	// Handle user choice: add to existing order or create new
	router.HandleFunc("/api/chat/orders/choice", controllers.HandleOrderChoice).Methods("POST", "OPTIONS")

	// Cancel a pending QR payment order (user-facing)
	router.HandleFunc("/api/chat/orders/{id:[0-9]+}/cancel", controllers.CancelPendingQROrder).Methods("POST", "OPTIONS")

	// Authenticated webview user APIs (requires signed token ?t=...)
	router.HandleFunc("/api/me/saved-orders", controllers.MeSavedOrders).Methods("GET", "POST", "OPTIONS")
	router.HandleFunc("/api/me/saved-orders/{id:[0-9]+}", controllers.MeDeleteSavedOrder).Methods("DELETE", "OPTIONS")
	router.HandleFunc("/api/me/recent-orders", controllers.MeRecentOrders).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/me/active-order", controllers.MeActiveOrder).Methods("GET", "OPTIONS")

	// Admin Auth
	router.HandleFunc("/api/admin/login", controllers.AdminLogin).Methods("POST", "OPTIONS")
	router.Handle("/api/admin/me", controllers.RequireAdmin(http.HandlerFunc(controllers.AdminMe))).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/bootstrap", controllers.AdminBootstrap).Methods("POST", "OPTIONS")

	// Admin API Routes - Orders
	router.HandleFunc("/api/admin/orders", controllers.AdminGetOrders).Methods("GET")
	router.HandleFunc("/api/admin/customers/block", controllers.AdminBlockMessengerUser).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/admin/customers/unblock", controllers.AdminUnblockMessengerUser).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/admin/customers/status", controllers.AdminGetCustomerStatus).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/customers/verify", controllers.AdminSetCustomerVerification).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/admin/customers/verify/messenger", controllers.AdminRequestMessengerVerification).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/admin/orders/{id}/status", controllers.AdminUpdateOrderStatus).Methods("PUT", "OPTIONS")
	router.HandleFunc("/api/admin/orders/{id}/cancel", controllers.AdminCancelOrder).Methods("POST", "OPTIONS")

	// Admin API Routes - Products
	productController := &controllers.ProductController{DB: configs.DB}

	// Product CRUD
	router.HandleFunc("/api/products", productController.GetProducts).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/products", productController.CreateProduct).Methods("POST", "OPTIONS")

	router.HandleFunc("/api/products/tags", productController.GetProductTags).Methods("GET", "OPTIONS")

	// Dev helper: Seed sample products if DB is empty (place BEFORE {id} routes to avoid conflicts)
	router.HandleFunc("/api/products/seed", productController.SeedProducts).Methods("GET", "OPTIONS")

	// Debug info for diagnosing product visibility
	router.HandleFunc("/api/products/debug", productController.DebugProducts).Methods("GET", "OPTIONS")

	// Use regex to ensure {id} is numeric, preventing collisions with static paths like /seed
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.GetProduct).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.UpdateProduct).Methods("PUT", "OPTIONS")
	router.HandleFunc("/api/products/{id:[0-9]+}", productController.DeleteProduct).Methods("DELETE", "OPTIONS")
	router.Handle("/api/admin/products/{id:[0-9]+}/delete", controllers.RequireAdmin(http.HandlerFunc(productController.DeleteProductPermanent))).Methods("DELETE", "OPTIONS")

	// Product Status (numeric id)
	router.HandleFunc("/api/products/{id:[0-9]+}/status", productController.UpdateProductStatus).Methods("PATCH", "OPTIONS")

	// Product Stock (quick inline adjustment)
	router.HandleFunc("/api/products/{id:[0-9]+}/stock", productController.UpdateProductStock).Methods("PATCH", "OPTIONS")

	// Product Logs
	router.HandleFunc("/api/products/{id}/logs", productController.GetProductLogs).Methods("GET", "OPTIONS")

	// Admin Top Products (for dashboard popular items)
	router.Handle("/api/admin/top-products", controllers.RequireAdmin(http.HandlerFunc(productController.AdminGetTopProducts))).Methods("GET", "OPTIONS")
	// Admin Product Sales (aggregated sold counts)
	router.Handle("/api/admin/product-sales", controllers.RequireAdmin(http.HandlerFunc(productController.AdminGetProductSales))).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/daily-stock", controllers.AdminGetDailyStockLogs).Methods("GET", "OPTIONS")

	// Product Alerts
	router.HandleFunc("/api/products/low-stock", productController.GetLowStockProducts).Methods("GET", "OPTIONS")

	// Product Ratings
	router.HandleFunc("/api/products/{id:[0-9]+}/ratings", controllers.GetProductRatings).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/ratings", controllers.SubmitRating).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/ratings/bulk", controllers.SubmitBulkRatings).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/orders/{id:[0-9]+}/rating-status", controllers.GetOrderRatingStatus).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/ratings", controllers.AdminGetAllRatings).Methods("GET", "OPTIONS")

	// Stock API - Real-time stock status for frontend
	router.HandleFunc("/api/stock/{id:[0-9]+}", controllers.GetProductStockStatus).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/stock/bulk", controllers.GetBulkStockStatus).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/stock/validate-cart", controllers.ValidateCartStock).Methods("POST", "OPTIONS")

	// (Moved above to avoid route conflicts)

	// Uploads - Cloudinary
	router.HandleFunc("/api/uploads/cloudinary", controllers.UploadProductImage).Methods("POST", "OPTIONS")

	// Promotions API
	router.HandleFunc("/promotions/active", controllers.GetActivePromotions).Methods("GET", "OPTIONS")
	router.HandleFunc("/checkout", controllers.CalculateCheckout).Methods("POST", "OPTIONS")

	// Preorder Banner API
	router.HandleFunc("/api/preorder-settings", controllers.GetPreorderSettings).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/preorder-settings", controllers.AdminGetPreorderSettings).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/preorder-settings", controllers.AdminUpdatePreorderSettings).Methods("PUT", "OPTIONS")
	router.HandleFunc("/api/preorder-products/{id:[0-9]+}/settings", controllers.GetPreorderProductSettings).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/products/{id:[0-9]+}/preorder-settings", controllers.AdminGetPreorderProductSettings).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/products/{id:[0-9]+}/preorder-settings", controllers.AdminUpdatePreorderProductSettings).Methods("PUT", "OPTIONS")

	// Admin Promotions API
	router.HandleFunc("/api/admin/promotions", controllers.AdminGetAllPromotions).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/promotions", controllers.AdminCreatePromotion).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/admin/promotions/{id:[0-9]+}", controllers.AdminUpdatePromotion).Methods("PUT", "OPTIONS")
	router.HandleFunc("/api/admin/promotions/{id:[0-9]+}/toggle", controllers.AdminTogglePromotion).Methods("PATCH", "OPTIONS")
	router.HandleFunc("/api/admin/promotions/{id:[0-9]+}", controllers.AdminDeletePromotion).Methods("DELETE", "OPTIONS")

	// Payment API
	router.HandleFunc("/api/payments/initiate", controllers.InitiatePaymentHandler).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/payments/upload-image", controllers.UploadPaymentImageHandler).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/payments/status", controllers.GetPaymentStatusHandler).Methods("GET", "OPTIONS")

	// Admin Payment API
	router.HandleFunc("/api/admin/payments", controllers.AdminGetPayments).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/payments/{id:[0-9]+}/verify", controllers.AdminVerifyPayment).Methods("POST", "OPTIONS")

	// Preorder Sessions API (pay-before-order for custom cakes)
	router.HandleFunc("/api/preorder-sessions", controllers.CreatePreorderSession).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/preorder-sessions/{id:[0-9]+}/upload", controllers.UploadPreorderPaymentProof).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/preorder-sessions/{id:[0-9]+}/status", controllers.GetPreorderSessionStatus).Methods("GET", "OPTIONS")

	// Admin Preorder Sessions API
	router.HandleFunc("/api/admin/preorder-sessions", controllers.AdminGetPreorderSessions).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/admin/preorder-sessions/{id:[0-9]+}/verify", controllers.AdminVerifyPreorderSession).Methods("POST", "OPTIONS")

	// QR Code endpoint
	router.HandleFunc("/qr_codes/order_{id:[0-9]+}.png", controllers.GetQRCodeHandler).Methods("GET")

	// Uploads directory for payment images
	router.PathPrefix("/uploads/").Handler(http.StripPrefix("/uploads/", http.FileServer(http.Dir("../frontend/public/uploads"))))

	// Wrap with middleware
	handler := LoggingMiddleware(router)
	handler = CORSMiddleware(handler)

	return handler
}
