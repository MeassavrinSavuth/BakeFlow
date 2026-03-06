export function statusColor(status) {
  switch (status) {
    case 'scheduled': return 'dark';
    case 'pending': return 'warning';
    case 'pending_payment': return 'warning';
    case 'pending_verification': return 'info';
    case 'preparing': return 'primary';
    case 'ready': return 'info';
    case 'delivered': return 'success';
    case 'cancelled': return 'danger';
    default: return 'secondary';
  }
}
