import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import Head from 'next/head';
import CustomerPaymentFlow from '../../components/CustomerPaymentFlow';
import { Package, MapPin, Truck, Clock } from 'lucide-react';

export default function OrderPage() {
    const router = useRouter();
    const { id } = router.query;
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!id) return;

        fetch(`/api/orders/${id}`)
            .then((res) => {
                if (!res.ok) throw new Error('Order not found');
                return res.json();
            })
            .then((data) => {
                const rawItems = Array.isArray(data.items) ? data.items : [];
                const items = rawItems.map((item) => {
                    const quantity = Number(item.quantity ?? item.qty ?? 0);
                    const price = Number(item.price ?? item.unit_price ?? 0);
                    const name = item.product || item.name || item.title || 'Item';
                    return {
                        ...item,
                        quantity,
                        price,
                        product: name,
                        name
                    };
                });
                const itemsSubtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                const rawSubtotal = Number(data.subtotal);
                const rawDeliveryFee = Number(data.delivery_fee);
                const rawDiscount = Number(data.discount);
                const subtotal = Number.isFinite(rawSubtotal) && rawSubtotal > 0 ? rawSubtotal : itemsSubtotal;
                const deliveryFee = Number.isFinite(rawDeliveryFee) ? rawDeliveryFee : 0;
                const discount = Number.isFinite(rawDiscount) ? rawDiscount : 0;
                const fieldTotal = subtotal + deliveryFee - discount;
                const rawTotalAmount = Number(data.total_amount ?? data.total);
                const totalAmount = Number.isFinite(rawTotalAmount) && rawTotalAmount > 0
                    ? rawTotalAmount
                    : (fieldTotal > 0 ? fieldTotal : itemsSubtotal);
                setOrder({
                    ...data,
                    items,
                    subtotal,
                    delivery_fee: deliveryFee,
                    discount,
                    total_amount: totalAmount
                });
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, [id]);

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: '#FFF8F0',
            }}>
                <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    border: '3px solid #f3ede6', borderTopColor: '#D8A35D',
                    animation: 'orderSpin 0.8s linear infinite',
                }} />
                <style jsx>{`
                    @keyframes orderSpin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                minHeight: '100vh', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: '#FFF8F0',
                flexDirection: 'column', gap: '12px',
            }}>
                <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: '#fee2e2', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <Package size={24} color="#dc2626" />
                </div>
                <p style={{ fontSize: '16px', fontWeight: 600, color: '#991b1b' }}>{error}</p>
            </div>
        );
    }

    const statusConfig = {
        pending: { color: '#f59e0b', bg: '#fffbeb', label: 'Pending' },
        confirmed: { color: '#059669', bg: '#ecfdf5', label: 'Confirmed' },
        preparing: { color: '#8b5cf6', bg: '#f5f3ff', label: 'Preparing' },
        ready: { color: '#3b82f6', bg: '#eff6ff', label: 'Ready' },
        delivered: { color: '#059669', bg: '#ecfdf5', label: 'Delivered' },
        cancelled: { color: '#dc2626', bg: '#fef2f2', label: 'Cancelled' },
    };

    const statusStyle = statusConfig[order.status] || statusConfig.pending;

    return (
        <div style={{
            minHeight: '100vh', background: '#FFF8F0',
            padding: '24px 16px 60px',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}>
            <Head>
                <title>Order #{order.id} - BakeFlow</title>
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
                    rel="stylesheet"
                />
            </Head>

            <div style={{ maxWidth: '440px', margin: '0 auto' }}>
                {/* Brand Header */}
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                    <h1 style={{
                        fontSize: '28px', fontWeight: 800,
                        margin: '0 0 4px 0', letterSpacing: '-0.5px',
                        background: 'linear-gradient(135deg, #D8A35D, #B07D3A)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        BakeFlow
                    </h1>
                    <p style={{
                        fontSize: '13px', color: '#9ca3af', margin: 0,
                        fontWeight: 500, letterSpacing: '0.5px',
                    }}>
                        Fresh baked daily
                    </p>
                </div>

                {/* Order Summary Card */}
                <div style={{
                    background: '#fff', borderRadius: '16px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
                    border: '1px solid #f0ebe4', marginBottom: '20px',
                    overflow: 'hidden',
                }}>
                    {/* Card header */}
                    <div style={{
                        padding: '18px 20px', display: 'flex',
                        alignItems: 'center', justifyContent: 'space-between',
                        borderBottom: '1px solid #f3ede6',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '10px',
                                background: 'linear-gradient(135deg, #FFF4EA, #FFECD2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Package size={18} color="#D8A35D" />
                            </div>
                            <div>
                                <h3 style={{
                                    fontSize: '15px', fontWeight: 700, color: '#1f2937',
                                    margin: 0, letterSpacing: '-0.2px',
                                }}>
                                    Order Summary
                                </h3>
                                <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    #{order.id}
                                </span>
                            </div>
                        </div>
                        <span style={{
                            fontSize: '12px', fontWeight: 600,
                            color: statusStyle.color, background: statusStyle.bg,
                            padding: '4px 12px', borderRadius: '20px',
                            textTransform: 'capitalize',
                        }}>
                            {statusStyle.label}
                        </span>
                    </div>

                    {/* Items */}
                    <div style={{ padding: '16px 20px' }}>
                        {order.items && order.items.map((item, idx) => (
                            <div
                                key={idx}
                                style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    alignItems: 'center', padding: '10px 0',
                                    borderBottom: idx < order.items.length - 1 ? '1px solid #f9f5f0' : 'none',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{
                                        width: '28px', height: '28px', borderRadius: '8px',
                                        background: '#FFF4EA', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        fontSize: '12px', fontWeight: 700, color: '#D8A35D',
                                    }}>
                                        {item.quantity}x
                                    </span>
                                    <span style={{
                                        fontSize: '14px', color: '#374151', fontWeight: 500,
                                    }}>
                                        {item.product}
                                    </span>
                                </div>
                                <span style={{
                                    fontSize: '14px', fontWeight: 600, color: '#1f2937',
                                }}>
                                    ${(item.price * item.quantity).toFixed(2)}
                                </span>
                            </div>
                        ))}

                        {/* Total */}
                        <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', marginTop: '12px', paddingTop: '12px',
                            borderTop: '2px solid #f3ede6',
                        }}>
                            <span style={{
                                fontSize: '14px', fontWeight: 600, color: '#6b7280',
                            }}>
                                Total
                            </span>
                            <span style={{
                                fontSize: '20px', fontWeight: 800, color: '#1f2937',
                                letterSpacing: '-0.5px',
                            }}>
                                ${Number(order.total_amount || 0).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    {/* Order meta */}
                    <div style={{
                        padding: '14px 20px', background: '#fafaf8',
                        borderTop: '1px solid #f3ede6',
                        display: 'flex', flexDirection: 'column', gap: '8px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Truck size={14} color="#9ca3af" />
                            <span style={{ fontSize: '13px', color: '#6b7280' }}>
                                <span style={{ fontWeight: 600 }}>Delivery:</span> {order.delivery_type}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MapPin size={14} color="#9ca3af" />
                            <span style={{ fontSize: '13px', color: '#6b7280' }}>
                                <span style={{ fontWeight: 600 }}>Address:</span> {order.address}
                            </span>
                        </div>
                    </div>
                </div>

                {typeof window !== 'undefined' ? null : null}
                {(() => {
                    try {
                        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
                        const pay = params.get('pay');
                        return pay === 'scan';
                    } catch (e) { return true; }
                })() && <CustomerPaymentFlow order={order} />}
            </div>
        </div>
    );
}
