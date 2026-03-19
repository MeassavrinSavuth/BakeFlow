import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Sidebar from '../../components/Sidebar';
import { useTranslation } from '../../utils/i18n';

export default function AdminPayments() {
    const router = useRouter();
    const { t, lang } = useTranslation();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [payments, setPayments] = useState([]);
    const [filter, setFilter] = useState('pending'); // pending, verified, rejected
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmStatus, setConfirmStatus] = useState('');
    const [confirmPaymentId, setConfirmPaymentId] = useState(null);
    const [confirmOrderId, setConfirmOrderId] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [settingsLoading, setSettingsLoading] = useState(true);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [qrUploading, setQrUploading] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);
    const [settingsMessage, setSettingsMessage] = useState('');
    const [paymentInfoOpen, setPaymentInfoOpen] = useState(true);
    const [paymentSettings, setPaymentSettings] = useState({
        qr_code_image_url: '',
        receiver_name: '',
        receiver_phone: '',
        account_number: '',
        bank_name: '',
        other_details: '',
    });
    const formatMoney = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return '—';
        return `Ks ${num.toFixed(2)}`;
    };

    const getAdminToken = useCallback(() => {
        if (typeof window === 'undefined') return '';
        try {
            return localStorage.getItem('bakeflow_admin_token') || '';
        } catch {
            return '';
        }
    }, []);

    const redirectToLogin = useCallback(() => {
        if (typeof window !== 'undefined') {
            try {
                localStorage.removeItem('bakeflow_admin_token');
            } catch {
                // ignore storage errors
            }
        }
        const target = router.asPath || '/admin/payments';
        router.replace(`/admin/login?redirect=${encodeURIComponent(target)}`);
    }, [router]);

    const buildAuthHeaders = useCallback((extra = {}) => {
        const headers = { ...extra };
        const tok = getAdminToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
        return headers;
    }, [getAdminToken]);

    useEffect(() => {
        let cancelled = false;

        const checkAuth = async () => {
            const tok = getAdminToken();
            if (!tok) {
                if (!cancelled) redirectToLogin();
                return;
            }

            try {
                const res = await fetch('/api/admin/me', {
                    headers: buildAuthHeaders(),
                });
                if (!res.ok) {
                    if (!cancelled) redirectToLogin();
                    return;
                }
                if (!cancelled) setAuthChecked(true);
            } catch {
                if (!cancelled) redirectToLogin();
            }
        };

        checkAuth();
        return () => {
            cancelled = true;
        };
    }, [buildAuthHeaders, getAdminToken, redirectToLogin]);

    useEffect(() => {
        setPage(1);
    }, [filter]);

    useEffect(() => {
        if (!authChecked) return;
        fetchPayments();
    }, [authChecked, filter, page]);

    useEffect(() => {
        if (!authChecked) return;
        fetchPaymentSettings();
    }, [authChecked]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem('admin_payments_info_open');
            if (raw === '0') setPaymentInfoOpen(false);
            if (raw === '1') setPaymentInfoOpen(true);
        } catch {
            // ignore storage errors
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem('admin_payments_info_open', paymentInfoOpen ? '1' : '0');
        } catch {
            // ignore storage errors
        }
    }, [paymentInfoOpen]);

    const fetchPayments = async () => {
        const PAGE_SIZE = 15;
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/payments?status=${filter}&page=${page}&limit=${PAGE_SIZE}`, {
                headers: buildAuthHeaders(),
            });
            if (res.status === 401) {
                redirectToLogin();
                return;
            }
            const data = await res.json();

            // Preferred shape (server-side pagination)
            if (data && Array.isArray(data.payments)) {
                setPayments(data.payments.slice(0, PAGE_SIZE));
                setTotalPages(Number(data.total_pages || 1) || 1);
                return;
            }

            // Legacy shape (unpaginated array) — apply client-side pagination
            if (Array.isArray(data)) {
                const nextTotalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
                if (page > nextTotalPages) {
                    setPage(nextTotalPages);
                    setTotalPages(nextTotalPages);
                    setPayments([]);
                    return;
                }
                const start = (page - 1) * PAGE_SIZE;
                setPayments(data.slice(start, start + PAGE_SIZE));
                setTotalPages(nextTotalPages);
                return;
            }

            setPayments([]);
            setTotalPages(1);
        } catch (error) {
            console.error('Failed to fetch payments', error);
            setPayments([]);
            setTotalPages(1);
        } finally {
            setLoading(false);
        }
    };

    const fetchPaymentSettings = async () => {
        setSettingsLoading(true);
        setSettingsMessage('');
        try {
            const res = await fetch('/api/admin/payment-settings', {
                headers: buildAuthHeaders(),
            });
            if (res.status === 401) {
                redirectToLogin();
                return;
            }
            const data = await res.json();
            const settings = data?.settings || data || {};
            setPaymentSettings((prev) => ({
                ...prev,
                qr_code_image_url: settings.qr_code_image_url || '',
                receiver_name: settings.receiver_name || '',
                receiver_phone: settings.receiver_phone || '',
                account_number: settings.account_number || '',
                bank_name: settings.bank_name || '',
                other_details: settings.other_details || '',
            }));
        } catch (error) {
            console.error('Failed to fetch payment settings', error);
            setSettingsMessage(t('failedToLoadPaymentSettings'));
        } finally {
            setSettingsLoading(false);
        }
    };

    const handleSettingsChange = (e) => {
        const { name, value } = e.target;
        setPaymentSettings((prev) => ({ ...prev, [name]: value }));
    };

    const handleUploadShopQR = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setQrUploading(true);
        setSettingsMessage('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'bakeflow/shop_qr');

            const res = await fetch('/api/uploads/cloudinary', {
                method: 'POST',
                headers: buildAuthHeaders(),
                body: formData,
            });
            if (res.status === 401) {
                redirectToLogin();
                return;
            }
            const data = await res.json();
            if (!res.ok || !data?.url) {
                throw new Error(data?.error || 'Upload failed');
            }
            setPaymentSettings((prev) => ({
                ...prev,
                qr_code_image_url: data.url,
            }));
            setSettingsMessage(t('qrUploadedClickSave'));
        } catch (error) {
            console.error('QR upload failed', error);
            setSettingsMessage(t('failedToUploadQRImage'));
        } finally {
            setQrUploading(false);
            e.target.value = '';
        }
    };

    const handleSaveSettings = async () => {
        if (!paymentSettings.qr_code_image_url) {
            setSettingsMessage(t('pleaseUploadQRFirst'));
            return;
        }

        setSettingsSaving(true);
        setSettingsMessage('');
        try {
            const res = await fetch('/api/admin/payment-settings', {
                method: 'PUT',
                headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(paymentSettings),
            });
            if (res.status === 401) {
                redirectToLogin();
                return;
            }
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save settings');
            }

            const settings = data?.settings || {};
            setPaymentSettings((prev) => ({
                ...prev,
                qr_code_image_url: settings.qr_code_image_url || prev.qr_code_image_url,
                receiver_name: settings.receiver_name || '',
                receiver_phone: settings.receiver_phone || '',
                account_number: settings.account_number || '',
                bank_name: settings.bank_name || '',
                other_details: settings.other_details || '',
            }));
            setSettingsMessage(t('paymentSettingsSavedSuccessfully'));
        } catch (error) {
            console.error(error);
            setSettingsMessage(t('failedToSavePaymentSettings'));
        } finally {
            setSettingsSaving(false);
        }
    };

    const openConfirm = (paymentId, orderId, status) => {
        setConfirmPaymentId(paymentId);
        setConfirmOrderId(orderId);
        setConfirmStatus(status);
        setConfirmOpen(true);
    };

    const closeConfirm = () => {
        if (isVerifying) return;
        setConfirmOpen(false);
        setConfirmPaymentId(null);
        setConfirmOrderId(null);
        setConfirmStatus('');
    };

    const handleVerify = async () => {
        if (!confirmPaymentId || !confirmStatus) return;
        setIsVerifying(true);

        try {
            const res = await fetch(`/api/admin/payments/${confirmPaymentId}/verify`, {
                method: 'POST',
                headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ status: confirmStatus }),
            });
            if (res.status === 401) {
                redirectToLogin();
                return;
            }
            if (res.ok) {
                fetchPayments();
                closeConfirm();
            } else {
                alert(t('failedToUpdateStatus'));
            }
        } catch (error) {
            alert(t('errorUpdatingStatus'));
        } finally {
            setIsVerifying(false);
        }
    };

    const getPaginationItems = (current, total, maxVisible = 7) => {
        if (!Number.isFinite(total) || total <= 1) return [];

        const safeTotal = Math.max(1, Math.floor(total));
        const safeCurrent = Math.min(Math.max(1, Math.floor(current || 1)), safeTotal);

        if (safeTotal <= maxVisible) {
            return Array.from({ length: safeTotal }, (_, i) => i + 1);
        }

        const items = [];
        const innerSlots = Math.max(0, maxVisible - 2);

        let start = Math.max(2, safeCurrent - Math.floor(innerSlots / 2));
        let end = start + innerSlots - 1;

        if (end > safeTotal - 1) {
            end = safeTotal - 1;
            start = Math.max(2, end - innerSlots + 1);
        }

        items.push(1);
        if (start > 2) items.push('ellipsis-left');
        for (let p = start; p <= end; p += 1) items.push(p);
        if (end < safeTotal - 1) items.push('ellipsis-right');
        items.push(safeTotal);

        return items;
    };

    const statusMeta = {
        pending: {
            label: t('pending'),
            activeBg: '#fff7ed',
            activeText: '#c2410c',
            activeBorder: '#fdba74',
            dot: '#f59e0b',
        },
        verified: {
            label: t('verified'),
            activeBg: '#ecfdf3',
            activeText: '#166534',
            activeBorder: '#86efac',
            dot: '#16a34a',
        },
        rejected: {
            label: t('rejected'),
            activeBg: '#fef2f2',
            activeText: '#991b1b',
            activeBorder: '#fca5a5',
            dot: '#dc2626',
        },
    };

    const statusText = (status) => statusMeta[status]?.label || status;
    const noPaymentsMessage = (status) => {
        const label = statusText(status);
        if (lang === 'my') return `${label} ${t('payments')} ${t('noDataSuffix')}`;
        return `No ${String(label).toLowerCase()} payments found`;
    };

    return (
        <div className="d-flex vh-100 overflow-hidden" style={{ background: '#f5f7fb' }}>
            <Head>
                <title>{t('paymentVerificationTitle')} - Admin</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
                <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" defer></script>
            </Head>

            <Sidebar open={sidebarOpen} toggle={() => setSidebarOpen(!sidebarOpen)} />

            <main className="flex-grow-1 d-flex flex-column overflow-hidden" style={{ marginLeft: sidebarOpen ? '0' : '0' }}>
                <div className="flex-grow-1 overflow-auto p-4">
                    <div className="container-fluid px-0" style={{ maxWidth: '1280px' }}>
                        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
                            <div>
                                <h1 className="mb-1" style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-0.4px', color: '#111827' }}>
                                    {t('paymentVerificationTitle')}
                                </h1>
                                <p className="mb-0" style={{ color: '#6b7280', fontSize: '14px', fontWeight: 500 }}>
                                    {t('paymentVerificationSubtitle')}
                                </p>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                                <button
                                    className="btn btn-outline-secondary px-3"
                                    style={{ borderRadius: '12px', height: '42px', fontWeight: 600 }}
                                    onClick={() => setPaymentInfoOpen((v) => !v)}
                                >
                                    <i className={`bi ${paymentInfoOpen ? 'bi-eye-slash' : 'bi-layout-text-window-reverse'} me-2`}></i>
                                    {paymentInfoOpen ? t('closePaymentInfo') : t('showPaymentInfo')}
                                </button>
                                <button className="btn btn-dark px-3" style={{ borderRadius: '12px', height: '42px', fontWeight: 600 }} onClick={fetchPayments}>
                                    <i className="bi bi-arrow-clockwise me-2"></i>
                                    {t('refresh')}
                                </button>
                            </div>
                        </div>

                        <div
                            className="d-flex flex-wrap gap-2 p-2 mb-4"
                            style={{
                                background: '#fff',
                                borderRadius: '14px',
                                border: '1px solid #e5e7eb',
                                boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
                                width: 'fit-content',
                            }}
                        >
                            {['pending', 'verified', 'rejected'].map((status) => {
                                const meta = statusMeta[status];
                                const active = filter === status;
                                return (
                                    <button
                                        key={status}
                                        onClick={() => setFilter(status)}
                                        className="btn"
                                        style={{
                                            borderRadius: '999px',
                                            border: `1px solid ${active ? meta.activeBorder : '#e5e7eb'}`,
                                            background: active ? meta.activeBg : '#fff',
                                            color: active ? meta.activeText : '#6b7280',
                                            fontWeight: 700,
                                            fontSize: '13px',
                                            padding: '8px 14px',
                                            minWidth: '110px',
                                            transition: 'all .2s ease',
                                        }}
                                    >
                                        <span className="d-inline-flex align-items-center gap-2">
                                            <span
                                                style={{
                                                    width: '8px',
                                                    height: '8px',
                                                    borderRadius: '50%',
                                                    background: meta.dot,
                                                    display: 'inline-block',
                                                }}
                                            />
                                            {meta.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <div
                            style={{
                                position: 'relative',
                                maxHeight: paymentInfoOpen ? '1200px' : '0px',
                                opacity: paymentInfoOpen ? 1 : 0,
                                transform: paymentInfoOpen ? 'translateY(0)' : 'translateY(-8px)',
                                overflow: 'hidden',
                                transition: 'max-height .35s ease, opacity .24s ease, transform .24s ease',
                                marginBottom: paymentInfoOpen ? '1.5rem' : 0,
                                pointerEvents: paymentInfoOpen ? 'auto' : 'none',
                            }}
                        >
                        <div className="row g-4 mb-0">
                            <div className="col-xl-4">
                                <div
                                    className="h-100 p-4"
                                    style={{
                                        background: 'linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)',
                                        borderRadius: '16px',
                                        border: '1px solid #dbeafe',
                                        boxShadow: '0 10px 30px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.08)',
                                    }}
                                >
                                    <div className="d-flex justify-content-between align-items-center mb-3">
                                        <div>
                                            <div className="d-flex align-items-center gap-2 mb-1">
                                                <i className="bi bi-qr-code-scan" style={{ color: '#2563eb' }}></i>
                                                <h5 className="mb-0" style={{ fontWeight: 700, color: '#111827' }}>{t('qrPayment')}</h5>
                                            </div>
                                            <small style={{ color: '#6b7280', fontWeight: 500 }}>{t('scanToPay')}</small>
                                        </div>
                                        <button
                                            className="btn btn-sm"
                                            style={{ borderRadius: '10px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 600 }}
                                            onClick={fetchPaymentSettings}
                                            disabled={settingsLoading || settingsSaving || qrUploading}
                                        >
                                            <i className="bi bi-arrow-clockwise me-1"></i>
                                            {t('reload')}
                                        </button>
                                    </div>

                                    {settingsLoading ? (
                                        <div className="text-muted small">{t('loadingSettings')}</div>
                                    ) : (
                                        <>
                                            <div
                                                className="d-flex align-items-center justify-content-center"
                                                style={{
                                                    minHeight: '300px',
                                                    borderRadius: '14px',
                                                    background: '#fff',
                                                    border: '1px dashed #cbd5e1',
                                                    boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.04)',
                                                    padding: '20px',
                                                }}
                                            >
                                                {paymentSettings.qr_code_image_url ? (
                                                    <img
                                                        src={paymentSettings.qr_code_image_url}
                                                        alt="Shop QR"
                                                        className="img-fluid"
                                                        style={{ maxHeight: '260px', objectFit: 'contain' }}
                                                    />
                                                ) : (
                                                    <div className="text-center" style={{ color: '#9ca3af' }}>
                                                        <i className="bi bi-image" style={{ fontSize: '24px' }}></i>
                                                        <div className="small mt-2">{t('noQRUploadedYet')}</div>
                                                    </div>
                                                )}
                                            </div>

                                            <label
                                                className="btn w-100 mt-3"
                                                style={{
                                                    borderRadius: '12px',
                                                    border: '1px solid #111827',
                                                    background: '#fff',
                                                    color: '#111827',
                                                    fontWeight: 700,
                                                    padding: '10px 14px',
                                                    cursor: qrUploading ? 'not-allowed' : 'pointer',
                                                    opacity: qrUploading ? 0.7 : 1,
                                                }}
                                            >
                                                <i className="bi bi-upload me-2"></i>
                                                {qrUploading ? t('uploading') : t('uploadQRCodeImage')}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="d-none"
                                                    disabled={qrUploading || settingsSaving}
                                                    onChange={handleUploadShopQR}
                                                />
                                            </label>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="col-xl-8">
                                <div
                                    className="h-100 p-4"
                                    style={{
                                        background: '#fff',
                                        borderRadius: '16px',
                                        border: '1px solid #e5e7eb',
                                        boxShadow: '0 10px 25px rgba(15,23,42,0.05), 0 1px 3px rgba(15,23,42,0.06)',
                                    }}
                                >
                                    <div className="d-flex align-items-center gap-2 mb-3">
                                        <i className="bi bi-person-vcard" style={{ color: '#374151' }}></i>
                                        <h5 className="mb-0" style={{ fontWeight: 700, color: '#111827' }}>{t('receiverDetails')}</h5>
                                    </div>
                                    <p className="mb-4" style={{ color: '#6b7280', fontSize: '13px', fontWeight: 500 }}>
                                        {t('receiverDetailsSubtitle')}
                                    </p>

                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label className="form-label" style={{ color: '#6b7280', fontSize: '12px', fontWeight: 700 }}>{t('receiverName')}</label>
                                            <input
                                                type="text"
                                                name="receiver_name"
                                                className="form-control bf-input"
                                                value={paymentSettings.receiver_name}
                                                onChange={handleSettingsChange}
                                                placeholder="e.g. BakeFlow Shop"
                                            />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label" style={{ color: '#6b7280', fontSize: '12px', fontWeight: 700 }}>{t('receiverPhone')}</label>
                                            <input
                                                type="text"
                                                name="receiver_phone"
                                                className="form-control bf-input"
                                                value={paymentSettings.receiver_phone}
                                                onChange={handleSettingsChange}
                                                placeholder="e.g. 09xxxxxxxxx"
                                            />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label" style={{ color: '#6b7280', fontSize: '12px', fontWeight: 700 }}>{t('bankWalletName')}</label>
                                            <input
                                                type="text"
                                                name="bank_name"
                                                className="form-control bf-input"
                                                value={paymentSettings.bank_name}
                                                onChange={handleSettingsChange}
                                                placeholder="e.g. KBZPay / Wave"
                                            />
                                        </div>
                                    </div>

                                    <div className="d-flex flex-wrap align-items-center gap-3 mt-4">
                                        <button
                                            className="btn btn-dark px-4"
                                            style={{ borderRadius: '12px', fontWeight: 700, minHeight: '42px' }}
                                            onClick={handleSaveSettings}
                                            disabled={settingsSaving || qrUploading}
                                        >
                                            {settingsSaving ? t('saving') : t('saveSettings')}
                                        </button>
                                        {settingsMessage && (
                                            <span style={{ color: '#6b7280', fontSize: '13px', fontWeight: 500 }}>{settingsMessage}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div
                            className="p-4"
                            style={{
                                background: '#fff',
                                borderRadius: '16px',
                                border: '1px solid #e5e7eb',
                                boxShadow: '0 10px 24px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
                            }}
                        >
                            <div className="d-flex align-items-center gap-2 mb-3">
                                <i className="bi bi-shield-check" style={{ color: '#374151' }}></i>
                                <h5 className="mb-0" style={{ fontWeight: 700, color: '#111827' }}>{t('submittedPaymentProofs')}</h5>
                            </div>

                            {loading ? (
                                <div className="text-center py-5" style={{ color: '#6b7280' }}>{t('loadingPayments')}</div>
                            ) : (
                                <div className="row g-4">
                                    {payments.length === 0 ? (
                                        <div className="col-12">
                                            <div
                                                className="d-flex flex-column align-items-center justify-content-center text-center"
                                                style={{
                                                    minHeight: '260px',
                                                    borderRadius: '14px',
                                                    border: '1px dashed #d1d5db',
                                                    background: '#fafafa',
                                                    color: '#6b7280',
                                                }}
                                            >
                                                <i className="bi bi-inbox" style={{ fontSize: '28px', marginBottom: '8px' }}></i>
                                                <h6 className="mb-1" style={{ fontWeight: 700 }}>{noPaymentsMessage(filter)}</h6>
                                                <div style={{ fontSize: '13px' }}>{t('newSubmissionsWillAppear')}</div>
                                            </div>
                                        </div>
                                    ) : (
                                        payments.map(payment => (
                                            <div key={payment.id} className="col-md-6 col-xl-4">
                                                <div
                                                    className="h-100"
                                                    style={{
                                                        borderRadius: '14px',
                                                        overflow: 'hidden',
                                                        border: '1px solid #e5e7eb',
                                                        background: '#fff',
                                                        boxShadow: '0 6px 20px rgba(15,23,42,0.05)',
                                                    }}
                                                >
                                                    <div className="position-relative" style={{ height: '280px', backgroundColor: '#f9fafb' }}>
                                                        {payment.proof_url ? (
                                                            <a href={payment.proof_url} target="_blank" rel="noopener noreferrer">
                                                                <img
                                                                    src={payment.proof_url}
                                                                    alt={`Receipt for Order #${payment.order_id}`}
                                                                    className="w-100 h-100 object-fit-contain"
                                                                />
                                                            </a>
                                                        ) : (
                                                            <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                                                                {t('noImage')}
                                                            </div>
                                                        )}
                                                        <div className="position-absolute top-0 end-0 m-2">
                                                            <span className={`badge ${payment.status === 'verified' ? 'bg-success' :
                                                                payment.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'
                                                                }`} style={{ borderRadius: '999px', padding: '6px 10px' }}>
                                                                {payment.status}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="p-3">
                                                        <h6 className="d-flex justify-content-between align-items-center mb-2" style={{ fontWeight: 700, color: '#111827' }}>
                                                            <span>{t('orderID')} #{payment.order_id}</span>
                                                            <small style={{ color: '#9ca3af', fontWeight: 600 }}>{new Date(payment.created_at).toLocaleDateString()}</small>
                                                        </h6>
                                                        <p className="mb-2" style={{ color: '#6b7280', fontSize: '13px' }}>
                                                            {t('userIDLabel')}: {payment.user_id}
                                                        </p>
                                                        <div className="d-flex justify-content-between align-items-center mb-3">
                                                            <span style={{ color: '#6b7280', fontSize: '13px' }}>{t('total')}</span>
                                                            <span style={{ color: '#111827', fontWeight: 700 }}>{formatMoney(payment.amount)}</span>
                                                        </div>

                                                        {filter === 'pending' && (
                                                            <div className="d-flex gap-2 mt-3">
                                                                <button
                                                                    className="btn btn-success flex-grow-1"
                                                                    style={{ borderRadius: '10px', fontWeight: 600 }}
                                                                    onClick={() => openConfirm(payment.id, payment.order_id, 'verified')}
                                                                >
                                                                    <i className="bi bi-check-circle me-1"></i> {t('approve')}
                                                                </button>
                                                                <button
                                                                    className="btn btn-outline-danger flex-grow-1"
                                                                    style={{ borderRadius: '10px', fontWeight: 600 }}
                                                                    onClick={() => openConfirm(payment.id, payment.order_id, 'rejected')}
                                                                >
                                                                    <i className="bi bi-x-circle me-1"></i> {t('reject')}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {!loading && totalPages > 1 && (
                            <div className="d-flex justify-content-center align-items-center gap-3 mt-4 mb-1 flex-wrap">
                                <div className="text-muted small">{t('page')} {page} {t('of')} {totalPages}</div>
                                <nav aria-label="Payments pagination">
                                    <ul className="pagination mb-0">
                                        <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
                                            <button
                                                className="page-link"
                                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                disabled={page <= 1}
                                            >
                                                {t('previous')}
                                            </button>
                                        </li>

                                        {getPaginationItems(page, totalPages).map((item) => {
                                            if (item === 'ellipsis-left' || item === 'ellipsis-right') {
                                                return (
                                                    <li key={item} className="page-item disabled" aria-hidden="true">
                                                        <span className="page-link">…</span>
                                                    </li>
                                                );
                                            }

                                            return (
                                                <li key={item} className={`page-item ${page === item ? 'active' : ''}`}>
                                                    <button
                                                        className="page-link"
                                                        onClick={() => setPage(item)}
                                                        aria-current={page === item ? 'page' : undefined}
                                                    >
                                                        {item}
                                                    </button>
                                                </li>
                                            );
                                        })}

                                        <li className={`page-item ${page >= totalPages ? 'disabled' : ''}`}>
                                            <button
                                                className="page-link"
                                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                disabled={page >= totalPages}
                                            >
                                                {t('next')}
                                            </button>
                                        </li>
                                    </ul>
                                </nav>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <style jsx global>{`
                .bf-input {
                    border-radius: 12px !important;
                    border: 1px solid #d1d5db !important;
                    padding: 10px 12px !important;
                    font-weight: 500 !important;
                    color: #111827 !important;
                    min-height: 42px;
                    box-shadow: none !important;
                }

                .bf-input:focus {
                    border-color: #93c5fd !important;
                    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12) !important;
                }

                .pagination .page-link {
                    border-radius: 10px !important;
                    margin: 0 3px;
                    border: 1px solid #e5e7eb;
                    color: #374151;
                    font-weight: 600;
                }

                .pagination .page-item.active .page-link {
                    background: #111827;
                    border-color: #111827;
                    color: #fff;
                }

                .pagination .page-link:focus {
                    box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.12);
                }
            `}</style>
            <div className={`modal fade ${confirmOpen ? 'show' : ''}`} style={{ display: confirmOpen ? 'block' : 'none' }} tabIndex="-1" role="dialog" aria-hidden={!confirmOpen}>
                <div className="modal-dialog modal-dialog-centered" role="document">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title">{t('confirmPaymentUpdate')}</h5>
                            <button type="button" className="btn-close" onClick={closeConfirm} aria-label="Close" disabled={isVerifying}></button>
                        </div>
                        <div className="modal-body">
                            {confirmOrderId ? (
                                <span>{t('markOrderAs')} #{confirmOrderId} {statusText(confirmStatus)}?</span>
                            ) : (
                                <span>{t('markPaymentAs')} {statusText(confirmStatus)}?</span>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-outline-secondary" onClick={closeConfirm} disabled={isVerifying}>{t('cancel')}</button>
                            <button type="button" className={`btn ${confirmStatus === 'verified' ? 'btn-success' : 'btn-danger'}`} onClick={handleVerify} disabled={isVerifying}>
                                {isVerifying ? t('updating') : t('confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {confirmOpen && <div className="modal-backdrop fade show"></div>}
        </div>
    );
}
