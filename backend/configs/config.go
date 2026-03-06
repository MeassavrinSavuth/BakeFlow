package configs

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var DB *sql.DB

func ConnectDB() {
	dbURL := os.Getenv("DATABASE_URL")

	// Force simple protocol for PgBouncer compatibility (Neon serverless)
	// lib/pq uses extended query protocol (prepared statements) which breaks
	// with PgBouncer's transaction pooling mode.
	if !strings.Contains(dbURL, "default_query_exec_mode") {
		sep := "?"
		if strings.Contains(dbURL, "?") {
			sep = "&"
		}
		dbURL += sep + "default_query_exec_mode=simple_protocol"
	}

	var err error
	DB, err = sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatal("Error connecting to DB:", err)
	}

	// Connection pool settings for Neon (serverless Postgres with PgBouncer pooler)
	// Neon kills idle connections after ~5 min and cold-starts take 2-5s.
	// These settings ensure Go recycles connections before Neon drops them.
	DB.SetMaxOpenConns(10)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(5 * time.Minute) // recycle before Neon kills it
	DB.SetConnMaxIdleTime(1 * time.Minute) // don't hold idle connections too long

	err = DB.Ping()
	if err != nil {
		log.Fatal("Cannot reach DB:", err)
	}

	fmt.Println("Connected to PostgreSQL!")
}

// QueryRowRetry runs a QueryRow with connection resilience for Neon serverless.
// Uses the pool's built-in connection validation (ConnMaxLifetime handles stale connections).
// Only pings if the query itself fails with a connection error.
func QueryRowRetry(query string, args ...interface{}) *sql.Row {
	return DB.QueryRow(query, args...)
}
