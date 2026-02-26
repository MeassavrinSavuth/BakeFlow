import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '../utils/formatCurrency';
import { toMyanmarNumber } from '../utils/formatCurrency';
import { useTranslation } from '../utils/i18n';

export default function SalesChart({ data, loading }) {
  const { t, lang } = useTranslation();
  return (
    <div className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h5 className="card-title mb-3"><i className="bi bi-bar-chart-fill me-2 text-primary" />{t('salesRecord')}</h5>
        {loading && <div className="skeleton skeleton-chart w-100" style={{ height: 180 }} />}
        {!loading && data.length === 0 && <p className="text-muted mb-0">{t('noSalesDataYet')}</p>}
        {!loading && data.length > 0 && (
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => {
                    // d is "YYYY-MM-DD"
                    const formatted = d.slice(5); // "MM-DD"
                    return lang === 'my' ? toMyanmarNumber(formatted) : formatted;
                  }}
                />
                <YAxis
                  tickFormatter={(v) => lang === 'my' ? `${toMyanmarNumber(v)} Ks` : `${v.toLocaleString()} Ks`}
                  width={75}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(v, lang)}
                  labelFormatter={(l) => `${t('dateLabel')}: ${l}`}
                />
                <Bar dataKey="total" fill="#D8A35D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
