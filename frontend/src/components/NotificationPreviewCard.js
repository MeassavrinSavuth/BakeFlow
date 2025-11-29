import { useEffect, useState } from 'react';
import { useTranslation } from '../utils/i18n';

export default function NotificationPreviewCard({ notification, onClose, onView }) {
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (!notification) return;
    
    // Reset hiding state when new notification comes in
    setHiding(false);
    
    console.log('NotificationPreviewCard received:', notification);
    
    // Auto-hide after 6 seconds
    const timer = setTimeout(() => {
      handleClose();
    }, 6000);

    return () => clearTimeout(timer);
  }, [notification]);

  const handleClose = () => {
    setHiding(true);
    setTimeout(onClose, 300);
  };

  if (!notification) return null;

  const orders = notification.orders || [notification];
  const count = notification.count || orders.length;
  const firstOrder = orders[0];
  const { t } = useTranslation();

  return (
    <div className={`bf-preview-card ${hiding ? 'hiding' : ''}`}>
      <div className="bf-preview-header">
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-bell-fill fs-5"></i>
          <strong>{count === 1 ? t('newOrder') : `${count} ${t('newOrders')}`}</strong>
        </div>
        <button 
          className="btn btn-sm btn-link text-white p-0"
          onClick={handleClose}
        >
          <i className="bi bi-x-lg"></i>
        </button>
      </div>
      <div 
        className="bf-preview-body"
        onClick={() => {
          window.location.href = '/admin/orders';
        }}
        style={{ cursor: 'pointer' }}
      >
        {orders.slice(0, 3).map((order, idx) => (
          <div key={order.id} className={`${idx > 0 ? 'mt-2 pt-2 border-top border-light' : ''}`}>
            <div className="bf-preview-title">
              {t('orderID')} #{order.id} • {order.customer}
            </div>
            <div className="bf-preview-text">
              {order.cake}
            </div>
          </div>
        ))}
        {count > 3 && (
          <div className="small text-muted mt-2">
            …and {count - 3} more {t('ordersLabel')}
          </div>
        )}
        <div className="small text-muted mt-2">
          <i className="bi bi-clock me-1"></i>
          {t('justNow')}
        </div>
      </div>
      <div className="bf-preview-footer">
        <button 
          className="btn btn-sm btn-outline-secondary"
          onClick={handleClose}
        >
          {t('dismiss')}
        </button>
        <button 
          className="btn btn-sm btn-dark"
          onClick={() => {
            if (onView) onView(firstOrder.id);
            // Navigate to orders page
            window.location.href = '/admin/orders';
            handleClose();
          }}
        >
          <i className="bi bi-eye me-1"></i>
          {t('view')} {count > 1 ? t('ordersLabel') : t('orderID')}
        </button>
      </div>
    </div>
  );
}
