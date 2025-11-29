import { useEffect, useState, useMemo, useRef } from 'react';
import Head from 'next/head';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import NotificationPreviewCard from '../../components/NotificationPreviewCard';
import { statusColor } from '../../utils/statusColor';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTranslation } from '../../utils/i18n';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [updating, setUpdating] = useState(null);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [previewCard, setPreviewCard] = useState(null);
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll, addNotifications } = useNotifications();
  const seenOrdersRef = useRef(new Set());
  const initializedRef = useRef(false);
  const { t } = useTranslation();

  // Load seen orders from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('bakeflow_seen_orders');
    if (stored) {
      try {
        const ids = JSON.parse(stored);
        seenOrdersRef.current = new Set(ids);
        console.log('📥 [Orders] Loaded', ids.length, 'seen order IDs from localStorage');
      } catch (e) {
        console.error('Failed to load seen orders:', e);
      }
    }
  }, []);

  // Save seen orders to localStorage whenever it changes
  const updateSeenOrders = (orderIds) => {
    orderIds.forEach(id => seenOrdersRef.current.add(id));
    const ids = Array.from(seenOrdersRef.current);
    localStorage.setItem('bakeflow_seen_orders', JSON.stringify(ids));
  };

  const fetchOrders = async () => {
    try {
      setError(null);
      const res = await fetch('http://localhost:8080/api/admin/orders');
      const data = await res.json();
      if (data.error) {
        setError(data.details || data.error);
        setOrders([]);
      } else {
        const incomingOrders = data.orders || [];
        setOrders(incomingOrders);

        // Detect new pending orders for notifications (only after initial load)
        if (initializedRef.current) {
          const newPendingOrders = incomingOrders.filter(order => {
            return order.status === 'pending' && !seenOrdersRef.current.has(order.id);
          });

          if (newPendingOrders.length > 0) {
            console.log('📢 [Orders] Detected', newPendingOrders.length, 'new orders');
            const items = Array.isArray(newPendingOrders[0].items) ? newPendingOrders[0].items : [];
            const notifs = newPendingOrders.map(order => {
              const orderItems = Array.isArray(order.items) ? order.items : [];
              const first = orderItems[0] || null;
              const cake = first ? `${first.product}${orderItems.length > 1 ? ` + ${orderItems.length - 1} more` : ''}` : (order.cake_description || 'New Order');
              
              return {
                id: order.id,
                customer: order.customer_name || 'Customer',
                cake,
                time: new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                timestamp: Date.now(),
                isRead: false
              };
            });
            
            addNotifications(notifs);
            setPreviewCard({ orders: notifs, count: notifs.length });
            setTimeout(() => setPreviewCard(null), 6000);
          }
        }

        // Update seen orders set and save to localStorage
        const allOrderIds = incomingOrders.map(o => o.id);
        updateSeenOrders(allOrderIds);
        
        if (!initializedRef.current) {
          initializedRef.current = true;
        }
      }
    } catch (e) {
      console.error(e);
      setError('Cannot connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, []);

  const updateOrderStatus = async (orderId, newStatus) => {
    setUpdating(orderId);
    try {
      const res = await fetch(`http://localhost:8080/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        fetchOrders();
        const notified = data.notification_sent;
        const baseMsg = `✅ Order #${orderId} updated to ${newStatus}.`;
        const notiMsg = notified ? ' Customer notified.' : data.notification_error ? ` (No customer notification: ${data.notification_error})` : '';
        setNotification({
          show: true,
          message: baseMsg + notiMsg,
          type: 'success'
        });
        setTimeout(() => setNotification({ show: false, message: '', type: '' }), 6000);
      } else {
        setNotification({
          show: true,
          message: `❌ Failed to update order status${data.notification_error ? ' - ' + data.notification_error : ''}`,
          type: 'danger'
        });
      }
    } catch (e) {
      console.error(e);
      setNotification({
        show: true,
        message: '❌ Error connecting to server',
        type: 'danger'
      });
    } finally {
      setUpdating(null);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter(o => o.status === filter);
  }, [orders, filter]);

  const filters = [
    { key: 'all', labelKey: 'all', icon: 'grid' },
    { key: 'pending', labelKey: 'pending', icon: 'hourglass' },
    { key: 'preparing', labelKey: 'preparing', icon: 'egg-fried' },
    { key: 'ready', labelKey: 'ready', icon: 'check-circle' },
    { key: 'delivered', labelKey: 'delivered', icon: 'truck' }
  ];

  const getStatusSteps = (currentStatus) => {
    const steps = [
      { key: 'pending', label: t('pending'), icon: 'hourglass-split' },
      { key: 'preparing', label: t('preparing'), icon: 'egg-fried' },
      { key: 'ready', label: t('ready'), icon: 'check-circle' },
      { key: 'delivered', label: t('delivered'), icon: 'truck' }
    ];
    const currentIndex = steps.findIndex(s => s.key === currentStatus);
    return steps.map((step, idx) => ({
      ...step,
      isActive: idx === currentIndex,
      isCompleted: idx < currentIndex
    }));
  };

  const getNextAction = (status) => {
    const actions = {
      pending: { label: t('startPreparing'), nextStatus: 'preparing', icon: 'egg-fried', color: 'primary' },
      preparing: { label: t('markAsReady'), nextStatus: 'ready', icon: 'check-circle', color: 'info' },
      ready: { label: t('markAsDelivered'), nextStatus: 'delivered', icon: 'truck', color: 'success' }
    };
    return actions[status];
  };

  return (
    <>
      <Head>
        <title>BakeFlow Admin - Orders</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" defer></script>
      </Head>
      <div className="d-flex vh-100 overflow-hidden bg-soft">
        <Sidebar open={sidebarOpen} toggle={() => setSidebarOpen(o => !o)} />
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <TopNavbar 
            toggleSidebar={() => setSidebarOpen(o => !o)}
            notifications={notifications}
            unreadCount={unreadCount}
            hasUnread={hasUnread}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onNotificationClick={(id) => markAsRead(id)}
            pageTitle={t('ordersLabel') || t('orders')}
            pageSubtitle={t('manageAndUpdateOrders')}
          />
          <div className="flex-grow-1 overflow-auto">
            {/* Preview card notification */}
            <NotificationPreviewCard
              notification={previewCard}
              onClose={() => setPreviewCard(null)}
              onView={(id) => markAsRead(id)}
            />
            <div className="container-fluid px-4 py-4">
              
              {/* Notification Toast */}
              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show position-fixed top-0 end-0 m-4`} style={{zIndex: 9999, maxWidth: '400px'}} role="alert">
                  <strong>{notification.message}</strong>
                  <button type="button" className="btn-close" onClick={() => setNotification({show: false, message: '', type: ''})}></button>
                </div>
              )}

              

              <div className="card border-0 shadow-sm mb-4">
                <div className="card-body">
                  <h5 className="card-title mb-3"><i className="bi bi-funnel me-2"/>{t('filterOrders')}</h5>
                  <div className="btn-group flex-wrap" role="group">
                    {filters.map(f => (
                      <button key={f.key} onClick={() => setFilter(f.key)} className={`btn ${filter===f.key ? 'btn-dark' : 'btn-outline-secondary'}`}>
                        <i className={`bi bi-${f.icon} me-1`} />{t(f.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && <div className="alert alert-danger">{error}</div>}
              {loading && <div className="text-center py-5"><div className="spinner-border text-primary" role="status" /><p className="mt-3 text-muted">{t('loadingOrders')}</p></div>}

              {!loading && filtered.length === 0 && !error && (
                <div className="card border-0 shadow-sm"><div className="card-body text-center py-5"><i className="bi bi-inbox fs-1 text-muted mb-3"/><h4 className="text-muted">{t('noOrdersFound')}</h4><p className="text-secondary">{filter !== 'all' ? t('noFilteredOrders').replace('{filter}', t(filter)) : t('waitingForOrders')}</p></div></div>
              )}

              <div className="row g-4">
                {filtered.map(order => {
                  const nextAction = getNextAction(order.status);
                  const statusSteps = getStatusSteps(order.status);
                  
                  return (
                  <div key={order.id} className="col-12 col-xl-6">
                    <div className="card border-0 shadow-sm h-100 order-detail-card">
                      
                      {/* Header with Order ID and Time */}
                      <div className="card-header bg-white border-bottom py-3">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <h5 className="mb-1 fw-bold">Order #{order.id}</h5>
                            <small className="text-muted"><i className="bi bi-clock me-1"></i>{new Date(order.created_at).toLocaleString()}</small>
                          </div>
                          <span className={`badge bg-${statusColor(order.status)} px-3 py-2`}>{order.status.toUpperCase()}</span>
                        </div>
                      </div>

                      <div className="card-body p-4">
                        
                        {/* Status Timeline */}
                        <div className="status-timeline mb-4">
                          <div className="d-flex justify-content-between align-items-center position-relative">
                            <div className="progress-line position-absolute" style={{height: '2px', left: '24px', right: '24px', top: '20px', background: '#e9ecef', zIndex: 0}}>
                              <div style={{height: '100%', width: `${(statusSteps.filter(s => s.isCompleted).length / (statusSteps.length - 1)) * 100}%`, background: '#D8A35D', transition: 'width 0.3s'}}></div>
                            </div>
                            {statusSteps.map((step, idx) => (
                              <div key={step.key} className="text-center position-relative" style={{zIndex: 1, flex: 1}}>
                                <div className={`rounded-circle d-inline-flex align-items-center justify-content-center ${step.isActive ? 'bg-primary-bake text-white' : step.isCompleted ? 'bg-success text-white' : 'bg-light text-muted'}`} style={{width: '40px', height: '40px', border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
                                  <i className={`bi bi-${step.icon} ${step.isActive || step.isCompleted ? 'fs-6' : 'fs-6'}`}></i>
                                </div>
                                <div className={`small mt-2 fw-${step.isActive ? 'bold' : 'normal'} ${step.isActive ? 'text-dark' : 'text-muted'}`}>{step.label}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Customer & Delivery Info - Side by Side */}
                        <div className="row g-3 mb-4">
                          <div className="col-md-6">
                            <div className="info-card p-3 rounded" style={{background: '#FFF4EA'}}>
                              <div className="d-flex align-items-start gap-3">
                                <div className="rounded-circle bg-white p-2 shadow-sm">
                                  <i className="bi bi-person-fill fs-5 text-primary-bake"></i>
                                </div>
                                <div className="flex-grow-1">
                                  <small className="text-muted text-uppercase d-block mb-1" style={{fontSize: '0.7rem', letterSpacing: '0.5px'}}>{t('customerLabel')}</small>
                                  <strong className="d-block">{order.customer_name}</strong>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="col-md-6">
                            <div className="info-card p-3 rounded" style={{background: '#F8E8D0'}}>
                              <div className="d-flex align-items-start gap-3">
                                <div className="rounded-circle bg-white p-2 shadow-sm">
                                  <i className={`bi ${order.delivery_type === 'delivery' ? 'bi-truck' : 'bi-bag'} fs-5 text-primary-bake`}></i>
                                </div>
                                <div className="flex-grow-1">
                                  <small className="text-muted text-uppercase d-block mb-1" style={{fontSize: '0.7rem', letterSpacing: '0.5px'}}>{t('typeLabel')}</small>
                                  <strong className="d-block text-capitalize">{order.delivery_type === 'delivery' ? t('deliveryLabel') : t('pickupLabel')}</strong>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Delivery Address (if applicable) */}
                        {order.delivery_type === 'delivery' && order.address && (
                          <div className="mb-4 p-3 rounded" style={{background: '#FCE4EC'}}>
                            <div className="d-flex align-items-start gap-3">
                              <i className="bi bi-geo-alt-fill text-danger mt-1"></i>
                              <div>
                                <small className="text-muted text-uppercase d-block mb-1" style={{fontSize: '0.7rem', letterSpacing: '0.5px'}}>{t('deliveryAddress')}</small>
                                <strong>{order.address}</strong>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Items Section */}
                        <div className="mb-4">
                            <h6 className="fw-bold mb-3 text-uppercase" style={{fontSize: '0.85rem', letterSpacing: '0.5px'}}>
                            <i className="bi bi-bag-fill me-2 text-primary-bake"></i>{t('orderItems')}
                          </h6>
                          <div className="items-list">
                            {order.items && order.items.map((item, idx) => (
                              <div key={idx} className="d-flex justify-content-between align-items-center py-3 border-bottom">
                                <div className="flex-grow-1">
                                  <div className="fw-semibold">{item.product}</div>
                                  <small className="text-muted">{formatCurrency(item.price)} × {item.quantity}</small>
                                </div>
                                <div className="fw-bold">{formatCurrency(item.price * item.quantity)}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Payment Summary */}
                        <div className="payment-summary p-3 rounded mb-4" style={{background: '#E8F8F2'}}>
                          <div className="d-flex justify-content-between mb-2">
                            <span className="text-muted">{t('subtotal')}</span>
                            <span className="fw-semibold">{formatCurrency(order.subtotal)}</span>
                          </div>
                          <div className="d-flex justify-content-between mb-3 pb-3 border-bottom">
                            <span className="text-muted">{t('deliveryFee')}</span>
                            <span className="fw-semibold">{formatCurrency(order.delivery_fee)}</span>
                          </div>
                          <div className="d-flex justify-content-between align-items-center">
                            <span className="fw-bold fs-5">{t('totalAmount')}</span>
                            <span className="fw-bold fs-4 text-primary-bake">{formatCurrency(order.total_amount)}</span>
                          </div>
                        </div>

                        {/* Action Button */}
                        {nextAction && (
                          <button 
                            disabled={updating === order.id} 
                            onClick={() => updateOrderStatus(order.id, nextAction.nextStatus)} 
                            className={`btn btn-${nextAction.color} btn-lg w-100 d-flex align-items-center justify-content-center gap-2`}
                            style={{padding: '0.875rem'}}
                          >
                            {updating === order.id ? (
                              <>
                                <span className="spinner-border spinner-border-sm" role="status"></span>
                                <span>{t('updating')}</span>
                              </>
                            ) : (
                              <>
                                <i className={`bi bi-${nextAction.icon} fs-5`}></i>
                                <span className="fw-semibold">{nextAction.label}</span>
                              </>
                            )}
                          </button>
                        )}
                        
                        {order.status === 'delivered' && (
                          <div className="alert alert-success mb-0 d-flex align-items-center gap-2">
                            <i className="bi bi-check-circle-fill fs-5"></i>
                            <span className="fw-semibold">{t('orderCompleted')}</span>
                          </div>
                        )}

                      </div>
                    </div>
                  </div>
                );})}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
