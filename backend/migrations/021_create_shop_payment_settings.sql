CREATE TABLE IF NOT EXISTS shop_payment_settings (
    id SERIAL PRIMARY KEY,
    qr_code_image_url TEXT NOT NULL DEFAULT '',
    receiver_name TEXT NOT NULL DEFAULT '',
    receiver_phone TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '',
    other_details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_shop_payment_settings_updated_at
    BEFORE UPDATE ON shop_payment_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

INSERT INTO shop_payment_settings (id, qr_code_image_url, receiver_name, receiver_phone, account_number, bank_name, other_details)
SELECT 1, '', '', '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM shop_payment_settings);
