import { formatCurrency } from '../utils/formatCurrency';
import { useTranslation } from '../utils/i18n';

function Card({ title, value, icon, className }) {
  return (
    <div className="col-6 col-md-3">
      <div className={`bf-kpi card shadow-sm border-0 h-100 ${className}`}> 
        <div className="card-body p-3">
          <div className="d-flex align-items-center mb-2">
            <div className="icon-bubble rounded-circle bg-white shadow-sm d-flex align-items-center justify-content-center me-2">
              <i className={`bi bi-${icon} fs-4`}></i>
            </div>
            <div className="ms-auto text-end fw-bold fs-4">{value}</div>
          </div>
          <div className="text-muted small text-uppercase fw-semibold">{title}</div>
        </div>
      </div>
    </div>
  );
}

export default function SummaryCards({ stats, loading }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="row g-3 mb-4">
        {[1,2,3,4].map(n => (
          <div key={n} className="col-6 col-md-3">
            <div className="card h-100 skeleton" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="row g-3 mb-4">
      <Card title={t('totalOrders')} value={stats.totalOrders} icon="receipt" className="kpi-primary" />
      <Card title={t('totalRevenue')} value={formatCurrency(stats.totalRevenue)} icon="currency-dollar" className="kpi-accent" />
      <Card title={t('pendingOrders')} value={stats.pendingOrders} icon="hourglass-split" className="kpi-pending" />
      <Card title={t('completedOrders')} value={stats.completedOrders} icon="check2-circle" className="kpi-complete" />
    </div>
  );
}
