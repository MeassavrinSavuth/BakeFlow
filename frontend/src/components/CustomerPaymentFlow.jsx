import { useState, useEffect, useRef } from 'react';
import { Upload, CheckCircle, Clock, AlertCircle, Shield, ImageIcon, X } from 'lucide-react';

export default function CustomerPaymentFlow({ order }) {
    const [status, setStatus] = useState('loading'); // Start with loading
    const [uploading, setUploading] = useState(false);
    const [uploadedUrl, setUploadedUrl] = useState(null);
    const [error, setError] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [preview, setPreview] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);
    const messengerCloseTimeoutRef = useRef(null);

    // Check existing payment status on mount
    useEffect(() => {
        const initializePaymentState = async () => {
            try {
                const res = await fetch(`/api/payments/status?order_id=${order.id}`);
                const data = await res.json();

                if (data.status === 'verified' || data.status === 'confirmed') {
                    setStatus('confirmed');
                    if (data.proof_url) setUploadedUrl(data.proof_url);
                } else if (data.status === 'rejected') {
                    setStatus('rejected');
                } else if (data.status === 'pending') {
                    // Payment already uploaded, waiting for verification
                    setStatus('verifying');
                    if (data.proof_url) setUploadedUrl(data.proof_url);
                } else {
                    // No payment record yet
                    setStatus('pending');
                }
            } catch (e) {
                console.error("Error fetching payment status", e);
                setStatus('pending'); // Default to pending on error
            }
        };

        initializePaymentState();
    }, [order.id]);

    // Poll for status updates
    useEffect(() => {
        let interval;
        if (status === 'verifying') {
            interval = setInterval(checkStatus, 5000);
        }
        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        if (status !== 'confirmed') return;
        if (typeof window === 'undefined') return;
        const hasMessengerClose = window.MessengerExtensions && typeof window.MessengerExtensions.requestCloseBrowser === 'function';
        if (!hasMessengerClose) return;
        if (messengerCloseTimeoutRef.current) {
            clearTimeout(messengerCloseTimeoutRef.current);
        }
        messengerCloseTimeoutRef.current = setTimeout(() => {
            window.MessengerExtensions.requestCloseBrowser(
                () => {},
                () => {}
            );
        }, 1500);
        return () => {
            if (messengerCloseTimeoutRef.current) {
                clearTimeout(messengerCloseTimeoutRef.current);
            }
        };
    }, [status]);

    const checkStatus = async () => {
        try {
            const res = await fetch(`/api/payments/status?order_id=${order.id}`);
            const data = await res.json();
            if (data.status === 'verified' || data.status === 'confirmed') {
                setStatus('confirmed');
                if (data.proof_url) setUploadedUrl(data.proof_url);
            } else if (data.status === 'rejected') {
                setStatus('rejected');
            }
        } catch (e) {
            console.error("Error checking status", e);
        }
    };

    // Only preview the file — don't upload yet
    const processFile = (file) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file (JPG, PNG)');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setError('File size must be under 10MB');
            return;
        }

        setError(null);
        setSelectedFile(file);

        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target.result);
        reader.readAsDataURL(file);
    };

    // Actually upload when user confirms
    const confirmUpload = async () => {
        if (!selectedFile) return;

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('image', selectedFile);
        formData.append('order_id', order.id);
        formData.append('user_id', order.sender_id);

        try {
            const res = await fetch('/api/payments/upload-image', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (data.success) {
                setUploadedUrl(data.url);
                setStatus('verifying');
            } else {
                setError(data.message || 'Upload failed');
            }
        } catch (err) {
            setError('Network error during upload');
        } finally {
            setUploading(false);
        }
    };

    const handleFileUpload = (e) => processFile(e.target.files[0]);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        processFile(e.dataTransfer.files[0]);
    };

    const clearPreview = () => {
        setPreview(null);
        setSelectedFile(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const returnToMessenger = () => {
        if (typeof window === 'undefined') return;
        if (window.MessengerExtensions && typeof window.MessengerExtensions.requestCloseBrowser === 'function') {
            window.MessengerExtensions.requestCloseBrowser(
                () => {},
                () => {}
            );
            return;
        }
        if (document.referrer) {
            window.location.href = document.referrer;
            return;
        }
        window.location.href = 'https://m.me/';
    };

    // ── Pending State ──
    if (status === 'pending') {
        return (
            <div className="rounded-2xl overflow-hidden"
                style={{
                    background: '#fff',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
                    border: '1px solid #f0ebe4',
                }}>
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #D8A35D 0%, #E8B86D 50%, #F4C27F 100%)',
                    padding: '28px 24px',
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute', top: '-40px', right: '-40px',
                        width: '120px', height: '120px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.1)',
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-20px', left: '-20px',
                        width: '80px', height: '80px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.08)',
                    }} />
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '48px', height: '48px', borderRadius: '14px',
                        background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
                        marginBottom: '12px',
                    }}>
                        <Shield size={24} color="#fff" />
                    </div>
                    <h2 style={{
                        color: '#fff', fontSize: '20px', fontWeight: 700,
                        margin: '0 0 4px 0', letterSpacing: '-0.3px',
                    }}>
                        Complete Payment
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.85)', fontSize: '14px', margin: 0,
                    }}>
                        Order #{order.id} · Ks {order.total_amount?.toFixed(2)}
                    </p>
                </div>

                <div style={{ padding: '24px' }}>
                    {/* QR Section */}
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <p style={{
                            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '1.2px', color: '#9ca3af', marginBottom: '16px',
                        }}>
                            Scan to Pay
                        </p>
                        <div style={{
                            display: 'inline-block', padding: '12px',
                            background: '#fff', borderRadius: '16px',
                            border: '2px solid #f3ede6',
                            boxShadow: '0 2px 12px rgba(216,163,93,0.1)',
                        }}>
                            <img
                                src={`/qr_codes/order_${order.id}.png`}
                                alt="Payment QR Code"
                                style={{
                                    width: '180px', height: '180px',
                                    objectFit: 'contain', display: 'block',
                                }}
                            />
                        </div>
                        <p style={{
                            fontSize: '12px', color: '#9ca3af', marginTop: '12px',
                            maxWidth: '260px', marginLeft: 'auto', marginRight: 'auto',
                            lineHeight: 1.5,
                        }}>
                            Scan with your banking app (KPay, Wave, etc.) to pay
                        </p>
                    </div>

                    {/* Divider */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        marginBottom: '24px',
                    }}>
                        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                        <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>then</span>
                        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                    </div>

                    {/* Upload Section */}
                    <div>
                        <p style={{
                            fontSize: '14px', fontWeight: 600, color: '#374151',
                            marginBottom: '12px',
                        }}>
                            Upload Payment Screenshot
                        </p>

                        {preview ? (
                            <div style={{
                                borderRadius: '12px', overflow: 'hidden',
                                border: '2px solid #D8A35D33',
                                background: '#FFFAF5',
                            }}>
                                {/* Preview image */}
                                <div style={{ position: 'relative' }}>
                                    <img
                                        src={preview}
                                        alt="Receipt preview"
                                        style={{
                                            width: '100%', maxHeight: '200px',
                                            objectFit: 'contain', display: 'block',
                                            padding: '12px',
                                        }}
                                    />
                                    {uploading && (
                                        <div style={{
                                            position: 'absolute', inset: 0,
                                            background: 'rgba(255,255,255,0.85)',
                                            display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center',
                                            gap: '8px', backdropFilter: 'blur(2px)',
                                        }}>
                                            <div style={{
                                                width: '32px', height: '32px', borderRadius: '50%',
                                                border: '3px solid #e5e7eb',
                                                borderTopColor: '#D8A35D',
                                                animation: 'paymentSpin 0.8s linear infinite',
                                            }} />
                                            <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 500 }}>
                                                Uploading...
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* File info & actions */}
                                {!uploading && (
                                    <div style={{
                                        padding: '14px 16px',
                                        borderTop: '1px solid #f3ede6',
                                        background: '#fff',
                                    }}>
                                        {/* File details */}
                                        {selectedFile && (
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                marginBottom: '14px',
                                            }}>
                                                <div style={{
                                                    width: '32px', height: '32px', borderRadius: '8px',
                                                    background: '#FFF4EA', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}>
                                                    <ImageIcon size={16} color="#D8A35D" />
                                                </div>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <p style={{
                                                        fontSize: '13px', fontWeight: 600, color: '#374151',
                                                        margin: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {selectedFile.name}
                                                    </p>
                                                    <p style={{
                                                        fontSize: '11px', color: '#9ca3af', margin: 0,
                                                    }}>
                                                        {(selectedFile.size / 1024).toFixed(0)} KB · {selectedFile.type.split('/')[1]?.toUpperCase()}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={clearPreview}
                                                style={{
                                                    flex: 1, padding: '10px 16px', borderRadius: '10px',
                                                    background: '#f3f4f6', border: '1px solid #e5e7eb',
                                                    color: '#374151', fontWeight: 600, fontSize: '13px',
                                                    cursor: 'pointer', transition: 'all 0.15s ease',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = '#e5e7eb'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = '#f3f4f6'}
                                            >
                                                Change
                                            </button>
                                            <button
                                                onClick={confirmUpload}
                                                style={{
                                                    flex: 2, padding: '10px 16px', borderRadius: '10px',
                                                    background: 'linear-gradient(135deg, #D8A35D, #F4C27F)',
                                                    border: 'none', color: '#fff', fontWeight: 600,
                                                    fontSize: '13px', cursor: 'pointer',
                                                    boxShadow: '0 2px 8px rgba(216,163,93,0.3)',
                                                    transition: 'all 0.15s ease',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                                                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                            >
                                                Confirm & Upload
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <label
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                style={{
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    width: '100%', minHeight: '140px',
                                    borderRadius: '12px', cursor: 'pointer',
                                    border: `2px dashed ${dragOver ? '#D8A35D' : '#d1d5db'}`,
                                    background: dragOver ? '#FFF8F0' : '#fafafa',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    if (!dragOver) {
                                        e.currentTarget.style.borderColor = '#D8A35D';
                                        e.currentTarget.style.background = '#FFF8F0';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!dragOver) {
                                        e.currentTarget.style.borderColor = '#d1d5db';
                                        e.currentTarget.style.background = '#fafafa';
                                    }
                                }}
                            >
                                <div style={{
                                    width: '48px', height: '48px', borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #FFF4EA, #FFECD2)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    marginBottom: '12px',
                                }}>
                                    <Upload size={22} color="#D8A35D" />
                                </div>
                                <span style={{
                                    fontSize: '14px', fontWeight: 600, color: '#374151',
                                    marginBottom: '4px',
                                }}>
                                    Click or drag to upload
                                </span>
                                <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    JPG, PNG up to 10MB
                                </span>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    style={{ display: 'none' }}
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                />
                            </label>
                        )}

                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '12px 16px', borderRadius: '10px',
                                background: '#fef2f2', border: '1px solid #fecaca',
                                marginTop: '12px',
                            }}>
                                <AlertCircle size={16} color="#dc2626" />
                                <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500 }}>
                                    {error}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Security note */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        marginTop: '20px', padding: '10px 14px',
                        background: '#f9fafb', borderRadius: '8px',
                    }}>
                        <Shield size={14} color="#9ca3af" />
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                            Your payment is secure and verified manually by our team
                        </span>
                    </div>
                </div>

                <style jsx>{`
                    @keyframes paymentSpin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    // ── Verifying State ──
    if (status === 'verifying') {
        return (
            <div style={{
                background: '#fff', borderRadius: '16px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
                border: '1px solid #f0ebe4', overflow: 'hidden',
            }}>
                <div style={{
                    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                    padding: '32px 24px', textAlign: 'center',
                }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%',
                        background: '#fff', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px', boxShadow: '0 4px 12px rgba(245,185,0,0.2)',
                    }}>
                        <Clock size={28} color="#d97706" />
                    </div>
                    <h2 style={{
                        fontSize: '20px', fontWeight: 700,
                        color: '#92400e', margin: '0 0 6px 0',
                    }}>
                        Verifying Payment
                    </h2>
                    <p style={{
                        fontSize: '14px', color: '#a16207',
                        margin: 0, lineHeight: 1.6,
                    }}>
                        We received your receipt and are checking it now
                    </p>
                </div>

                <div style={{ padding: '24px', textAlign: 'center' }}>
                    {(uploadedUrl || preview) && (
                        <div style={{
                            display: 'inline-block', padding: '8px',
                            borderRadius: '12px', border: '1px solid #e5e7eb',
                            background: '#f9fafb', marginBottom: '16px',
                        }}>
                            <img
                                src={uploadedUrl || preview}
                                alt="Receipt"
                                style={{
                                    height: '100px', width: 'auto',
                                    borderRadius: '8px', display: 'block',
                                    opacity: 0.8,
                                }}
                            />
                        </div>
                    )}

                    {/* Progress indicator */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '16px', background: '#fffbeb',
                        borderRadius: '10px', border: '1px solid #fef3c7',
                    }}>
                        <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: '#f59e0b',
                            animation: 'verifyPulse 1.5s ease-in-out infinite',
                        }} />
                        <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 500 }}>
                            This typically takes a few minutes
                        </span>
                    </div>
                </div>

                <style jsx>{`
                    @keyframes verifyPulse {
                        0%, 100% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.4; transform: scale(0.8); }
                    }
                `}</style>
            </div>
        );
    }

    // ── Confirmed State ──
    if (status === 'confirmed') {
        return (
            <div style={{
                background: '#fff', borderRadius: '16px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
                border: '1px solid #d1fae5', overflow: 'hidden',
            }}>
                <div style={{
                    background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
                    padding: '32px 24px', textAlign: 'center',
                }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%',
                        background: '#fff', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 4px 12px rgba(16,185,129,0.2)',
                    }}>
                        <CheckCircle size={28} color="#059669" />
                    </div>
                    <h2 style={{
                        fontSize: '22px', fontWeight: 700,
                        color: '#065f46', margin: '0 0 6px 0',
                    }}>
                        Payment Confirmed!
                    </h2>
                    <p style={{
                        fontSize: '14px', color: '#047857', margin: 0,
                    }}>
                        Order #{order.id} is confirmed and being prepared 🍰
                    </p>
                </div>

                <div style={{ padding: '24px', textAlign: 'center' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '16px', background: '#ecfdf5',
                        borderRadius: '10px', border: '1px solid #d1fae5',
                        marginBottom: '16px',
                    }}>
                        <CheckCircle size={16} color="#059669" />
                        <span style={{ fontSize: '13px', color: '#065f46', fontWeight: 500, textAlign: 'left' }}>
                            You will receive updates about your order via Messenger
                        </span>
                    </div>
                    <button
                        onClick={returnToMessenger}
                        style={{
                            padding: '12px 28px', borderRadius: '10px',
                            background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
                            color: '#fff', fontWeight: 600, fontSize: '14px',
                            border: 'none', cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(14,165,233,0.25)',
                            transition: 'all 0.2s ease',
                            width: '100%',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                        Back to Messenger
                    </button>
                </div>
            </div>
        );
    }

    // ── Rejected State ──
    if (status === 'rejected') {
        return (
            <div style={{
                background: '#fff', borderRadius: '16px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
                border: '1px solid #fecaca', overflow: 'hidden',
            }}>
                <div style={{
                    background: 'linear-gradient(135deg, #fee2e2, #fecaca)',
                    padding: '32px 24px', textAlign: 'center',
                }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%',
                        background: '#fff', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 4px 12px rgba(239,68,68,0.2)',
                    }}>
                        <AlertCircle size={28} color="#dc2626" />
                    </div>
                    <h2 style={{
                        fontSize: '20px', fontWeight: 700,
                        color: '#991b1b', margin: '0 0 6px 0',
                    }}>
                        Payment Issue
                    </h2>
                    <p style={{
                        fontSize: '14px', color: '#b91c1c', margin: 0,
                        lineHeight: 1.6,
                    }}>
                        We could not verify your payment. Please try again with a clear screenshot.
                    </p>
                </div>

                <div style={{ padding: '24px', textAlign: 'center' }}>
                    <button
                        onClick={() => {
                            setStatus('pending');
                            setPreview(null);
                            setUploadedUrl(null);
                            setError(null);
                        }}
                        style={{
                            padding: '12px 28px', borderRadius: '10px',
                            background: 'linear-gradient(135deg, #D8A35D, #F4C27F)',
                            color: '#fff', fontWeight: 600, fontSize: '14px',
                            border: 'none', cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(216,163,93,0.3)',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // ── Loading fallback ──
    return (
        <div style={{
            padding: '40px', textAlign: 'center',
            background: '#fff', borderRadius: '16px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
            <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                border: '3px solid #e5e7eb', borderTopColor: '#D8A35D',
                animation: 'paymentSpin 0.8s linear infinite',
                margin: '0 auto',
            }} />
            <style jsx>{`
                @keyframes paymentSpin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
