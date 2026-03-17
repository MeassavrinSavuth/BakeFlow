import { useState, useEffect } from 'react';
import Head from 'next/head';
import Sidebar from '../../components/Sidebar';

export default function AdminPayments() {
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
    const formatMoney = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return '—';
        return `Ks ${num.toFixed(2)}`;
    };

    useEffect(() => {
        setPage(1);
    }, [filter]);

    useEffect(() => {
        fetchPayments();
    }, [filter, page]);

    const fetchPayments = async () => {
        const PAGE_SIZE = 15;
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/payments?status=${filter}&page=${page}&limit=${PAGE_SIZE}`);
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: confirmStatus }),
            });
            if (res.ok) {
                fetchPayments();
                closeConfirm();
            } else {
                alert("Failed to update status");
            }
        } catch (error) {
            alert("Error updating status");
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

    return (
        <div className="d-flex vh-100 overflow-hidden bg-gray-50">
            <Head>
                <title>Payment Verification - Admin</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
                <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" defer></script>
            </Head>

            <Sidebar open={sidebarOpen} toggle={() => setSidebarOpen(!sidebarOpen)} />

            <main className="flex-grow-1 d-flex flex-column overflow-hidden" style={{ marginLeft: sidebarOpen ? '0' : '0' }}>
                {/* Fixed Header Section */}
                <div className="p-4 pb-0 bg-white border-bottom shadow-sm z-1">
                    <div className="container-fluid px-0">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h1 className="h3 text-gray-800 mb-0">Payment Verification</h1>
                            <button className="btn btn-dark" onClick={fetchPayments}>
                                <i className="bi bi-arrow-clockwise me-2"></i>Refresh
                            </button>
                        </div>

                        {/* Filter Tabs */}
                        <div className="btn-group mb-3">
                            {['pending', 'verified', 'rejected'].map(status => (
                                <button
                                    key={status}
                                    className={`btn ${filter === status ? 'btn-dark' : 'btn-outline-dark'}`}
                                    onClick={() => setFilter(status)}
                                >
                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Scrollable Content Section */}
                <div className="flex-grow-1 overflow-auto p-4 bg-gray-50">
                    <div className="container-fluid px-0">
                        {/* Payments List */}
                    {loading ? (
                        <div className="text-center py-5">Loading...</div>
                    ) : (
                        <div className="row g-4">
                            {payments.length === 0 ? (
                                <div className="col-12 text-center text-gray-500 py-5">
                                    No {filter} payments found.
                                </div>
                            ) : (
                                payments.map(payment => (
                                    <div key={payment.id} className="col-md-6 col-lg-4">
                                        <div className="card h-100 shadow-sm">
                                            <div className="position-relative" style={{ height: '300px', backgroundColor: '#f8f9fa' }}>
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
                                                        No Image
                                                    </div>
                                                )}
                                                <div className="position-absolute top-0 end-0 m-2">
                                                    <span className={`badge ${payment.status === 'verified' ? 'bg-success' :
                                                        payment.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'
                                                        }`}>
                                                        {payment.status}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="card-body">
                                                <h5 className="card-title d-flex justify-content-between">
                                                    <span>Order #{payment.order_id}</span>
                                                    <small className="text-muted text-sm">{new Date(payment.created_at).toLocaleDateString()}</small>
                                                </h5>
                                                <p className="card-text text-muted mb-2">
                                                    User ID: {payment.user_id}
                                                </p>
                                                <div className="d-flex justify-content-between align-items-center mb-3">
                                                    <span className="text-muted">Total</span>
                                                    <span className="fw-semibold">{formatMoney(payment.amount)}</span>
                                                </div>

                                                {filter === 'pending' && (
                                                    <div className="d-flex gap-2 mt-3">
                                                        <button
                                                            className="btn btn-success flex-grow-1"
                                                            onClick={() => openConfirm(payment.id, payment.order_id, 'verified')}
                                                        >
                                                            <i className="bi bi-check-circle me-1"></i> Approve
                                                        </button>
                                                        <button
                                                            className="btn btn-outline-danger flex-grow-1"
                                                            onClick={() => openConfirm(payment.id, payment.order_id, 'rejected')}
                                                        >
                                                            <i className="bi bi-x-circle me-1"></i> Reject
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
                    
                    {/* Pagination */}
                    {!loading && totalPages > 1 && (
                        <div className="d-flex justify-content-center align-items-center gap-3 mt-5 mb-4 flex-wrap">
                            <div className="text-muted small">Page {page} of {totalPages}</div>
                            <nav aria-label="Payments pagination">
                                <ul className="pagination mb-0">
                                    <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
                                        <button
                                            className="page-link"
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                        >
                                            Previous
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
                                            Next
                                        </button>
                                    </li>
                                </ul>
                            </nav>
                        </div>
                    )}
                    </div>
                </div>
            </main>
            <div className={`modal fade ${confirmOpen ? 'show' : ''}`} style={{ display: confirmOpen ? 'block' : 'none' }} tabIndex="-1" role="dialog" aria-hidden={!confirmOpen}>
                <div className="modal-dialog modal-dialog-centered" role="document">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title">Confirm Payment Update</h5>
                            <button type="button" className="btn-close" onClick={closeConfirm} aria-label="Close" disabled={isVerifying}></button>
                        </div>
                        <div className="modal-body">
                            {confirmOrderId ? (
                                <span>Mark Order #{confirmOrderId} as {confirmStatus}?</span>
                            ) : (
                                <span>Mark this payment as {confirmStatus}?</span>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-outline-secondary" onClick={closeConfirm} disabled={isVerifying}>Cancel</button>
                            <button type="button" className={`btn ${confirmStatus === 'verified' ? 'btn-success' : 'btn-danger'}`} onClick={handleVerify} disabled={isVerifying}>
                                {isVerifying ? 'Updating...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {confirmOpen && <div className="modal-backdrop fade show"></div>}
        </div>
    );
}
