import { useTranslation } from '../utils/i18n';

export default function PopularItems({ items, loading }) {
  const { t } = useTranslation();
  return (
    <div className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h5 className="card-title mb-3"><i className="bi bi-heart-fill text-danger me-2"/>{t('popularItems')}</h5>
        {loading && <div className="row g-3">{[1,2,3,4].map(i => <div key={i} className="col-6 col-md-3"><div className="card h-100 skeleton" /></div>)}</div>}
        {!loading && (
          <div className="row g-3">
            {items.length === 0 && <div className="col-12 text-muted">{t('noItemDataYet')}</div>}
            {items.map(item => (
              <div key={item.name} className="col-6 col-md-3">
                <div className="card h-100 border-0 shadow-sm popular-item">
                  <div className="card-body d-flex flex-column justify-content-between p-3">
                    <div className="mb-2">
                      <div className="ratio ratio-1x1 rounded icon-box d-flex align-items-center justify-content-center mb-2">
                        <i className="bi bi-cake2 fs-2 text-accent" />
                      </div>
                      <h6 className="fw-semibold mb-1 popular-name" style={{ minHeight: 40 }}>{item.name}</h6>
                    </div>
                    <span className="badge bg-accent text-dark align-self-start px-3 py-2">{item.count} {t('ordersLabel')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
