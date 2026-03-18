package models

import (
	"bakeflow/configs"
	"database/sql"
	"strings"
	"time"
)

type ShopPaymentSettings struct {
	ID             int       `json:"id"`
	QRCodeImageURL string    `json:"qr_code_image_url"`
	ReceiverName   string    `json:"receiver_name"`
	ReceiverPhone  string    `json:"receiver_phone"`
	AccountNumber  string    `json:"account_number"`
	BankName       string    `json:"bank_name"`
	OtherDetails   string    `json:"other_details"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func GetShopPaymentSettings() (*ShopPaymentSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}

	var s ShopPaymentSettings
	err := configs.DB.QueryRow(`
		SELECT id,
		       COALESCE(qr_code_image_url, ''),
		       COALESCE(receiver_name, ''),
		       COALESCE(receiver_phone, ''),
		       COALESCE(account_number, ''),
		       COALESCE(bank_name, ''),
		       COALESCE(other_details, ''),
		       created_at,
		       updated_at
		FROM shop_payment_settings
		ORDER BY id ASC
		LIMIT 1
	`).Scan(
		&s.ID,
		&s.QRCodeImageURL,
		&s.ReceiverName,
		&s.ReceiverPhone,
		&s.AccountNumber,
		&s.BankName,
		&s.OtherDetails,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		err = configs.DB.QueryRow(`
			INSERT INTO shop_payment_settings
			    (qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details)
			VALUES ('', '', '', '', '', '')
			RETURNING id, qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details, created_at, updated_at
		`).Scan(
			&s.ID,
			&s.QRCodeImageURL,
			&s.ReceiverName,
			&s.ReceiverPhone,
			&s.AccountNumber,
			&s.BankName,
			&s.OtherDetails,
			&s.CreatedAt,
			&s.UpdatedAt,
		)
	}
	if err != nil {
		return nil, err
	}

	sanitizeShopPaymentSettings(&s)
	return &s, nil
}

func UpsertShopPaymentSettings(input ShopPaymentSettings) (*ShopPaymentSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}

	input.QRCodeImageURL = strings.TrimSpace(input.QRCodeImageURL)
	input.ReceiverName = strings.TrimSpace(input.ReceiverName)
	input.ReceiverPhone = strings.TrimSpace(input.ReceiverPhone)
	input.AccountNumber = strings.TrimSpace(input.AccountNumber)
	input.BankName = strings.TrimSpace(input.BankName)
	input.OtherDetails = strings.TrimSpace(input.OtherDetails)

	var s ShopPaymentSettings
	err := configs.DB.QueryRow(`
		UPDATE shop_payment_settings
		SET qr_code_image_url = $1,
		    receiver_name = $2,
		    receiver_phone = $3,
		    account_number = $4,
		    bank_name = $5,
		    other_details = $6,
		    updated_at = NOW()
		WHERE id = (SELECT id FROM shop_payment_settings ORDER BY id ASC LIMIT 1)
		RETURNING id, qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details, created_at, updated_at
	`, input.QRCodeImageURL, input.ReceiverName, input.ReceiverPhone, input.AccountNumber, input.BankName, input.OtherDetails).Scan(
		&s.ID,
		&s.QRCodeImageURL,
		&s.ReceiverName,
		&s.ReceiverPhone,
		&s.AccountNumber,
		&s.BankName,
		&s.OtherDetails,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		err = configs.DB.QueryRow(`
			INSERT INTO shop_payment_settings
			    (qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details, created_at, updated_at
		`, input.QRCodeImageURL, input.ReceiverName, input.ReceiverPhone, input.AccountNumber, input.BankName, input.OtherDetails).Scan(
			&s.ID,
			&s.QRCodeImageURL,
			&s.ReceiverName,
			&s.ReceiverPhone,
			&s.AccountNumber,
			&s.BankName,
			&s.OtherDetails,
			&s.CreatedAt,
			&s.UpdatedAt,
		)
	}
	if err != nil {
		return nil, err
	}

	sanitizeShopPaymentSettings(&s)
	return &s, nil
}

func sanitizeShopPaymentSettings(s *ShopPaymentSettings) {
	if s == nil {
		return
	}
	s.QRCodeImageURL = strings.TrimSpace(s.QRCodeImageURL)
	s.ReceiverName = strings.TrimSpace(s.ReceiverName)
	s.ReceiverPhone = strings.TrimSpace(s.ReceiverPhone)
	s.AccountNumber = strings.TrimSpace(s.AccountNumber)
	s.BankName = strings.TrimSpace(s.BankName)
	s.OtherDetails = strings.TrimSpace(s.OtherDetails)
}
