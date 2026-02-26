package controllers

import (
	"encoding/json"
	"net/http"
	"time"

	"bakeflow/models"
)

func AdminGetDailyStockLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")
	dateStr := r.URL.Query().Get("date")

	layout := "2006-01-02"
	var startDate time.Time
	var endDate time.Time
	var err error

	if dateStr != "" {
		startDate, err = time.Parse(layout, dateStr)
		if err != nil {
			http.Error(w, "Invalid date", http.StatusBadRequest)
			return
		}
		endDate = startDate
	} else {
		if startStr == "" || endStr == "" {
			http.Error(w, "start and end are required", http.StatusBadRequest)
			return
		}
		startDate, err = time.Parse(layout, startStr)
		if err != nil {
			http.Error(w, "Invalid start date", http.StatusBadRequest)
			return
		}
		endDate, err = time.Parse(layout, endStr)
		if err != nil {
			http.Error(w, "Invalid end date", http.StatusBadRequest)
			return
		}
	}

	startDate = models.TruncateDate(startDate)
	endDate = models.TruncateDate(endDate)

	logs, err := models.GetDailyStockLogsBetween(startDate, endDate)
	if err != nil {
		http.Error(w, "Failed to fetch logs", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs":  logs,
		"count": len(logs),
	})
}
