import { formatDate } from '../utils/formatDate';
import { statusColor } from '../utils/statusColor';
import { formatCurrency } from '../utils/formatCurrency';
import Link from 'next/link';
import { useTranslation } from '../utils/i18n';

export default function RecentOrdersTable({ orders, loading, error }) {
  const { t } = useTranslation();
  return (
    <div className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h5 className="card-title mb-3"><i className="bi bi-clock-history me-2"/>{t('recentOrders')}</h5>
        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {loading && (
          <div className="table-loading">
            {[...Array(5)].map((_,i) => <div key={i} className="skeleton skeleton-row mb-2" />)}
          </div>
        )}
        {!loading && (
          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>{t('orderID')}</th>
                  <th>{t('customer')}</th>
                  <th>{t('cake')}</th>
                  <th>{t('date')}</th>
                  <th>{t('status')}</th>
                  <th className="text-end">{t('total')}</th>
                  <th className="text-end">{t('action')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0,10).map(order => (
                  <tr key={order.id}>
                    <td className="fw-semibold">#{order.id}</td>
                    <td>{order.customer_name}</td>
                    <td>{order.items?.[0]?.product || '—'}</td>
                    <td>{formatDate(order.created_at)}</td>
                    <td><span className={`badge bg-${statusColor(order.status)} px-3 py-2`}>{order.status}</span></td>
                    <td className="text-end">{formatCurrency(order.total_amount)}</td>
                    <td className="text-end">
                      <Link href="/admin/orders" className="btn btn-sm btn-outline-secondary">
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && !error && (
                  <tr><td colSpan={7} className="text-center text-muted py-4">{t('noOrdersYet')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
