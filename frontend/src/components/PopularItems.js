import { useTranslation } from '../utils/i18n';
import { toMyanmarNumber } from '../utils/formatCurrency';
import { useState, useEffect } from 'react';
import Image from 'next/image';

export default function PopularItems({ items, loading }) {
  const { t, lang } = useTranslation();
  const [products, setProducts] = useState({});
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';

  // Fetch product details to get images
  useEffect(() => {
    if (items && items.length > 0) {
      fetch(`${apiBase}/api/products`)
        .then(res => res.json())
        .then(data => {
          const productMap = {};
          (data.products || []).forEach(p => {
            productMap[p.name] = p;
          });
          setProducts(productMap);
        })
        .catch(err => console.error('Failed to load products:', err));
    }
  }, [apiBase, items]);

  return (
    <div className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h5 className="card-title mb-3"><i className="bi bi-heart-fill text-danger me-2" />{t('popularItems')}</h5>
        {loading && <div className="row g-3">{[1, 2, 3, 4].map(i => <div key={i} className="col-6 col-md-3"><div className="card h-100 skeleton" /></div>)}</div>}
        {!loading && (
          <div className="row g-3">
            {items.length === 0 && <div className="col-12 text-muted">{t('noItemDataYet')}</div>}
            {items.map(item => {
              const product = products[item.name];
              const imageUrl = product?.image_url || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=300&fit=crop';

              return (
                <div key={item.name} className="col-6 col-md-3">
                  <div className="card h-100 border-0 shadow-sm popular-item">
                    <div className="ratio ratio-1x1 rounded-top overflow-hidden">
                      <Image
                        src={imageUrl}
                        alt={item.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 25vw"
                        style={{ objectFit: 'cover' }}
                      />
                    </div>
                    <div className="card-body d-flex flex-column justify-content-between p-3">
                      <h6 className="fw-semibold mb-2">{item.name}</h6>
                      <span className="badge bg-accent text-dark align-self-start px-3 py-2">{lang === 'my' ? toMyanmarNumber(item.count) : item.count} {t('ordersLabel')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
